// What the tests share: a captured output, a temporary configuration folder, an Io with fakes.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/commands/index.js';
import { run } from '../src/cli.js';
import type { Io } from '../src/context.js';
import type { Output } from '../src/output.js';

export function capture() {
  const lines: string[] = []; const errors: string[] = []; const values: unknown[] = [];
  const out: Output = { line: (t) => lines.push(t), error: (t) => errors.push(t), json: (v) => values.push(JSON.parse(JSON.stringify(v))) };
  return { out, lines, errors, values, all: () => [...lines, ...errors, ...values.map((v) => JSON.stringify(v))].join('\n') };
}

export const tempDir = (label = 'breakrocks-test-') => mkdtempSync(join(tmpdir(), label));

export type Harness = ReturnType<typeof capture> & { io: Io; dir: string; clock: { now: number }; slept: number[]; run: (...argv: string[]) => Promise<number> };

/** An Io on a new configuration folder, without network unless [fetch] is given, at a clock the test moves. */
export function harness(options: { fetch?: typeof fetch; env?: Record<string, string>; interactive?: boolean; answers?: string[]; cwd?: string } = {}): Harness {
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
  };
  return { ...c, io, dir, clock, slept, run: (...argv: string[]) => run(argv, io) };
}

/** The last JSON value written. */
export const last = <T = Record<string, unknown>>(h: { values: unknown[] }) => h.values[h.values.length - 1] as T;
