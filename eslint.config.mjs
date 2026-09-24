// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';
import fitadapt from './tooling/eslint-plugin/index.js';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
      // Lint-rule fixtures are linted on purpose by the rule's own tests.
      'tooling/eslint-plugin/test/fixtures/**',
      'tooling/security/test/fixtures/**',
      'tooling/legal/test/fixtures/**',
      'apps/api/drizzle/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Rules run in `pnpm security:sast` (tooling/security/eslint.security.config.mjs);
    // registered here so justified `security/*` suppressions resolve in normal lint.
    plugins: { security },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.cjs', '**/babel.config.js', '**/metro.config.js', '**/jest.config.js', '**/jest.setup.js', 'apps/mobile/app.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/jest.setup.js', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: { globals: { ...globals.jest } },
  },
  // The security tooling scripts touch the file system; keep the SAST rule on
  // here so their justified suppressions stay checked in normal lint too.
  {
    files: ['tooling/security/scripts/**/*.mjs', 'tooling/legal/scripts/**/*.mjs', 'tooling/legal/lib/**/*.mjs', 'apps/api/src/legal/cli.ts', 'apps/api/src/ai-coach/prompts.ts', 'apps/api/eval/run.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'error' },
  },
  // CLAUDE.md rule 5: no user-facing string outside packages/i18n.
  // Test files are not shipped UI; they may use literal fixture labels.
  // PKG-15: app .ts files too (hooks, stores, notification and dialog helpers): there the rule checks
  // Alert.alert / ToastAndroid / setOptions / notification content; JSX checks never fire in .ts.
  {
    files: ['**/*.tsx', '**/*.jsx', 'apps/mobile/src/**/*.ts', 'apps/mobile/app/**/*.ts', 'apps/coach-web/**/*.ts', 'packages/ui/src/**/*.ts'],
    ignores: ['**/*.test.tsx', '**/*.test.jsx', '**/*.test.ts', '**/test-utils.tsx', '**/__tests__/**', '**/*.d.ts'],
    plugins: { fitadapt },
    rules: { 'fitadapt/no-hardcoded-jsx-strings': 'error' },
  },
  // packages/engine and packages/safety are pure: no I/O, no network, injected clock and seed.
  // M11: packages/coach too (the same turn runs on the device offline and on the server; the model is injected).
  {
    files: ['packages/engine/src/**/*.ts', 'packages/safety/src/**/*.ts', 'packages/coach/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'fs/*', 'http', 'https', 'net', 'child_process', 'os', 'path', 'crypto'], message: 'The engine is pure: no I/O.' },
            { group: ['react', 'react-native', 'expo*', '@fitadapt/sync', '@fitadapt/ui'], message: 'The engine has no UI or storage dependencies.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'The engine performs no network calls.' },
        { name: 'XMLHttpRequest', message: 'The engine performs no network calls.' },
        { name: 'localStorage', message: 'The engine performs no I/O.' },
        { name: 'process', message: 'The engine reads no environment.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject a Clock instead.' },
        { object: 'Math', property: 'random', message: 'Use the seeded Rng instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Inject a Clock instead of reading the system time.' },
      ],
    },
  },
);
