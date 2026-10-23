// Lint of break-rocks-cli: the recommended rules of TypeScript; the terminal is written through
// src/output.ts only (so that --json and the quiet modes stay consistent).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'specs/', 'bin/'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/output.ts'], rules: { 'no-console': 'off' } },
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
