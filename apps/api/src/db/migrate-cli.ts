import { loadEnv } from '../config/env.js';
import { createDatabase, runMigrations } from './client.js';

const env = loadEnv();
const handle = createDatabase(env.DATABASE_URL);
try {
  await runMigrations(handle.db);
  process.stdout.write('migrations applied\n');
} finally {
  await handle.close();
}
