#!/usr/bin/env node
// Updates schema/api-v2/, the versioned copy of the contract of API v2 the CLI is built against (its
// .graphql files), then regenerates src/api/schema.generated.ts (scripts/gen-schema.mjs).
// Usage: npm run update:schema [-- <path>]
//   <path> (default: specs/common, the submodule of the specifications pinned on a tag) is a local checkout of the platform specifications (the .graphql files of its contracts/api-v2
//   folder are read) or a folder of those files. Nothing is fetched: the copy is the files given, committed
//   with the CLI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const given = process.argv[2] ?? join(root, 'specs', 'common');
if (!existsSync(given)) { console.error(`${given}: no such folder (git submodule update --init specs/common, or npm run update:schema -- <checkout of the specifications | folder of the API v2 .graphql files>)`); process.exit(2); }
const path = resolve(given);
const source = existsSync(join(path, 'contracts', 'api-v2')) ? join(path, 'contracts', 'api-v2') : path;
if (!existsSync(source) || !statSync(source).isDirectory()) { console.error(`${source}: no such folder`); process.exit(1); }
const files = readdirSync(source).filter((f) => f.endsWith('.graphql'));
if (!files.length) { console.error(`${source}: no .graphql file`); process.exit(1); }
const target = join(root, 'schema', 'api-v2');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const f of files) copyFileSync(join(source, f), join(target, f));
// The version of the specifications the contract comes from (their tag), for doctor: schema/api-v2/VERSION.
let version = process.argv[3];
if (!version) { try { version = execFileSync('git', ['-C', source, 'describe', '--tags', '--exact-match'], { encoding: 'utf8' }).trim(); } catch { /* not a tagged checkout */ } }
if (version) writeFileSync(join(target, 'VERSION'), `${version}\n`);
console.log(`schema/api-v2: ${files.length} files copied from ${source}${version ? ` (${version})` : ', no version (give it: npm run update:schema -- <path> <vX.Y.Z>)'}`);
execFileSync(process.execPath, [join(root, 'scripts', 'gen-schema.mjs')], { stdio: 'inherit' });
