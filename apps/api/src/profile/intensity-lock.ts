import { intensityLockStatus, type IntensityLockStatus, type SafetyStopEvent } from '@fitadapt/safety';
import type { ExecutionLog } from '@fitadapt/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor, DbTx } from '../db/client.js';
import { safetyLocks } from '../db/schema.js';

/**
 * MOB-08 (ADR-024): the S3 intensity lock survives a health-consent
 * withdrawal. The execution logs that hold the red flag are health data and
 * are erased on withdrawal (ADR-004); the lock itself must not go with them
 * (S3: intensity stays locked until the user attests medical review). The
 * server keeps, in `safety_locks`, only what S3's lock rule reads (kind, time,
 * causal ids; no symptom) and only while the lock is on. The lock rule itself
 * is packages/safety's `intensityLockStatus`, never re-implemented here.
 */

type LockRow = typeof safetyLocks.$inferSelect;

function toStopEvent(row: LockRow): SafetyStopEvent {
  return row.kind === 'red_flag'
    ? { kind: 'red_flag', at: row.at, ...(row.flagId ? { eventId: row.flagId } : {}) }
    : { kind: 'medical_review_attested', at: row.at, ...(row.attests ? { attests: row.attests } : {}) };
}

async function lockRows(db: DbExecutor, userId: string): Promise<LockRow[]> {
  return db.select().from(safetyLocks).where(eq(safetyLocks.userId, userId)).orderBy(asc(safetyLocks.seq));
}

/** The S3 lock the retained facts give (unlocked when none are retained). */
export async function retainedIntensityLock(db: DbExecutor, userId: string): Promise<IntensityLockStatus & { flagIds: string[] }> {
  const rows = await lockRows(db, userId);
  const status = intensityLockStatus(rows.map(toStopEvent));
  if (!status.locked) return { ...status, flagIds: [] };
  // The flags an attestation must name to lift the lock (ADR-023), so a device that no longer holds them can.
  const named = new Set(rows.flatMap((r) => r.attests ?? []));
  const flagIds = rows.flatMap((r) => (r.kind === 'red_flag' && r.flagId && !named.has(r.flagId) ? [r.flagId] : []));
  return { ...status, flagIds };
}

/** Deletes the retained facts once they no longer lock (storage limitation: kept only while the lock is on). */
export async function pruneLiftedLock(tx: DbTx, userId: string): Promise<void> {
  const rows = await lockRows(tx, userId);
  if (rows.length > 0 && !intensityLockStatus(rows.map(toStopEvent)).locked) await tx.delete(safetyLocks).where(eq(safetyLocks.userId, userId));
}

/** In the sync transaction of the execution log: keeps its S3 fact (a red flag or an attestation), then prunes a lifted lock. */
export async function recordLockFact(tx: DbTx, userId: string, recordId: string, log: ExecutionLog): Promise<void> {
  if (log.kind === 'red_flag') {
    await tx.insert(safetyLocks).values({ userId, recordId, kind: 'red_flag', at: log.at, flagId: log.eventId ?? null }).onConflictDoNothing();
  } else if (log.kind === 'medical_review_attested') {
    await tx.insert(safetyLocks).values({ userId, recordId, kind: 'medical_review_attested', at: log.at, attests: log.attests ? [...log.attests] : null }).onConflictDoNothing();
    await pruneLiftedLock(tx, userId);
  }
}

/** M17 export (GDPR Art. 15/20): the retained S3 facts, as stored. */
export async function exportLockFacts(db: DbExecutor, userId: string) {
  return (await lockRows(db, userId)).map((r) => ({ kind: r.kind, at: r.at, flagId: r.flagId, attests: r.attests, recordedAt: r.createdAt.toISOString() }));
}
