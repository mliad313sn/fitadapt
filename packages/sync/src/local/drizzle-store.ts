import { SyncMutationSchema, type OutboxItem } from '@fitadapt/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { LOCAL_SCHEMA_SQL, syncOutbox, syncRecords, syncState } from './schema.js';
import type { LocalRecord, LocalStore, LocalTx } from './types.js';

// Works with any synchronous Drizzle SQLite driver: expo-sqlite on device, sql.js in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncSqliteDatabase = BaseSQLiteDatabase<'sync', any, any>;

const CURSOR_KEY = 'pull_cursor';

function toRecord(row: typeof syncRecords.$inferSelect): LocalRecord {
  return {
    collection: row.collection,
    id: row.id,
    data: (row.data as LocalRecord['data']) ?? null,
    deleted: row.deleted,
    revision: row.revision,
    pendingMutationId: row.pendingMutationId,
    updatedAt: row.updatedAt,
  };
}

function toOutbox(row: typeof syncOutbox.$inferSelect): OutboxItem {
  return {
    id: row.id,
    // Validate at the storage boundary (zod at every process boundary).
    mutation: SyncMutationSchema.parse(row.mutation),
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    lastError: row.lastError,
  };
}

function txFor(db: SyncSqliteDatabase): LocalTx {
  return {
    getRecord(collection, id) {
      const row = db
        .select()
        .from(syncRecords)
        .where(and(eq(syncRecords.collection, collection), eq(syncRecords.id, id)))
        .get() as typeof syncRecords.$inferSelect | undefined;
      return row ? toRecord(row) : undefined;
    },
    putRecord(record) {
      const values = {
        collection: record.collection,
        id: record.id,
        data: record.data,
        deleted: record.deleted,
        revision: record.revision,
        pendingMutationId: record.pendingMutationId,
        updatedAt: record.updatedAt,
      };
      db.insert(syncRecords)
        .values(values)
        .onConflictDoUpdate({ target: [syncRecords.collection, syncRecords.id], set: values })
        .run();
    },
    listRecords(collection) {
      const rows = db.select().from(syncRecords).where(eq(syncRecords.collection, collection)).all() as (typeof syncRecords.$inferSelect)[];
      return rows.map(toRecord);
    },
    addOutbox(item) {
      db.insert(syncOutbox)
        .values({
          id: item.id,
          mutation: item.mutation,
          status: item.status,
          attempts: item.attempts,
          createdAt: item.createdAt,
          lastError: item.lastError,
        })
        .run();
    },
    listOutbox(status, limit) {
      const base = db.select().from(syncOutbox);
      const filtered = status === undefined ? base : base.where(eq(syncOutbox.status, status));
      const ordered = filtered.orderBy(asc(syncOutbox.seq));
      const rows = (limit === undefined ? ordered : ordered.limit(limit)).all() as (typeof syncOutbox.$inferSelect)[];
      return rows.map(toOutbox);
    },
    updateOutbox(id, patch) {
      const result = db.update(syncOutbox).set(patch).where(eq(syncOutbox.id, id)).returning({ id: syncOutbox.id }).all();
      if (result.length === 0) throw new Error(`unknown outbox id ${id}`);
    },
    getCursor() {
      const row = db.select().from(syncState).where(eq(syncState.key, CURSOR_KEY)).get() as
        | typeof syncState.$inferSelect
        | undefined;
      return row ? Number(row.value) : 0;
    },
    setCursor(revision) {
      db.insert(syncState)
        .values({ key: CURSOR_KEY, value: String(revision) })
        .onConflictDoUpdate({ target: syncState.key, set: { value: String(revision) } })
        .run();
    },
  };
}

/** LocalStore backed by SQLite through Drizzle. Call `migrate()` once after opening. */
export class DrizzleLocalStore implements LocalStore {
  constructor(private readonly db: SyncSqliteDatabase) {}

  migrate(): void {
    for (const statement of LOCAL_SCHEMA_SQL) {
      this.db.run(statement);
    }
  }

  transaction<T>(fn: (tx: LocalTx) => T): T {
    return this.db.transaction((tx) => fn(txFor(tx as unknown as SyncSqliteDatabase))) as T;
  }
}
