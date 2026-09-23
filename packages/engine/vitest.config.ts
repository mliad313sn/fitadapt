import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Property tests over whole programs; the whole-repo run shares the CPU (same budget as packages/legal).
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
