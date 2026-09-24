import { SyncMutationSchema, type OutboxItem } from '@fitadapt/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { LOCAL_SCHEMA_SQL, syncOutbox, syncRecords, syncState } from './schema.js';
import type { LocalRecord, LocalStore, LocalTx } from './types.js';

// Works with any synchronous Drizzle SQLite driver: expo-sqlite on device, sql.js in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the driver result and schema types differ per driver; the store only uses the typed tables below
export type SyncSqliteDatabase = BaseSQLiteDatabase<'sync', any, any>;

/** Reserved sync_state key; other keys are free for callers. */
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

/** Outbox `lastError` of a stored row whose mutation no longer parses (PKG-02). */
export const INVALID_LOCAL_MUTATION = 'invalid_local_mutation';

/** Validated at the storage boundary (zod at every process boundary); undefined for a row that does not parse. */
function toOutbox(row: typeof syncOutbox.$inferSelect): OutboxItem | undefined {
  const mutation = SyncMutationSchema.safeParse(row.mutation);
  if (!mutation.success) return undefined;
  return {
    id: row.id,
    mutation: mutation.data,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    lastError: row.lastError,
  };
}

function txFor(db: SyncSqliteDatabase): LocalTx {
  const tx: LocalTx = {
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
      const items: OutboxItem[] = [];
      for (const row of rows) {
        const item = toOutbox(row);
        if (item) {
          items.push(item);
          continue;
        }
        // PKG-02: a row written before validation on write (e.g. a non-UUID record id) would make every outbox
        // read throw, and with it pendingCount() and sync(). It is quarantined instead and left out of listings.
        if (row.status !== 'rejected' || row.lastError !== INVALID_LOCAL_MUTATION) {
          db.update(syncOutbox).set({ status: 'rejected', lastError: INVALID_LOCAL_MUTATION }).where(eq(syncOutbox.seq, row.seq)).run();
        }
      }
      return items;
    },
    updateOutbox(id, patch) {
      const result = db.update(syncOutbox).set(patch).where(eq(syncOutbox.id, id)).returning({ id: syncOutbox.id }).all();
      if (result.length === 0) throw new Error(`unknown outbox id ${id}`);
    },
    getCursor() {
      const value = tx.getState(CURSOR_KEY);
      return value === undefined ? 0 : Number(value);
    },
    setCursor(revision) {
      tx.setState(CURSOR_KEY, String(revision));
    },
    getState(key) {
      const row = db.select().from(syncState).where(eq(syncState.key, key)).get() as
        | typeof syncState.$inferSelect
        | undefined;
      return row?.value;
    },
    setState(key, value) {
      db.insert(syncState).values({ key, value }).onConflictDoUpdate({ target: syncState.key, set: { value } }).run();
    },
  };
  return tx;
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
