import { isDeepStrictEqual } from 'node:util';
import { notScreenedSafetyProfile, orderScreenings, safetyProfileFromScreenings, type CalendarDate } from '@fitadapt/safety';
import { PROFILE_COLLECTIONS, PROFILE_RECORD_ID, ProfileSchema, ScreeningRecordSchema } from '@fitadapt/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { syncChanges } from '../db/schema.js';
import { collectionRows, parsedRows } from './stored-rows.js';

/** Stored screenings and profile, as the server-side re-checks read them (always through the caller's executor, API-1). */

/**
 * The SafetyProfile of the user's stored screenings, re-derived from their
 * answers with the SAME function as the device (packages/safety,
 * safetyProfileFromScreenings): the head of the `supersedes` chain, never
 * the last pushed (ADR-023: a device that was offline pushes an older
 * screening last); several heads → the strictest combination. None →
 * not screened (fail closed).
 */
export async function latestSafetyProfile(db: DbExecutor, userId: string) {
  const screenings = await storedScreenings(db, userId);
  return screenings.length === 0 ? notScreenedSafetyProfile() : safetyProfileFromScreenings(screenings);
}

async function storedScreenings(db: DbExecutor, userId: string) {
  // API-11: through the per-push cache; each screening parsed once per request.
  return parsedRows(await collectionRows(db, userId, PROFILE_COLLECTIONS.screenings), ScreeningRecordSchema);
}

/**
 * API-5: the date of birth the latest screening(s) state is the one in the
 * stored profile. S4 (the minor rule) and S7 read the profile's date while
 * the SafetyProfile comes from the screening: a screening stating an adult
 * date must not stand beside a profile holding a minor's. True when there
 * is no screening yet (nothing to disagree with).
 */
export async function screeningsAgreeOnBirthDate(db: DbExecutor, userId: string, birthDate: CalendarDate): Promise<boolean> {
  const { heads } = orderScreenings(await storedScreenings(db, userId));
  return heads.every((h) => isDeepStrictEqual(h.data.responses.birthDate, birthDate));
}

export async function storedProfileBirthDate(db: DbExecutor, userId: string): Promise<CalendarDate | null> {
  const [row] = await db
    .select({ op: syncChanges.op, data: syncChanges.data })
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, PROFILE_COLLECTIONS.profile), eq(syncChanges.recordId, PROFILE_RECORD_ID)))
    .orderBy(desc(syncChanges.revision))
    .limit(1);
  if (!row || row.op === 'delete') return null;
  const parsed = ProfileSchema.safeParse(row.data);
  return parsed.success ? parsed.data.birthDate : null;
}

