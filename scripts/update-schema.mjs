#!/usr/bin/env node
// Updates schema/api-v2/, the versioned copy of the contract of API v2 the CLI is built against (its
// .graphql files), then regenerates src/api/schema.generated.ts (scripts/gen-schema.mjs). From a checkout of the
// specifications, also schema/experiences/: the registry of experience engines and the JSON Schema of the experience
// template as the specs publish them (contracts/experiences/engines.json, definition.schema.json, copied byte for byte:
// the files the backend validates with), and index.json, written here: the version of the specs and, per engine, the
// first definition of its test vectors (contracts/experiences/vectors/*.json), the example of `experiences prompt`.
// Usage: npm run update:schema [-- <path>]
//   <path> (default: specs/common, the submodule of the specifications pinned on a tag) is a local checkout of the platform specifications (the .graphql files of its contracts/api-v2
//   folder are read) or a folder of those files. Nothing is fetched: the copy is the files given, committed
//   with the CLI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const experiences = join(path, 'contracts', 'experiences');
if (existsSync(join(experiences, 'engines.json')) && existsSync(join(experiences, 'definition.schema.json'))) {
  const out = join(root, 'schema', 'experiences');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of ['engines.json', 'definition.schema.json']) copyFileSync(join(experiences, f), join(out, f));
  // The catalogue of the creation templates (since D-510: the keys of a pre-filled link come from its choices).
  if (existsSync(join(experiences, 'creation-templates.json'))) copyFileSync(join(experiences, 'creation-templates.json'), join(out, 'creation-templates.json'));
  const registry = JSON.parse(readFileSync(join(experiences, 'engines.json'), 'utf8'));
  const examples = {};
  for (const e of registry.engines ?? []) {
    const file = e.vectors && join(experiences, e.vectors);
    if (!file || !existsSync(file)) continue;
    const [key, document] = Object.entries(JSON.parse(readFileSync(file, 'utf8')).definitions ?? {})[0] ?? [];
    if (document) examples[`${e.name}/${e.version}`] = { file: e.vectors, key, document };
  }
  const index = { $comment: 'Written by scripts/update-schema.mjs from contracts/experiences of the specs: do not edit. The version of the specs, and per engine the first definition of its test vectors (the example of experiences prompt).', version: version ?? null, examples };
  writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`schema/experiences: engines.json, definition.schema.json, creation-templates.json and ${Object.keys(examples).length} examples copied from ${experiences}`);
} else console.log(`schema/experiences: kept as it is (no contracts/experiences in ${path})`);
console.log(`schema/api-v2: ${files.length} files copied from ${source}${version ? ` (${version})` : ', no version (give it: npm run update:schema -- <path> <vX.Y.Z>)'}`);
execFileSync(process.execPath, [join(root, 'scripts', 'gen-schema.mjs')], { stdio: 'inherit' });
