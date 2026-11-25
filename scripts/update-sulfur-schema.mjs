#!/usr/bin/env node
// Copies the schema the new backend serves (the server's API_SDL, src/api/sdl.ts of a native-sulfur checkout) into
// schema/sulfur/server.graphql, with the server's commit in schema/sulfur/VERSION, then regenerates
// src/sulfur/schema.generated.ts. Usage: npm run update:sulfur-schema [-- <server checkout>] (default ../server)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = resolve(process.argv[2] ?? join(root, '..', 'server'));
const program = `import { API_SDL } from ${JSON.stringify(join(server, 'src/api/sdl.ts'))};
import { buildSchema, printSchema } from ${JSON.stringify(join(server, 'node_modules/graphql/index.js'))};
process.stdout.write(printSchema(buildSchema(API_SDL)));`;
const sdl = execFileSync(join(server, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'), ['--eval', program], { cwd: server, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const commit = execFileSync('git', ['-C', server, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
mkdirSync(join(root, 'schema', 'sulfur'), { recursive: true });
writeFileSync(join(root, 'schema', 'sulfur', 'server.graphql'), sdl);
writeFileSync(join(root, 'schema', 'sulfur', 'VERSION'), `${commit}\n`);
execFileSync(process.execPath, [join(root, 'scripts', 'gen-sulfur-schema.mjs')], { stdio: 'inherit' });
