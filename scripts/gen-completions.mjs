#!/usr/bin/env node
// The static completion scripts (README § Autocomplétion), from the built CLI (npm run build first):
// completions/breakrocks.bash, .zsh, .fish and .ps1, for the npm package (prepack) and the release.
// Usage: npm run gen:completions
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../dist/commands/index.js';
import { completionModel } from '../dist/completion/model.js';
import { SHELLS, completionScript } from '../dist/completion/scripts.js';

const out = fileURLToPath(new URL('../completions/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const shell of SHELLS) {
  const file = join(out, `breakrocks.${shell === 'pwsh' ? 'ps1' : shell}`);
  writeFileSync(file, completionScript(completionModel(), shell));
  console.log(file);
}
