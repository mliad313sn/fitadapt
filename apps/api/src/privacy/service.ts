import { randomUUID } from 'node:crypto';
import {
  CONSENT_POLICIES,
  checkDecision,
  consentState,
  consentStates,
  hasConsent,
  retentionDays,
  type ConsentPolicySet,
} from '@fitadapt/privacy';
import {
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_SCHEMA_VERSION,
  type AccountDeletionResponse,
  type AuditAction,
  type ConsentDataType,
  type ConsentRecord,
  type ConsentState,
  type ConsentUpdateRequest,
  type DataExport,
  type DataRequest,
  type ProfileCorrection,
  type User,
} from '@fitadapt/shared';
import { and, asc, eq, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { clientTime } from '../lib/client-time.js';
import { keyedHash } from '../auth/crypto.js';
import { ApiError, authErrors } from '../auth/errors.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import { privacyValue } from '../config/privacy.config.js';
import type { Database } from '../db/client.js';
import {
  auditEntries,
  authSessions,
  consentRecords,
  dataRequests,
  devices,
  legalAcceptances,
  noticeImpressions,
  otpCodes,
  refreshTokens,
  syncChanges,
  syncHeads,
  syncMutations,
  users,
  pairEvents,
  pairParticipants,
} from '../db/schema.js';
import type { BackupCatalog } from './backup-catalog.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const DAY_MS = 86_400_000;
/** Advisory-lock key for the retention job (an arbitrary constant, not a threshold). */
const RETENTION_LOCK_KEY = 1_701_700_017;
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export const privacyErrors = {
  consentRequired: () => new ApiError(403, 'privacy.consent_required'),
  consentVersionOutdated: () => new ApiError(409, 'privacy.consent_version_outdated'),
  rateLimited: () => new ApiError(429, 'privacy.rate_limited'),
};

/**
 * Called in the same transaction as a withdrawal, so the owning module can
 * stop processing and erase data held on the basis of that consent.
 */
export type ConsentWithdrawalHandler = (tx: Tx, userId: string, dataType: ConsentDataType) => Promise<void>;

export interface PrivacyServiceDeps {
  db: Database;
  rateLimiter: RateLimiter;
  backups: BackupCatalog;
  pepper: string;
  now: () => Date;
  policies?: ConsentPolicySet;
  withdrawalHandlers?: Partial<Record<ConsentDataType, ConsentWithdrawalHandler[]>>;
  /** M20: records the decision in the defensibility log, in the same transaction (L11). */
  onConsentRecorded?: (
    tx: Tx,
    userId: string,
    record: { dataType: ConsentDataType; decision: ConsentRecord['decision']; version: number; locale: ConsentRecord['locale']; jurisdiction: string },
    at: Date,
  ) => Promise<void>;
}

export interface RetentionRunResult {
  backupPurgesCompleted: number;
  /** Deletion requests past their due date while an older backup still exists: page the on-call (breach runbook). */
  backupPurgesOverdue: string[];
  otpCodesPurged: number;
  sessionsPurged: number;
  auditEntriesPurged: number;
  dataRequestsPurged: number;
}

function toConsentRecord(row: typeof consentRecords.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    dataType: row.dataType,
    decision: row.decision,
    version: row.version,
    locale: row.locale,
    jurisdiction: row.jurisdiction,
    source: row.source,
    recordedAt: iso(row.recordedAt),
  };
}

function toDataRequest(row: typeof dataRequests.$inferSelect): DataRequest {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    requestedAt: iso(row.requestedAt),
    primaryCompletedAt: iso(row.primaryCompletedAt),
    backupPurgeDueAt: isoOrNull(row.backupPurgeDueAt),
    completedAt: isoOrNull(row.completedAt),
  };
}

function toUser(row: typeof users.$inferSelect): User {
  return { id: row.id, email: row.email, locale: row.locale, unitSystem: row.unitSystem, createdAt: iso(row.createdAt) };
}

/**
 * Consent management and data-subject rights (M17; ADR-004, ADR-005):
 * versioned consent per data type, export, correction, deletion with a
 * scheduled backup purge, and the retention jobs.
 */
export class PrivacyService {
  private readonly policies: ConsentPolicySet;

  constructor(private readonly deps: PrivacyServiceDeps) {
    this.policies = deps.policies ?? CONSENT_POLICIES;
  }

  /** Pseudonymous, stable reference to a user for records that outlive the account. */
  subjectRef(userId: string): string {
    return keyedHash(this.deps.pepper, 'subject', userId);
  }

  private async audit(tx: Tx | Database, userId: string, action: AuditAction, now: Date, dataType: ConsentDataType | null = null, version: number | null = null) {
    await tx.insert(auditEntries).values({ id: randomUUID(), subjectRef: this.subjectRef(userId), action, dataType, version, occurredAt: now });
  }

  private async limit(bucket: string, userId: string, key: 'exportRequestsPerWindow' | 'deletionRequestsPerWindow' | 'analyticsBatchesPerWindow') {
    const ok = await this.deps.rateLimiter.hit(bucket, this.subjectRef(userId), privacyValue(key), privacyValue('privacyRateLimitWindowSeconds'));
    if (!ok) throw privacyErrors.rateLimited();
  }

  async consentHistory(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.deps.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(asc(consentRecords.recordedAt), asc(consentRecords.seq));
    return rows.map(toConsentRecord);
  }

  async consents(userId: string): Promise<ConsentState[]> {
    return consentStates(await this.consentHistory(userId), { policies: this.policies });
  }

  async hasConsent(userId: string, dataType: ConsentDataType): Promise<boolean> {
    return hasConsent(await this.consentHistory(userId), dataType, { policies: this.policies });
  }

  /** Throws 403 `privacy.consent_required` unless the consent is currently granted. */
  async requireConsent(userId: string, dataType: ConsentDataType): Promise<void> {
    if (!(await this.hasConsent(userId, dataType))) throw privacyErrors.consentRequired();
  }

  async recordConsent(userId: string, update: ConsentUpdateRequest): Promise<ConsentState> {
    const check = checkDecision(update.decision, update.dataType, update.version, update.jurisdiction, this.policies);
    if (!check.ok) throw privacyErrors.consentVersionOutdated();
    const now = this.deps.now();
    // M01: a decision made offline keeps its device time; the upload can be retried with the same id.
    const recordedAt = clientTime(update.recordedAt, now, 'privacy.client_time_out_of_range');
    const { id, recordedAt: _deviceTime, ...fields } = update;
    await this.deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(consentRecords)
        .values({ id: id ?? randomUUID(), userId, ...fields, recordedAt, receivedAt: now })
        .onConflictDoNothing({ target: consentRecords.id })
        .returning({ id: consentRecords.id });
      if (inserted.length === 0) return; // already recorded (retried upload)
      await this.audit(tx, userId, update.decision === 'granted' ? 'consent.granted' : 'consent.withdrawn', recordedAt, update.dataType, update.version);
      await this.deps.onConsentRecorded?.(tx, userId, { dataType: update.dataType, decision: update.decision, version: update.version, locale: update.locale, jurisdiction: update.jurisdiction }, recordedAt);
      if (update.decision === 'withdrawn') {
        for (const handler of this.deps.withdrawalHandlers?.[update.dataType] ?? []) await handler(tx, userId, update.dataType);
      }
    });
    return consentState(await this.consentHistory(userId), update.dataType, { policies: this.policies });
  }

  async checkAnalyticsQuota(userId: string): Promise<void> {
    await this.limit('analytics', userId, 'analyticsBatchesPerWindow');
  }

  async correctProfile(userId: string, correction: ProfileCorrection): Promise<User> {
    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx.update(users).set(correction).where(eq(users.id, userId)).returning();
      if (!row) throw authErrors.unauthorized();
      await this.audit(tx, userId, 'data.corrected', now);
      return toUser(row);
    });
  }

  /** Everything primary storage holds about the user (GDPR Art. 15 and 20), in one JSON document. */
  async exportData(userId: string): Promise<DataExport> {
    await this.limit('privacy-export', userId, 'exportRequestsPerWindow');
    const now = this.deps.now();
    const subjectRef = this.subjectRef(userId);
    return this.deps.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw authErrors.unauthorized();
      // Record the request first so the export includes it.
      await tx.insert(dataRequests).values({ id: randomUUID(), subjectRef, kind: 'export', status: 'completed', requestedAt: now, primaryCompletedAt: now, completedAt: now });
      await this.audit(tx, userId, 'data.exported', now);

      // One query at a time: they share the transaction's connection.
      const deviceRows = await tx.select().from(devices).where(eq(devices.userId, userId)).orderBy(asc(devices.createdAt));
      const sessionRows = await tx.select().from(authSessions).where(eq(authSessions.userId, userId)).orderBy(asc(authSessions.createdAt));
      const consentRows = await tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.userId, userId))
        .orderBy(asc(consentRecords.recordedAt), asc(consentRecords.seq));
      const head = await tx.select().from(syncHeads).where(eq(syncHeads.userId, userId)).limit(1);
      const changeRows = await tx.select().from(syncChanges).where(eq(syncChanges.userId, userId)).orderBy(asc(syncChanges.revision));
      const mutationRows = await tx.select().from(syncMutations).where(eq(syncMutations.userId, userId)).orderBy(asc(syncMutations.createdAt));
      const requestRows = await tx.select().from(dataRequests).where(eq(dataRequests.subjectRef, subjectRef)).orderBy(asc(dataRequests.requestedAt));
      const auditRows = await tx.select().from(auditEntries).where(eq(auditEntries.subjectRef, subjectRef)).orderBy(asc(auditEntries.occurredAt));
      const acceptanceRows = await tx.select().from(legalAcceptances).where(eq(legalAcceptances.userId, userId)).orderBy(asc(legalAcceptances.acceptedAt), asc(legalAcceptances.seq));
      const noticeRows = await tx.select().from(noticeImpressions).where(eq(noticeImpressions.userId, userId)).orderBy(asc(noticeImpressions.occurredAt), asc(noticeImpressions.seq));
      // M09: this person's participations in multi-device pair sessions and the events they sent (never the partner's).
      const pairRows = await tx.select().from(pairParticipants).where(eq(pairParticipants.userId, userId)).orderBy(asc(pairParticipants.joinedAt));
      const pairEventRows = await tx.select().from(pairEvents).where(eq(pairEvents.fromUserId, userId)).orderBy(asc(pairEvents.createdAt), asc(pairEvents.seq));

      return {
        format: DATA_EXPORT_FORMAT,
        schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
        generatedAt: iso(now),
        user: toUser(user),
        devices: deviceRows.map((d) => ({ id: d.id, platform: d.platform, createdAt: iso(d.createdAt), lastSeenAt: iso(d.lastSeenAt) })),
        sessions: sessionRows.map((s) => ({
          id: s.id,
          deviceId: s.deviceId,
          createdAt: iso(s.createdAt),
          revokedAt: isoOrNull(s.revokedAt),
          revokedReason: s.revokedReason,
        })),
        consents: consentRows.map(toConsentRecord),
        sync: {
          revision: head[0]?.revision ?? 0,
          changes: changeRows.map((c) => ({
            revision: c.revision,
            collection: c.collection,
            recordId: c.recordId,
            op: c.op,
            data: (c.data as Record<string, unknown> | null) ?? null,
            originDeviceId: c.originDeviceId,
            recordedAt: iso(c.createdAt),
          })),
          mutations: mutationRows.map((m) => ({ mutationId: m.mutationId, recordedAt: iso(m.createdAt) })),
        },
        dataRequests: requestRows.map(toDataRequest),
        auditTrail: auditRows.map((a) => ({ id: a.id, action: a.action, dataType: a.dataType, version: a.version, occurredAt: iso(a.occurredAt) })),
        legal: {
          acceptances: acceptanceRows.map((a) => ({ id: a.id, documentId: a.documentId, version: a.version, locale: a.locale, jurisdiction: a.jurisdiction, source: a.source, contentHash: a.contentHash, acceptedAt: iso(a.acceptedAt) })),
          notices: noticeRows.map((n) => ({ id: n.id, noticeId: n.noticeId, version: n.version, kind: n.kind, locale: n.locale, jurisdiction: n.jurisdiction, contentHash: n.contentHash, occurredAt: iso(n.occurredAt) })),
        },
        pair: {
          participations: pairRows.map((p) => ({ pairSessionId: p.pairSessionId, slot: p.slot, displayName: p.displayName, scopes: p.scopes as ('performance' | 'bodyweight' | 'challenge')[], consentVersion: p.consentVersion, joinedAt: iso(p.joinedAt) })),
          events: pairEventRows.map((e) => ({ pairSessionId: e.pairSessionId, seq: e.seq, clientEventId: e.clientEventId, event: e.event as Record<string, unknown>, createdAt: iso(e.createdAt) })),
        },
      };
    });
  }

  /**
   * Deletes the account and all its data from primary storage in one
   * transaction, then schedules the backup purge: backups are rotated after
   * `backupRetentionDays`, so the data is gone from every backup by the due date.
   */
  async deleteAccount(userId: string): Promise<AccountDeletionResponse & { emailHash: string }> {
    await this.limit('privacy-delete', userId, 'deletionRequestsPerWindow');
    const now = this.deps.now();
    const due = new Date(now.getTime() + retentionDays('backupRetentionDays') * DAY_MS);
    const requestId = randomUUID();
    const emailHash = await this.deps.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update');
      if (!user) throw authErrors.unauthorized();
      const hash = keyedHash(this.deps.pepper, 'email', user.email);
      await tx.insert(dataRequests).values({
        id: requestId,
        subjectRef: this.subjectRef(userId),
        kind: 'deletion',
        status: 'backup_purge_pending',
        requestedAt: now,
        primaryCompletedAt: now,
        backupPurgeDueAt: due,
      });
      await this.audit(tx, userId, 'account.deleted', now);
      // Not linked by a foreign key: sign-in codes are keyed by the email hash.
      await tx.delete(otpCodes).where(eq(otpCodes.emailHash, hash));
      // Cascades to devices, sessions, refresh tokens, sync data and consent records.
      await tx.delete(users).where(eq(users.id, userId));
      return hash;
    });
    // Rate-limit counters are keyed hashes with a short TTL; clear them anyway.
    await this.deps.rateLimiter.clear(['otp-request-email', 'otp-verify-email'], emailHash);
    await this.deps.rateLimiter.clear(['privacy-export', 'analytics'], this.subjectRef(userId));
    return { requestId, status: 'backup_purge_pending', primaryDeletedAt: iso(now), backupPurgeDueAt: iso(due), emailHash };
  }

  /**
   * Retention jobs (docs/compliance/retention-schedule.md), run on a schedule:
   * completes backup purges that are due and verified, and deletes records
   * past their retention period.
   */
  async runRetention(): Promise<RetentionRunResult | null> {
    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      // One runner at a time across API instances; the others skip this round.
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) AS locked`);
      if (!lock.rows[0]?.locked) return null;

      const due = await tx
        .select()
        .from(dataRequests)
        .where(and(eq(dataRequests.status, 'backup_purge_pending'), lte(dataRequests.backupPurgeDueAt, now)));
      const oldestBackup = due.length ? await this.deps.backups.oldestRetainedBackupAt() : null;
      let completed = 0;
      const overdue: string[] = [];
      for (const request of due) {
        // Complete only once no backup taken before the deletion is still retained.
        if (oldestBackup && oldestBackup <= request.primaryCompletedAt) {
          overdue.push(request.id);
          continue;
        }
        await tx.update(dataRequests).set({ status: 'completed', completedAt: now }).where(eq(dataRequests.id, request.id));
        await tx.insert(auditEntries).values({ id: randomUUID(), subjectRef: request.subjectRef, action: 'backup.purged', occurredAt: now });
        completed += 1;
      }

      const otp = await tx
        .delete(otpCodes)
        .where(lt(otpCodes.createdAt, daysBefore(now, retentionDays('otpCodeRetentionDays'))))
        .returning({ id: otpCodes.id });
      const ended = daysBefore(now, retentionDays('endedSessionRetentionDays'));
      const sessions = await tx
        .delete(authSessions)
        .where(
          or(
            and(isNotNull(authSessions.revokedAt), lt(authSessions.revokedAt, ended)),
            // Never revoked, but every refresh token expired before the cutoff: the session ended then.
            and(
              lt(authSessions.createdAt, ended),
              sql`NOT EXISTS (SELECT 1 FROM ${refreshTokens} WHERE ${refreshTokens.sessionId} = ${authSessions.id} AND ${refreshTokens.expiresAt} >= ${ended})`,
            ),
          ),
        )
        .returning({ id: authSessions.id });
      const audits = await tx
        .delete(auditEntries)
        .where(lt(auditEntries.occurredAt, daysBefore(now, retentionDays('auditEntryRetentionDays'))))
        .returning({ id: auditEntries.id });
      const requests = await tx
        .delete(dataRequests)
        .where(and(eq(dataRequests.status, 'completed'), lt(dataRequests.requestedAt, daysBefore(now, retentionDays('dataRequestRetentionDays')))))
        .returning({ id: dataRequests.id });

      return {
        backupPurgesCompleted: completed,
        backupPurgesOverdue: overdue,
        otpCodesPurged: otp.length,
        sessionsPurged: sessions.length,
        auditEntriesPurged: audits.length,
        dataRequestsPurged: requests.length,
      };
    });
  }
}
