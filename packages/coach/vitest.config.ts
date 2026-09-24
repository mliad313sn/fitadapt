import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Same budget as engine, safety and legal: the property tests run thousands of turns under turbo's parallel run.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**', 'src/fixtures.ts'],
      reporter: ['text-summary', 'lcov'],
      // Safety-critical like engine and safety (S6): 95 %.
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
