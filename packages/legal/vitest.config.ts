import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // CPU-bound property tests (fast-check) run while turbo runs every package's tests
    // in parallel; the 5 s default timed out under that contention (docs/status/M06.md).
    // Same budget as tooling/legal and tooling/security.
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
