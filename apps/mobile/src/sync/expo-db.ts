import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import type { SyncSqliteDatabase } from '@fitadapt/sync';

/** Native glue: the on-device database file. Replaced by sql.js in tests. */
export function openExpoDatabase(): SyncSqliteDatabase {
  return drizzle(openDatabaseSync('local.db'));
}
