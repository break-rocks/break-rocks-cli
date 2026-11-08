#!/usr/bin/env node
// Builds the npm package of the CLI: src/index.ts bundled by esbuild in one ES module, dist/index.js, with what it
// imports from the design system (design-lib/lib/theme, design-lib/lib/layout, design-lib/schemas: the submodule design-lib, pinned on
// a tag, TypeScript without a build), the dependencies left in node_modules (the package's dependencies). The types
// are checked apart (npm run typecheck). Usage: npm run build
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(join(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [join(root, 'src', 'index.ts')], outfile: join(root, 'dist', 'index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  packages: 'external', legalComments: 'none', logLevel: 'warning',
});
