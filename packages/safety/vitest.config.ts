import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The M05 adversarial pain-model properties (20,000 runs) take ~1 s alone and >5 s under turbo's parallel workspace run.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
});
