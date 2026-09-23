import { sql } from 'drizzle-orm';
import { createDatabase, runMigrations } from '../../src/db/client.js';
import { integrationEnv } from './env.js';

/** Fresh schema for every run, then the real migrations. */
export default async function setup() {
  const { databaseUrl } = integrationEnv();
  const handle = createDatabase(databaseUrl);
  try {
    await handle.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await handle.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await handle.db.execute(sql`CREATE SCHEMA public`);
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
