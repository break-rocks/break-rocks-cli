import { parseArgs } from 'node:util';
import { commandNamed, helpText } from './commands.js';
import { terminal, type Output } from './output.js';

/** Runs the CLI with [argv] (without node and the script) and answers its exit code. [out] is the terminal unless a test gives another. */
export async function main(argv: string[], out: Output = terminal): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: { json: { type: 'boolean' }; version: { type: 'boolean' }; help: { type: 'boolean' } }; allowPositionals: true; strict: false }>>;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' }, version: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: true, strict: false });
  } catch (error) {
    out.error((error as Error).message);
    return 2;
  }
  const json = parsed.values.json === true;
  const [name = 'help', ...rest] = parsed.positionals;
  if (parsed.values.version) return commandNamed('version')!.run({ out, json, args: [] });
  if (parsed.values.help) return commandNamed('help')!.run({ out, json, args: [] });
  const command = commandNamed(name);
  if (!command) {
    if (json) out.json({ error: 'UNKNOWN_COMMAND', command: name });
    else out.error(`Unknown command "${name}".\n\n${helpText()}`);
    return 2;
  }
  return command.run({ out, json, args: rest });
}

// Run directly (`tsx src/index.ts …`): bin/breakrocks.js imports main instead.
if (process.argv[1] && /src[\\/]index\.ts$/.test(process.argv[1])) process.exitCode = await main(process.argv.slice(2));
