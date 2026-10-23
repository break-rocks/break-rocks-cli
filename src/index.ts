import { defaultIo, run } from './cli.js';
import './commands/index.js';
import type { Output } from './output.js';

/** Runs the CLI with [argv] (without node and the script) and answers its exit code. [out] is the terminal unless a test gives another. */
export async function main(argv: string[], out?: Output): Promise<number> {
  return run(argv, defaultIo(out));
}

// Run directly (`tsx src/index.ts …`): bin/breakrocks.js imports main instead.
if (process.argv[1] && /src[\\/]index\.ts$/.test(process.argv[1])) process.exitCode = await main(process.argv.slice(2));
