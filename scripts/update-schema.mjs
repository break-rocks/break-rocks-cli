#!/usr/bin/env node
// Updates schema/schema.graphql, the versioned copy of the GraphQL schema of the platform that the CLI
// is built against, then regenerates src/api/schema.generated.ts (scripts/gen-schema.mjs).
// Usage: npm run update:schema -- <path>
//   <path> is a local checkout of the platform specifications (the schema.graphql of its contracts folder is read)
//   or a schema.graphql file. Nothing is fetched: the copy is the file given, committed with the CLI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const given = process.argv[2];
if (!given) { console.error('usage: npm run update:schema -- <checkout of the specifications | schema.graphql>'); process.exit(2); }
const path = resolve(given);
const source = existsSync(path) && statSync(path).isDirectory() ? join(path, 'contracts', 'schema.graphql') : path;
if (!existsSync(source)) { console.error(`${source}: no such file`); process.exit(1); }
copyFileSync(source, join(root, 'schema', 'schema.graphql'));
console.log(`schema/schema.graphql: copied from ${source}`);
execFileSync(process.execPath, [join(root, 'scripts', 'gen-schema.mjs')], { stdio: 'inherit' });
