// What the tests share: a captured output, a temporary configuration folder, an Io with fakes.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/commands/index.js';
import { run } from '../src/cli.js';
import { Context, NO_FLAGS, type Io } from '../src/context.js';
import { saveSulfurSession } from '../src/sulfur/session.js';
import type { Output } from '../src/output.js';
import type { Keychain } from '../src/keychain.js';

/** A keychain in memory ([available] false: a device without one); never the one of the system in tests. */
export function fakeKeychain(available = true): Keychain & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return { name: 'fake keychain', entries, available: () => available, set: (a, s) => (available ? (entries.set(a, s), true) : false), get: (a) => entries.get(a), delete: (a) => entries.delete(a) };
}

export function capture() {
  const lines: string[] = []; const errors: string[] = []; const values: unknown[] = [];
  const out: Output = { line: (t) => lines.push(t), error: (t) => errors.push(t), json: (v) => values.push(JSON.parse(JSON.stringify(v))) };
  return { out, lines, errors, values, all: () => [...lines, ...errors, ...values.map((v) => JSON.stringify(v))].join('\n') };
}

export const tempDir = (label = 'breakrocks-test-') => mkdtempSync(join(tmpdir(), label));

export type Harness = ReturnType<typeof capture> & { io: Io; dir: string; clock: { now: number }; slept: number[]; run: (...argv: string[]) => Promise<number> };

/** An Io on a new configuration folder, without network unless [fetch] is given, at a clock the test moves. */
export function harness(options: { fetch?: typeof fetch; env?: Record<string, string>; interactive?: boolean; answers?: string[]; payer?: Io['payer']; cwd?: string; keychain?: Keychain } = {}): Harness {
  const c = capture();
  const dir = tempDir();
  const clock = { now: Date.parse('2026-10-23T10:00:00.000Z') };
  const slept: number[] = [];
  const answers = [...(options.answers ?? [])];
  const io: Io = {
    out: c.out, env: { BREAKROCKS_CONFIG_DIR: join(dir, 'config'), ...options.env }, cwd: options.cwd ?? dir,
    fetch: options.fetch ?? (async () => { throw new Error('no network in tests'); }),
    interactive: options.interactive ?? false, ask: async () => answers.shift() ?? '',
    now: () => clock.now, sleep: async (ms) => { slept.push(ms); clock.now += ms; },
    ...(options.payer ? { payer: options.payer } : {}), keychain: options.keychain ?? fakeKeychain(false),
  };
  return { ...c, io, dir, clock, slept, run: (...argv: string[]) => run(argv, io) };
}

/** The last JSON value written. */
export const last = <T = Record<string, unknown>>(h: { values: unknown[] }) => h.values[h.values.length - 1] as T;

const testJwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
/**
 * A session of native-sulfur saved for the profile of [io] (prod unless [env]): a delegated agent's (its token acts for the
 * operator eu-op), an operator's, or a person's ([accountId]); its token lives until 2099.
 */
export function sulfurSession(io: Io, kind: 'agent' | 'operator' | 'human' = 'agent', options: { accountId?: string; env?: string } = {}): void {
  const accountId = options.accountId ?? (kind === 'human' ? 'eu-human' : 'eu-op');
  const ctx = new Context(io, NO_FLAGS);
  saveSulfurSession(ctx, {
    backend: 'sulfur', env: options.env ?? ctx.profile().env, cell: 'eu', accountId, kind: kind === 'human' ? 'untrusted' : 'agent', method: kind === 'human' ? 'email' : 'agent', ...(kind === 'agent' ? { agentId: 'ag' } : kind === 'operator' ? { agentId: accountId } : {}),
    signedInAt: '2026-10-23T09:00:00.000Z', accessExpiresAt: '2099-01-01T00:00:00.000Z', storage: 'file', access: testJwt({ sub: accountId, ...(kind === 'agent' ? { act: { sub: 'ag' } } : {}) }), ...(kind === 'human' ? { refresh: 'r' } : {}),
  });
}

/** A refusal written as the former API wrote it (errorType, errorInfo), as native-sulfur writes it (extensions.reason). */
export const sulfurError = (e: { errorType?: string; message?: string; errorInfo?: unknown; partial?: boolean }) => ({ message: e.message ?? e.errorType ?? '', extensions: { code: 'REFUSED', ...(e.errorType ? { reason: e.errorType } : {}), ...(e.errorInfo !== undefined ? { errorInfo: e.errorInfo } : {}), ...(e.partial ? { partial: true } : {}) } });
