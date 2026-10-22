// @ts-check
// Conservative lint baseline: ESLint's and typescript-eslint's `recommended`
// presets only (syntax-level, no type-aware rules). Type-checking itself is
// `tsc --noEmit`, run by `npm run build`.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    // Build tooling and test harnesses run under Node.
    files: ['scripts/**', 'tests/**', 'e2e/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The service worker is plain JS served as-is (see vite.config.ts).
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
);
