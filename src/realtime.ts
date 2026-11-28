// The real-time updates of native-sulfur (server src/core/messaging/realtime.ts, D-552/D-553/D-556): an AppSync Events
// WebSocket of the cell (client-config `realtimeApis`, src/sulfur/live.ts), authorized with our own access token (the Event
// API's Lambda authorizer, server api/realtime-auth.ts). The protocol (`aws-appsync-event-ws`): the Event API's HTTP host and
// `Authorization: Bearer <token>` in the `header-<base64url>` subprotocol; `connection_init` → `connection_ack
// {connectionTimeoutMs}` (no `ka` within it: the connection is lost); `subscribe {id, channel, authorization}` →
// `subscribe_success | subscribe_error`; `data {id, event}`, the event a JSON text (of JSON, at most twice). WebSocket of
// Node 24, no dependency. A command that watches reads again on each event (src/watch.ts).
import { randomUUID } from 'node:crypto';
import type { Context } from './context.js';
import { CliError, EXIT } from './errors.js';
import { clientHeaders } from './transport.js';

/** An event's payload as the server publishes it ({ ev, … }: msgs, inbox, epoch, mode, gen…). */
export type RealtimeEvent = { ev?: string; [field: string]: unknown };
export type RealtimeMode = 'auto' | 'on' | 'off';
export const ACK_TIMEOUT_MS = 10_000;

let lingering = 0;
/** Sockets closed by us whose close handshake the server has not answered: Node keeps the process alive until it does. */
export const lingeringSockets = () => lingering;
/** Ends the process once the CLI is done: at once if nothing lingers, else after a short grace (the sockets are dropped). */
export function exitWhenDone(code: number, graceMs = 250): void {
  process.exitCode = code;
  if (lingering > 0) setTimeout(() => process.exit(code), graceMs).unref();
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An event's payload: a JSON text (once more if the publisher sent a JSON text of JSON); null when it is not one. */
export function parseEvent(event: unknown): RealtimeEvent | null {
  let v = event;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as RealtimeEvent : null;
}

export type Connection = { close: () => void; closed: Promise<string> };

/**
 * Connects to [realtimeUrl] with [token] and subscribes to [channels]; [onEvent] for each event. Resolves once every
 * subscription succeeded; refuses with REALTIME_REFUSED (connection_error, subscribe_error) or REALTIME_UNREACHABLE.
 * [closed] resolves with the reason when the connection is lost (no keep-alive within its timeout, closed).
 */
export async function connect(ctx: Context, options: { realtimeUrl: string; httpUrl: string; token: string; channels: string[]; onEvent: (event: RealtimeEvent) => void }): Promise<Connection> {
  const Socket = ctx.io.WebSocket ?? globalThis.WebSocket;
  const host = new URL(options.httpUrl).host;
  const auth = { host, Authorization: `Bearer ${options.token}` };
  const socket = new Socket(options.realtimeUrl, { protocols: ['aws-appsync-event-ws', `header-${b64url(auth)}`], headers: clientHeaders() });
  let socketClosed = false;
  socket.addEventListener('close', () => { if (!socketClosed) { socketClosed = true; lingering--; } });
  lingering++;
  let timeoutMs = 300_000, lastKa = ctx.now(), resolveClosed!: (r: string) => void;
  const closed = new Promise<string>((r) => { resolveClosed = r; });
  let ticker: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<string, { channel: string; resolve: () => void; reject: (e: Error) => void }>();
  const finish = (reason: string) => { if (ticker) clearInterval(ticker); for (const p of pending.values()) p.reject(new CliError('REALTIME_UNREACHABLE', reason, EXIT.NETWORK)); pending.clear(); resolveClosed(reason); };
  const acked = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CliError('REALTIME_UNREACHABLE', 'No connection_ack from the Event API', EXIT.NETWORK)), ACK_TIMEOUT_MS);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new CliError('REALTIME_UNREACHABLE', 'The WebSocket of the Event API failed', EXIT.NETWORK)); });
    socket.addEventListener('close', (e) => { clearTimeout(timer); reject(new CliError('REALTIME_UNREACHABLE', `The Event API closed the connection (${(e as CloseEvent).code})`, EXIT.NETWORK)); finish(`closed (${(e as CloseEvent).code})`); });
    socket.addEventListener('message', (m) => {
      let msg: { type?: string; id?: string; event?: unknown; payload?: { connectionTimeoutMs?: number }; errors?: { errorType?: string; message?: string }[] };
      try { msg = JSON.parse(String((m as MessageEvent).data)); } catch { return; }
      switch (msg.type) {
        case 'connection_ack': clearTimeout(timer); timeoutMs = msg.payload?.connectionTimeoutMs ?? timeoutMs; lastKa = ctx.now(); resolve(); break;
        case 'connection_error': clearTimeout(timer); reject(new CliError('REALTIME_REFUSED', `The Event API refused the connection: ${msg.errors?.map((e) => e.errorType ?? e.message).join(', ') ?? 'connection_error'}`, EXIT.REFUSED, { errors: msg.errors ?? [] }, 'platform')); break;
        case 'ka': lastKa = ctx.now(); break;
        case 'subscribe_success': pending.get(msg.id ?? '')?.resolve(); pending.delete(msg.id ?? ''); break;
        case 'subscribe_error': { const p = pending.get(msg.id ?? ''); p?.reject(new CliError('REALTIME_REFUSED', `The Event API refused the channel ${p.channel}: ${msg.errors?.map((e) => e.errorType ?? e.message).join(', ') ?? 'subscribe_error'}`, EXIT.REFUSED, { channel: p.channel, errors: msg.errors ?? [] }, 'platform')); pending.delete(msg.id ?? ''); break; }
        case 'data': {
          const event = parseEvent(msg.event);
          if (event) options.onEvent(event);
          break;
        }
      }
    });
  });
  try {
    await acked;
    ticker = setInterval(() => { if (ctx.now() - lastKa > timeoutMs) { socket.close(); finish('no keep-alive'); } }, 5000);
    (ticker as { unref?: () => void }).unref?.();
    await Promise.all(options.channels.map((channel) => new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { channel, resolve, reject });
      socket.send(JSON.stringify({ type: 'subscribe', id, channel, authorization: auth }));
    })));
  } catch (error) {
    try { socket.close(); } catch { /* closed */ }
    finish('refused');
    throw error;
  }
  return { close: () => { try { socket.close(); } catch { /* closed */ } finish('closed'); }, closed };
}
