import { defineConfig } from 'vitest/config';

/**
 * Unit tests: no PostgreSQL or Redis. Coverage is measured on the modules they
 * exercise; the database-bound modules (service, routes, stores, app) are
 * measured by `test:integration`, which covers all of src/ with its own threshold.
 */
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/auth/crypto.ts',
        'src/auth/errors.ts',
        'src/auth/mailer.ts',
        'src/auth/identity-providers.ts',
        'src/auth/tokens.ts',
        'src/config/**/*.ts',
        'src/observability/**/*.ts',
        'src/ai-coach/anthropic-model.ts',
        'src/ai-coach/prompts.ts',
      ],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage/unit',
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
