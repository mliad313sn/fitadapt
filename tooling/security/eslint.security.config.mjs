// @ts-check
/**
 * Static analysis for security (SAST), run by `pnpm security:sast` in CI
 * (ADR-007). Every rule here is an error: a finding is treated as high
 * severity and fails the pipeline. Rule choices:
 * - eslint-plugin-security (Apache-2.0) recommended rules, except
 *   detect-object-injection, which flags every `obj[key]` in TypeScript and
 *   would bury real findings (typed keys make it a false positive here);
 * - core rules against code injection (eval, new Function, string timers);
 * - no raw HTML injection in React (dangerouslySetInnerHTML).
 * Scope: shipped code and build scripts; tests and test-runner configs are out
 * of scope (they never run in production). A justified inline suppression
 * (`-- reason`) is the only way to accept a finding.
 */
import { defineConfig } from 'eslint/config';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.RulesRecord} */
export const securityRules = {
  ...security.configs.recommended.rules,
  'security/detect-object-injection': 'off',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-syntax': [
    'error',
    { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Raw HTML injection is forbidden (XSS).' },
  ],
};

// Escalate every enabled rule to error: a SAST finding is never just a warning.
for (const [name, setting] of Object.entries(securityRules)) {
  if (setting === 'warn' || setting === 1) securityRules[name] = 'error';
  else if (Array.isArray(setting) && (setting[0] === 'warn' || setting[0] === 1)) securityRules[name] = ['error', ...setting.slice(1)];
}

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
      'apps/api/drizzle/**',
      // SAST covers shipped code and build scripts, not tests and test runners.
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**',
      '**/__tests__/**',
      '**/vitest*.config.ts',
      '**/jest.setup.js',
      // Deliberately vulnerable fixtures that prove the rules fire.
      'tooling/security/test/fixtures/**',
      'tooling/eslint-plugin/test/fixtures/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Declared so rules such as no-implied-eval recognise setTimeout, setInterval, etc.
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    // typescript-eslint is registered so existing disable comments for its rules resolve.
    plugins: { security, '@typescript-eslint': tseslint.plugin },
    rules: securityRules,
  },
);
