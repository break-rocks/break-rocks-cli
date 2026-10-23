import { createRequire } from 'node:module';

/** The version of the CLI, read from package.json (the single source of the version). */
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
