#!/usr/bin/env node
// Builds the single executable of the CLI for the system it runs on: the CLI and its
// dependencies bundled by esbuild in one CommonJS script (a single executable loads no module from
// node_modules), the preparation blob of Node 24 (--experimental-sea-config), a copy of this node
// with the blob injected by postject (NODE_SEA_BLOB, its fuse), signed again ad hoc on macOS.
// Output: build/sea/breakrocks-<platform>-<arch>[.exe] and its .sha256. Usage: npm run build:sea
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'build', 'sea');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const windows = process.platform === 'win32', mac = process.platform === 'darwin';
const name = `breakrocks-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}${windows ? '.exe' : ''}`;

// zod is shared (one 4.6.7 since the npm overrides of 0.12.2) between the MCP SDK, imported at
// start, and @x402/*, imported lazily (await import). esbuild then wraps the zod modules in lazy
// initialisers that the eager MCP code never runs ("Class2 is not a constructor" at start). The
// x402 side gets its own copy of zod (same files, a ?x402 suffix): the eager copy stays eager.
const lazyZodCopy = {
  name: 'lazy-zod-copy',
  setup(b) {
    b.onResolve({ filter: /^[^.]|^\./ }, async (args) => {
      if (args.pluginData?.skip) return undefined;
      const fromX402 = /[\\/]node_modules[\\/]@x402[\\/]/.test(args.importer) && /^zod(\/|$)/.test(args.path);
      const fromCopy = args.pluginData?.x402zod === true;
      if (!fromX402 && !fromCopy) return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { skip: true } });
      if (r.errors.length) return { errors: r.errors };
      return { path: r.path, suffix: '?x402', pluginData: { x402zod: true } };
    });
    b.onLoad({ filter: /[\\/]node_modules[\\/]zod[\\/].*\.c?js$/ }, async (args) => {
      if (args.suffix !== '?x402') return undefined;
      return { contents: readFileSync(args.path, 'utf8'), loader: 'js', resolveDir: dirname(args.path), pluginData: { x402zod: true } };
    });
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bundle = join(out, 'breakrocks.cjs');
await build({
  entryPoints: [join(root, 'src', 'sea.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  define: { __BREAKROCKS_VERSION__: JSON.stringify(version), 'import.meta.url': '"file:///breakrocks-sea"' }, legalComments: 'none', logLevel: 'warning',
  // Optional peers that the dependencies load only when present.
  external: ['@cfworker/json-schema'],
  plugins: [lazyZodCopy],
});
const config = join(out, 'sea-config.json');
const blob = join(out, 'sea-prep.blob');
writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
const binary = join(out, name);
copyFileSync(process.execPath, binary);
if (mac) execFileSync('codesign', ['--remove-signature', binary], { stdio: 'inherit' });
const { inject } = createRequire(import.meta.url)('postject');
await inject(binary, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(mac ? { machoSegmentName: 'NODE_SEA' } : {}) });
if (mac) execFileSync('codesign', ['--sign', '-', binary], { stdio: 'inherit' });
const sha = createHash('sha256').update(readFileSync(binary)).digest('hex');
writeFileSync(`${binary}.sha256`, `${sha}  ${name}\n`);
console.log(`${binary}\nsha256 ${sha}`);
