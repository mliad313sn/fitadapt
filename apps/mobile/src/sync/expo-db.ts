import { drizzle } from 'drizzle-orm/expo-sqlite';
import { getRandomBytes } from 'expo-crypto';
import { defaultDatabaseDirectory, deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { reportError } from '../observability';
import { secureDeviceKeyStore } from '../storage/device-keys';
import { openEncryptedDatabase } from '../storage/encrypted-db';

/**
 * Native glue: the on-device database file, encrypted with SQLCipher under a
 * key from the OS keystore (ADR-020). Replaced by sql.js in most tests and by
 * a SQLCipher-compatible engine in the encryption tests.
 */
export function openExpoDatabase(): SyncSqliteDatabase {
  const { db } = openEncryptedDatabase<SQLiteDatabase>({
    driver: { openDatabaseSync: (name) => openDatabaseSync(name), deleteDatabaseSync: (name) => deleteDatabaseSync(name), directory: String(defaultDatabaseDirectory) },
    keys: secureDeviceKeyStore,
    randomBytes: getRandomBytes,
    onReset: (reason) => reportError(new Error(`local database reset: ${reason}`), { area: 'storage' }),
  });
  return drizzle(db);
}
