// batch: actions of a JSON lines file, one per line, in the form of the commands
// ({ "command": "like", "input": { "id": "…" } }, or { "argv": ["like", "…"] }), each with its
// requestId (the one of the line, else one made and told), stopped at the first refusal unless
// --continue. --yes confirms every action that asks it.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asCliError, usageError } from '../errors.js';
import { execute, findCommand, type Command } from '../registry.js';
import { bool, int, list, object, openObject, parseCommandLine, str } from '../schema.js';

type Line = { command?: string; input?: Record<string, unknown>; argv?: string[]; requestId?: string };
type Outcome = { line: number; command: string; ok: boolean; requestId?: string; result?: unknown; error?: unknown };
type BatchResult = { file: string; done: number; failed: number; skipped: number; results: Outcome[] };
const NOT_IN_BATCH = new Set(['batch', 'mcp']);

export const batch: Command<{ file: string; continue?: boolean }, BatchResult> = {
  name: 'batch', summary: 'Run the actions of a JSON lines file, one per line, each with its requestId',
  description: 'A line is { "command": "<name>", "input": { … }, "requestId": "<uuid>" } (the input of `breakrocks schema <name>`) or { "argv": ["<name>", "<arg>", "--flag", "…"] }. Stops at the first refusal unless --continue; --yes confirms the actions that ask it. --watch, batch and mcp are not actions.',
  examples: ['breakrocks batch --file actions.jsonl', 'breakrocks batch --file actions.jsonl --continue --yes --json'],
  input: object({ file: str('The JSON lines file ("-": stdin)'), continue: bool('Go on after a refusal') }, ['file']),
  output: openObject({ file: str('The file'), done: int('Actions done'), failed: int('Actions refused'), skipped: int('Actions not run (after a refusal)'), results: list('Each action', openObject({ line: int('Its line'), command: str('Its command'), ok: bool('Done'), requestId: str('Its requestId'), result: openObject({}, 'Its answer'), error: openObject({}, 'Its refusal') })) }),
  args: { positionals: ['file'] },
  run: async (ctx, { file, continue: goOn }) => {
    let text: string;
    if (file === '-') { if (!ctx.io.readStdin) throw usageError('INVALID_INPUT', 'No stdin to read here'); text = await ctx.io.readStdin(); } else {
      const path = resolve(ctx.io.cwd, file);
      if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${file}`);
      text = readFileSync(path, 'utf8');
    }
    const lines = text.split(/\r?\n/).map((l, i) => ({ n: i + 1, l: l.trim() })).filter((x) => x.l && !x.l.startsWith('//'));
    const results: Outcome[] = [];
    let failed = 0, stopped = false;
    for (const { n, l } of lines) {
      if (stopped) break;
      let name = '?';
      try {
        let line: Line;
        try { line = JSON.parse(l); } catch { throw usageError('INVALID_INPUT', `line ${n}: not JSON`); }
        const words = line.argv ?? (line.command ? line.command.split(' ') : []);
        const found = findCommand(line.argv ? line.argv.filter((w, i) => i < 4 && !w.startsWith('-')) : words);
        if (!found) throw usageError('UNKNOWN_COMMAND', `line ${n}: unknown command "${words.join(' ')}"`);
        const { command } = found;
        name = command.name;
        if (NOT_IN_BATCH.has(command.name)) throw usageError('INVALID_INPUT', `line ${n}: ${command.name} is not an action`);
        const input = line.argv ? parseCommandLine(command.input, command.args ?? {}, line.argv.slice(command.name.split(' ').length)) : { ...(line.input ?? {}) };
        if (input.watch) throw usageError('INVALID_INPUT', `line ${n}: --watch is not an action`);
        let requestId: string | undefined;
        if (command.input.properties.requestId) { requestId = (line.requestId ?? input.requestId ?? randomUUID()) as string; input.requestId = requestId; }
        const result = await execute(ctx, command, input);
        results.push({ line: n, command: name, ok: true, ...(requestId ? { requestId } : {}), result });
      } catch (error) {
        failed++;
        results.push({ line: n, command: name, ok: false, error: asCliError(error).toJSON().error });
        if (!goOn) stopped = true;
      }
    }
    return { file, done: results.filter((r) => r.ok).length, failed, skipped: lines.length - results.length, results };
  },
  exitCode: (r) => (r.failed ? 1 : 0),
  text: (r) => [...r.results.map((x) => `line ${x.line} ${x.command}: ${x.ok ? `ok${x.requestId ? ` (requestId ${x.requestId})` : ''}` : `refused ${(x.error as { code: string }).code}`}`), `${r.done} done, ${r.failed} refused, ${r.skipped} not run`].join('\n'),
};
