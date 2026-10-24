// The command line: the global options taken out, the command found in the registry, its options
// parsed from its input schema, its answer written in text or JSON, the exit code.
import { createInterface } from 'node:readline/promises';
import { runComplete } from './commands/completion.js';
import { rememberUse } from './completion/model.js';
import { isEnvironment } from './config.js';
import { Context, NO_FLAGS, type GlobalFlags, type Io } from './context.js';
import { CliError, EXIT, asCliError, usageError } from './errors.js';
import { commandHelp } from './help.js';
import { terminal, type Output } from './output.js';
import { execute, findCommand, groups, type AnyCommand } from './registry.js';
import { renderText, selectFields } from './render.js';
import { parseCommandLine } from './schema.js';
import { VERSION } from './version.js';

/** The global options out of [argv] (anywhere before "--"), and the tokens left in order. */
export function parseGlobals(argv: readonly string[]): { flags: GlobalFlags; tokens: string[] } {
  const flags: GlobalFlags = { ...NO_FLAGS };
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') { tokens.push(...argv.slice(i)); break; }
    const [name, inline] = t.startsWith('--') && t.includes('=') ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw usageError('MISSING_VALUE', `${name} needs a value`, { option: name });
      return v;
    };
    switch (name) {
      case '--json': flags.json = true; break;
      case '--quiet': case '-q': flags.quiet = true; break;
      case '--yes': case '-y': flags.yes = true; break;
      case '--help': case '-h': flags.help = true; break;
      case '--version': flags.version = true; break;
      case '--fields': flags.fields = value().split(',').map((f) => f.trim()).filter(Boolean); break;
      case '--profile': flags.profile = value(); break;
      case '--env': {
        // "--env dev|staging|prod" is the environment; a bare --env is left to the command (wallet set --env).
        const v = inline ?? argv[i + 1];
        if (isEnvironment(v)) { flags.env = v; if (inline === undefined) i++; } else if (inline !== undefined) throw usageError('ENV_INVALID', `--env is dev, staging or prod, not "${inline}"`);
        else tokens.push(t);
        break;
      }
      default: tokens.push(t);
    }
  }
  return { flags, tokens };
}

/** Asks a secret in the terminal without echoing it (raw mode; Ctrl-C cancels), on stderr. */
function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stderr.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return done();
        if (c === '\u0003') return done(new CliError('CANCELLED', 'Cancelled: nothing was done.', EXIT.REFUSED));
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    };
    input.on('data', onData);
  });
}

/** The default input and output of the CLI: the terminal, the environment, fetch, the clock. */
export function defaultIo(out: Output = terminal): Io {
  return {
    out, env: process.env, fetch: globalThis.fetch.bind(globalThis), cwd: process.cwd(),
    interactive: !!process.stdin.isTTY && !!process.stderr.isTTY,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try { return await rl.question(question); } finally { rl.close(); }
    },
    secret: askSecret,
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    readStdin: async () => { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString('utf8'); },
  };
}

/** Writes the answer of [command] as the global options ask, and answers its exit code. */
export function writeAnswer(ctx: Context, command: AnyCommand, result: unknown): number {
  const { out } = ctx.io;
  const { flags } = ctx;
  if (result === undefined) return command.exitCode?.(result) ?? EXIT.OK;
  if (flags.quiet) {
    const id = command.quiet?.(result);
    if (id !== undefined && !flags.json) out.line(id);
    else if (flags.json) out.json(id === undefined ? selectFields(result, flags.fields) : { id });
  } else if (flags.json) out.json(selectFields(result, flags.fields));
  else out.line(flags.fields ? renderText(selectFields(result, flags.fields)) : command.text ? command.text(result) : renderText(result));
  return command.exitCode?.(result) ?? EXIT.OK;
}

/** Writes a refusal: JSON on stdout with --json (scripts read one stream), else a line on stderr. */
export function writeError(out: Output, json: boolean, error: CliError): number {
  if (json) out.json(error.toJSON());
  else out.error(`Error ${error.code}: ${error.message}`);
  return error.exit;
}

/** Runs the CLI with [argv] (without node and the script) and answers its exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  if (argv[0] === '__complete') return runComplete(argv.slice(1), io);
  let json = argv.includes('--json');
  try {
    const { flags, tokens } = parseGlobals(argv);
    json = flags.json;
    const words: string[] = [];
    for (const t of tokens) { if (t.startsWith('-') || words.length === 4) break; words.push(t); }
    const found = findCommand(words);
    if (!found) {
      const ctx = new Context(io, flags);
      if (flags.version && !words.length) return writeAnswer(ctx, findCommand(['version'])!.command, { version: VERSION });
      if (!words.length || (words.length === 1 && groups().includes(words[0]))) {
        const help = findCommand(['help'])!.command;
        return writeAnswer(ctx, help, await execute(ctx, help, words.length ? { command: words } : {}));
      }
      throw usageError('UNKNOWN_COMMAND', `Unknown command "${words.join(' ') || tokens[0]}". breakrocks help lists the commands.`, { command: words.join(' ') || tokens[0] });
    }
    const { command } = found;
    const ctx = new Context(io, flags);
    if (flags.help) return writeAnswer(ctx, findCommand(['help'])!.command, { text: commandHelp(command), commands: [{ name: command.name, summary: command.summary }] });
    const rest = tokens.slice(command.name.split(' ').length);
    const input = parseCommandLine(command.input, command.args ?? {}, rest);
    const result = await execute(ctx, command, input);
    const exit = writeAnswer(ctx, command, result);
    if (exit === EXIT.OK) rememberUse(ctx, command, input, result);
    return exit;
  } catch (error) {
    return writeError(io.out, json, asCliError(error));
  }
}
