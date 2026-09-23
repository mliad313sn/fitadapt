import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  locale: text('locale', { enum: ['fr', 'en'] }).notNull(),
  unitSystem: text('unit_system', { enum: ['metric', 'imperial'] }).notNull().default('metric'),
  createdAt: createdAt(),
});

export const devices = pgTable(
  'devices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** One-time sign-in codes. Only keyed hashes are stored: never the email in clear, never the code. */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey(),
    emailHash: text('email_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    locale: text('locale', { enum: ['fr', 'en'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_email_idx').on(t.emailHash, t.createdAt)],
);

/** A sign-in on one device = one refresh-token family. Revoking it ends every token in it. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason', { enum: ['logout', 'refresh_token_reuse'] }),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set when the token is rotated; presenting it again is reuse. */
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_session_idx').on(t.sessionId)],
);

/** Per-user revision counter; incremented under a per-user advisory lock (ADR-002). */
export const syncHeads = pgTable('sync_heads', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull(),
});

export const syncChanges = pgTable(
  'sync_changes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    collection: text('collection').notNull(),
    recordId: uuid('record_id').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    data: jsonb('data'),
    originDeviceId: uuid('origin_device_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.revision] }),
    index('sync_changes_record_idx').on(t.userId, t.collection, t.recordId, t.revision),
  ],
);

/** Idempotency ledger: the outcome of every processed mutation, keyed by client mutation id. */
export const syncMutations = pgTable(
  'sync_mutations',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mutationId: uuid('mutation_id').notNull(),
    result: jsonb('result').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mutationId] })],
);
