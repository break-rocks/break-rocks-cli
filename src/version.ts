import { createRequire } from 'node:module';

declare const __BREAKROCKS_VERSION__: string | undefined;

/** The version of the CLI, read from package.json (the single source of the version); a single executable has it built in. */
export const VERSION: string = typeof __BREAKROCKS_VERSION__ === 'string'
  ? __BREAKROCKS_VERSION__
  : (createRequire(import.meta.url)('../package.json') as { version: string }).version;
