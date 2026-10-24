// --watch: the answer of a command read again every --interval seconds (15 at
// least), each new item written as it comes (one JSON line with --jsonl) and given to --exec (a
// program run without a shell, the item as JSON on its stdin and in BREAKROCKS_ITEM). Bounded by
// --duration; stopped cleanly by Ctrl-C. A refusal of the usage limits (RATE_LIMITED,
// QUOTA_EXCEEDED, PAYMENT_REQUIRED) stops it with its code: never worked around; three network
// failures in a row likewise.
import { spawn } from 'node:child_process';
import type { Context } from './context.js';
import { CliError, usageError } from './errors.js';
import { connect, realtimeUnavailable, type Connection, type RealtimeEvent, type RealtimeMode } from './realtime.js';
import { renderText } from './render.js';
import { accountOf, ensureSession } from './session.js';
import type { JsonSchema } from './schema.js';

export const MIN_INTERVAL = 15;
export const WATCH_PROPERTIES: Record<string, JsonSchema> = {
  watch: { type: 'boolean', description: 'Read again every --interval seconds and write each new item as it comes' },
  interval: { type: 'integer', minimum: MIN_INTERVAL, maximum: 3600, default: 30, description: 'Seconds between two reads with --watch (15 at least)' },
  duration: { type: 'integer', minimum: 1, maximum: 7 * 86400, description: 'Stop watching after so many seconds (default: until Ctrl-C)' },
  jsonl: { type: 'boolean', description: 'With --watch: one JSON line per new item' },
  exec: { type: 'string', description: 'With --watch: a program run for each new item (no shell; the item as JSON on its stdin and in BREAKROCKS_ITEM)' },
  realtime: { type: 'string', enum: ['auto', 'on', 'off'], default: 'auto', description: 'With --watch: the real-time updates (auto: when the contract lets the account connect; on: try anyway; off: read again only)' },
};
export type WatchInput = { watch?: boolean; interval?: number; duration?: number; jsonl?: boolean; exec?: string; realtime?: RealtimeMode };

/** What a command watches in real time: its Event API channels (the account's, or those of watchLive) and the events that call for a read. */
export type LiveSource = { channels: (accountId: string) => Promise<string[]>; matches: (event: RealtimeEvent) => boolean };
/** The leases of watchLive end after 10 minutes: renewed every 5. */
export const RENEW_MS = 5 * 60_000;
const STOPPING = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED', 'PAYMENT_REQUIRED', 'SIGN_IN_REQUIRED', 'SESSION_EXPIRED', 'Unauthorized']);

/** A command line split into its words, quotes kept together ("node handler.js 'a b'"). */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let current = '', quote: string | null = null, any = false;
  for (const c of line) {
    if (quote) { if (c === quote) quote = null; else current += c; continue; }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (/\s/.test(c)) { if (current || any) { words.push(current); current = ''; any = false; } continue; }
    current += c;
  }
  if (quote) throw usageError('INVALID_INPUT', '--exec: an unclosed quote');
  if (current || any) words.push(current);
  return words;
}

function runExec(ctx: Context, command: string, item: unknown): Promise<number> {
  const [program, ...args] = splitCommand(command);
  if (!program) return Promise.resolve(0);
  const text = JSON.stringify(item);
  return new Promise((resolveExit) => {
    const child = spawn(program, args, { stdio: ['pipe', 'inherit', 'inherit'], env: { ...ctx.env, BREAKROCKS_ITEM: text }, shell: false });
    child.on('error', (e) => { ctx.io.out.error(`--exec ${program}: ${e.message}`); resolveExit(127); });
    child.on('close', (code) => resolveExit(code ?? 0));
    child.stdin.end(text);
  });
}

export type WatchSummary = { watched: true; mode: 'realtime' | 'polling'; reads: number; events: number; items: number; seconds: number; stoppedBy: string; newItems?: unknown[] };

/**
 * Watches [read] (the items of the command now) by their [key]: the first read is the baseline
 * (told on stderr), then each new key is written and executed; a last read at the end of --duration.
 * The summary is the answer, or a line on stderr with --jsonl.
 */
export async function watchItems<T>(ctx: Context, input: WatchInput, read: () => Promise<T[]>, key: (item: T) => string, live?: LiveSource): Promise<WatchSummary | undefined> {
  const interval = Math.max(MIN_INTERVAL, input.interval ?? 30);
  const started = ctx.now();
  const deadline = input.duration ? started + input.duration * 1000 : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const out = ctx.io.out;
  let reads = 0, emitted = 0, failures = 0;
  let stoppedBy = 'duration';
  let stop = false;
  const collected: unknown[] = [];
  const collect = !!ctx.io.collectWatch;
  if (collect && !input.duration) throw usageError('INVALID_INPUT', 'Here --watch needs --duration (at most 300 seconds)');
  if (collect && input.duration! > 300) throw usageError('INVALID_INPUT', 'Here --duration is at most 300 seconds');
  const onSignal = () => { stop = true; stoppedBy = 'signal'; };
  process.once('SIGINT', onSignal);
  const emit = async (items: T[], first: boolean) => {
    const fresh = items.filter((i) => !seen.has(key(i)));
    for (const i of fresh) seen.add(key(i));
    if (first) return fresh.length;
    // Oldest first: the order they happened in.
    for (const item of [...fresh].reverse()) {
      emitted++;
      if (collect) { if (collected.length < 1000) collected.push(item); } else if (input.jsonl) out.line(JSON.stringify(item)); else out.line(`${renderText(item)}\n`);
      if (input.exec) await runExec(ctx, input.exec, item);
    }
    return fresh.length;
  };
  const readOnce = async (first = false) => {
    let items: T[] = [];
    try { items = await read(); failures = 0; } catch (error) {
      if (error instanceof CliError && (STOPPING.has(error.code) || error.exit !== 3 || ++failures >= 3)) throw error;
      ctx.progress(`No answer (${(error as CliError).code}): trying again`);
    }
    reads++;
    return emit(items, first);
  };
  let mode: WatchSummary['mode'] = 'polling';
  let events = 0;
  try {
    const now = await readOnce(true);
    // The real-time updates first, when the contract and the account allow them.
    let connection: Connection | undefined;
    let woken = false, lost = false;
    let channels: string[] = [];
    let accountId = '';
    const open = async () => {
      const { session, at } = await ensureSession(ctx);
      accountId = accountOf(session);
      const why = realtimeUnavailable(input.realtime ?? 'auto', session.kind, at.realtime);
      if (why) return why;
      channels = await live!.channels(accountId);
      if (!channels.length) return 'nothing to subscribe to for this reading';
      connection = await connect(ctx, { realtimeUrl: at.realtime!, httpUrl: at.events ?? at.api, token: session.idToken ?? session.token, channels, onEvent: (e) => { if (live!.matches(e)) { events++; woken = true; } } });
      lost = false;
      void connection.closed.then((reason) => { if (connection) { lost = true; ctx.progress(`Real time lost (${reason})`); } });
      return undefined;
    };
    if (live) {
      let why: string | undefined;
      try { why = await open(); } catch (error) { why = error instanceof CliError ? `${error.code}: ${error.message}` : String(error); }
      if (why) ctx.notice(`Real time not used (${why}): reading again every ${interval} s`);
      else { mode = 'realtime'; ctx.progress(`Watching in real time (${channels.join(', ')}): ${now} item(s) now${input.duration ? ` for ${input.duration} s` : ', Ctrl-C to stop'}`); }
    }
    if (mode === 'realtime') {
      let renewAt = ctx.now() + RENEW_MS, retries = 0;
      while (!stop && ctx.now() < deadline) {
        await ctx.io.sleep(Math.min(1000, Math.max(0, deadline - ctx.now())));
        if (woken) { woken = false; await readOnce(); }
        if (lost) {
          connection = undefined;
          if (++retries > 3) { mode = 'polling'; ctx.notice(`Real time lost: reading again every ${interval} s`); break; }
          await ctx.io.sleep(Math.min(10_000, 1000 * 2 ** retries));
          try { const why = await open(); if (!why) { retries = 0; await readOnce(); } } catch { /* tried again below */ }
        }
        if (ctx.now() >= renewAt) { renewAt = ctx.now() + RENEW_MS; try { await live!.channels(accountId); } catch { /* the next read tells */ } await readOnce(); }
      }
      connection?.close();
      connection = undefined;
    }
    if (mode === 'polling') {
      if (!live) ctx.progress(`Watching: ${now} item(s) now; a read every ${interval} s${input.duration ? ` for ${input.duration} s` : ', Ctrl-C to stop'}`);
      while (!stop) {
        const left = deadline - ctx.now();
        if (left <= 0) break;
        await ctx.io.sleep(Math.min(interval * 1000, left));
        if (stop) break;
        await readOnce();
      }
    }
    if (stop) stoppedBy = 'signal';
  } finally { process.removeListener('SIGINT', onSignal); }
  const summary: WatchSummary = { watched: true, mode, reads, events, items: emitted, seconds: Math.round((ctx.now() - started) / 1000), stoppedBy, ...(collect ? { newItems: collected } : {}) };
  // With --jsonl, stdout carries the items only: the summary goes to stderr.
  if (input.jsonl && !collect) { ctx.io.out.error(`Watched: ${summary.reads} reads, ${summary.items} new item(s) in ${summary.seconds} s (${summary.stoppedBy})`); return undefined; }
  return summary;
}
