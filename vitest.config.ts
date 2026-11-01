import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Never the configuration folder of the person (nor its migration) in the tests, child processes included.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node', env: { BREAKROCKS_HOME: mkdtempSync(join(tmpdir(), 'breakrocks-home-')), BREAKROCKS_KEYCHAIN: 'off' } } });
