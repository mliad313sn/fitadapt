import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { dbValue } from '../config/db.config.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle (the argument of `db.transaction`). */
export type DbTx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Where a read runs: the pool, or the caller's transaction (API-1: never a second connection while one is held). */
export type DbExecutor = Database | DbTx;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(url: string): DatabaseHandle {
  // API-1: bounded waits, so a stuck request or transaction can never hang the whole API.
  const pool = new pg.Pool({
    connectionString: url,
    max: dbValue('poolMax'),
    connectionTimeoutMillis: dbValue('connectionTimeoutMs'),
    statement_timeout: dbValue('statementTimeoutMs'),
    idle_in_transaction_session_timeout: dbValue('idleInTransactionTimeoutMs'),
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/**
 * Takes the per-user transaction lock that serialises a user's sync pushes,
 * consent decisions and consent-gated writes (photos, pair relay). A consent
 * read after it sees every decision committed before, and a withdrawal waits
 * for a write that already passed its consent check (API-2).
 */
export async function lockUser(tx: DbTx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
