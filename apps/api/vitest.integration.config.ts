import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Local defaults live only in the repository's .env.example (copy it to .env to
// change them). Variables already set in the environment (e.g. by CI) win.
for (const file of ['.env', '.env.example']) {
  const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

export default defineConfig({
  test: {
    // Unit tests run too, so this report is the API's complete coverage.
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // One shared test database: run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Process entry points (listen / CLI) are exercised by `pnpm dev` and `db:migrate`, not by tests.
      exclude: ['src/server.ts', 'src/db/migrate-cli.ts', 'src/legal/export-cli.ts', 'src/legal/demo-seed-cli.ts'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage/integration',
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
