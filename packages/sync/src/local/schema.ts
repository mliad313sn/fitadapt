import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Device-side tables for the local-first data layer (expo-sqlite + Drizzle, ADR-002). */
export const syncRecords = sqliteTable(
  'sync_records',
  {
    collection: text('collection').notNull(),
    id: text('id').notNull(),
    data: text('data', { mode: 'json' }),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision'),
    pendingMutationId: text('pending_mutation_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.collection, t.id] })],
);

export const syncOutbox = sqliteTable('sync_outbox', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  mutation: text('mutation', { mode: 'json' }).notNull(),
  status: text('status', { enum: ['pending', 'acked', 'rejected'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastError: text('last_error'),
});

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Idempotent DDL matching the tables above; run once when the local database opens. */
export const LOCAL_SCHEMA_SQL = [
  sql`CREATE TABLE IF NOT EXISTS sync_records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    revision INTEGER,
    pending_mutation_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  )`,
  sql`CREATE TABLE IF NOT EXISTS sync_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    mutation TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_error TEXT
  )`,
  sql`CREATE INDEX IF NOT EXISTS sync_outbox_status_idx ON sync_outbox (status, seq)`,
  sql`CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];
