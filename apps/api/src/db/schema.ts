import { bigint, bigserial, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

/**
 * Consent decisions per data type (M17, ADR-004). Append-only: a withdrawal is
 * a new row; a database trigger rejects UPDATE. Rows are deleted with the user.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey(),
    /** Insertion order: breaks ties between decisions recorded in the same instant. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dataType: text('data_type', { enum: ['health', 'photos', 'wearables', 'ai_coach', 'analytics', 'partner_sharing'] }).notNull(),
    decision: text('decision', { enum: ['granted', 'withdrawn'] }).notNull(),
    version: integer('version').notNull(),
    locale: text('locale', { enum: ['fr', 'en'] }).notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    source: text('source', { enum: ['mobile', 'web', 'api'] }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** M01: when the server received it (recordedAt is the device time for decisions made offline). */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('consent_records_user_idx').on(t.userId, t.dataType, t.recordedAt)],
);

/**
 * Data-subject requests (export, deletion). Keyed by a pseudonymous subject
 * reference (keyed hash of the user id), not by a foreign key, so the record
 * of a deletion survives the deletion itself without holding personal data.
 */
export const dataRequests = pgTable(
  'data_requests',
  {
    id: uuid('id').primaryKey(),
    subjectRef: text('subject_ref').notNull(),
    kind: text('kind', { enum: ['export', 'deletion'] }).notNull(),
    status: text('status', { enum: ['completed', 'backup_purge_pending'] }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    primaryCompletedAt: timestamp('primary_completed_at', { withTimezone: true }).notNull(),
    backupPurgeDueAt: timestamp('backup_purge_due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('data_requests_subject_idx').on(t.subjectRef), index('data_requests_due_idx').on(t.status, t.backupPurgeDueAt)],
);

/** Pseudonymous audit trail (AuditEntry, L11): no personal data, append-only (UPDATE rejected by trigger). */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid('id').primaryKey(),
    subjectRef: text('subject_ref').notNull(),
    action: text('action', {
      enum: ['consent.granted', 'consent.withdrawn', 'data.exported', 'data.corrected', 'account.deleted', 'backup.purged'],
    }).notNull(),
    dataType: text('data_type', { enum: ['health', 'photos', 'wearables', 'ai_coach', 'analytics', 'partner_sharing'] }),
    version: integer('version'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('audit_entries_subject_idx').on(t.subjectRef, t.occurredAt)],
);

/**
 * L2 acceptances of legal documents (M20, ADR-008). Append-only (UPDATE
 * rejected by trigger); rows leave with the user. A pseudonymous copy of
 * each acceptance is kept in `defensibility_events`.
 */
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid('id').primaryKey(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    version: integer('version').notNull(),
    locale: text('locale', { enum: ['fr', 'en'] }).notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    source: text('source', { enum: ['mobile', 'web', 'api'] }).notNull(),
    contentHash: text('content_hash').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
    /** M01: when the server received it (acceptedAt is the device time for acceptances given offline). */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('legal_acceptances_user_idx').on(t.userId, t.documentId, t.acceptedAt)],
);

/** L3 point-of-risk notices shown and acknowledged (M20). Append-only. */
export const noticeImpressions = pgTable(
  'notice_impressions',
  {
    id: uuid('id').primaryKey(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noticeId: text('notice_id').notNull(),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['shown', 'acknowledged'] }).notNull(),
    locale: text('locale', { enum: ['fr', 'en'] }).notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    contentHash: text('content_hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** M01: when the server received it (occurredAt is the device time for notices shown offline). */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notice_impressions_user_idx').on(t.userId, t.noticeId)],
);

/**
 * Defensibility log (L11, ADR-009): one hash chain per pseudonymous subject
 * plus a 'global' chain. UPDATE and DELETE are rejected by trigger; only the
 * retention purge may delete whole expired chains. No foreign key to users:
 * the file survives account deletion. `occurred_at` is the exact ISO string
 * that was hashed.
 */
export const defensibilityEvents = pgTable(
  'defensibility_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: uuid('id').notNull().unique(),
    chain: text('chain').notNull(),
    chainSeq: integer('chain_seq').notNull(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('defensibility_events_chain_idx').on(t.chain, t.chainSeq), index('defensibility_events_type_idx').on(t.type)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * M04 end-to-end-encrypted progress-photo backup (ADR-020). Only ciphertext:
 * the photo key wrapped by a key derived from the user's recovery code (never
 * sent), and each photo's AES-256-GCM envelope exactly as stored on the
 * device. The service cannot open either. Deleted when the photos consent is
 * withdrawn, when the backup is turned off, and with the user.
 */
export const photoBackupKeys = pgTable('photo_backup_keys', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const photoBackups = pgTable(
  'photo_backups',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    photoId: uuid('photo_id').notNull(),
    envelope: bytea('envelope').notNull(),
    byteLength: integer('byte_length').notNull(),
    storedAt: timestamp('stored_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.photoId] })],
);
