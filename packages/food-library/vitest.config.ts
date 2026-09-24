import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],



    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
