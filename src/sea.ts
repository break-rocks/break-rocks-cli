// The entry of the single executable (Node SEA; scripts/build-sea.mjs): the whole CLI, its
// dependencies bundled in one CommonJS script, without top-level await.
import './commands/index.js';
import { defaultIo, run } from './cli.js';

// In a single executable, process.argv[1] is the executable again: the arguments follow it.
void run(process.argv.slice(2), defaultIo()).then((code) => { process.exitCode = code; });
