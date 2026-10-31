#!/usr/bin/env node
// Updates schema/api-v2/, the versioned copy of the contract of API v2 the CLI is built against (its
// .graphql files), then regenerates src/api/schema.generated.ts (scripts/gen-schema.mjs).
// Usage: npm run update:schema -- <path>
//   <path> is a local checkout of the platform specifications (the .graphql files of its contracts/api-v2
//   folder are read) or a folder of those files. Nothing is fetched: the copy is the files given, committed
//   with the CLI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const given = process.argv[2];
if (!given) { console.error('usage: npm run update:schema -- <checkout of the specifications | folder of the API v2 .graphql files>'); process.exit(2); }
const path = resolve(given);
const source = existsSync(join(path, 'contracts', 'api-v2')) ? join(path, 'contracts', 'api-v2') : path;
if (!existsSync(source) || !statSync(source).isDirectory()) { console.error(`${source}: no such folder`); process.exit(1); }
const files = readdirSync(source).filter((f) => f.endsWith('.graphql'));
if (!files.length) { console.error(`${source}: no .graphql file`); process.exit(1); }
const target = join(root, 'schema', 'api-v2');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const f of files) copyFileSync(join(source, f), join(target, f));
console.log(`schema/api-v2: ${files.length} files copied from ${source}`);
execFileSync(process.execPath, [join(root, 'scripts', 'gen-schema.mjs')], { stdio: 'inherit' });
