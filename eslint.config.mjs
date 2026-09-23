// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
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
      'apps/api/drizzle/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
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
    files: ['**/*.cjs', '**/babel.config.js', '**/metro.config.js', '**/jest.config.js', '**/jest.setup.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // CLAUDE.md rule 5: no user-facing string outside packages/i18n.
  {
    files: ['**/*.tsx', '**/*.jsx'],
    plugins: { fitadapt },
    rules: { 'fitadapt/no-hardcoded-jsx-strings': 'error' },
  },
  // packages/engine and packages/safety are pure: no I/O, no network, injected clock and seed.
  {
    files: ['packages/engine/src/**/*.ts', 'packages/safety/src/**/*.ts'],
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
