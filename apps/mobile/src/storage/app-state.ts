import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { sql } from 'drizzle-orm';

/**
 * Small synchronous key/value store for device-local app state (age-gate
 * outcome, consent ledger). Lives in the same on-device SQLite database as the
 * sync data, so a local wipe covers both.
 */
export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class SqliteKeyValueStore implements KeyValueStore {
  constructor(private readonly db: SyncSqliteDatabase) {
    db.run(sql`CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }

  get(key: string): string | undefined {
    const row = this.db.get<{ value: string }>(sql`SELECT value FROM app_kv WHERE key = ${key}`);
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.run(sql`INSERT INTO app_kv (key, value) VALUES (${key}, ${value}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  }

  remove(key: string): void {
    this.db.run(sql`DELETE FROM app_kv WHERE key = ${key}`);
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  get(key: string) {
    return this.data.get(key);
  }
  set(key: string, value: string) {
    this.data.set(key, value);
  }
  remove(key: string) {
    this.data.delete(key);
  }
}

/** Keys that survive an account deletion: device facts that are not account data. */
export const DEVICE_KEYS = ['age_gate_status'] as const;

/**
 * Erases every trace of the account on this device: synced records, the
 * outbox, sync metadata (including the device id) and app state, except the
 * age-gate outcome (ADR-005).
 */
export function wipeLocalDatabase(db: SyncSqliteDatabase): void {
  db.transaction((tx) => {
    for (const table of ['sync_records', 'sync_outbox', 'sync_state']) tx.run(sql.raw(`DELETE FROM ${table}`));
    tx.run(sql`DELETE FROM app_kv WHERE key NOT IN (${sql.join(DEVICE_KEYS.map((k) => sql`${k}`), sql`, `)})`);
    // M06: favourites and custom exercises are user data; the bundled exercise library is not. M04: photo metadata.
    for (const table of ['library_favourite', 'library_custom_exercise', 'progress_photo']) {
      if (tx.get<{ name?: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`)?.name) tx.run(sql.raw(`DELETE FROM ${table}`));
    }
  });
}
