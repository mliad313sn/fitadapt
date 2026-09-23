import { isDeepStrictEqual } from 'node:util';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { evaluateAgeGate, evaluateScreening, type CalendarDate } from '@fitadapt/safety';
import {
  EquipmentProfileSchema,
  PROFILE_COLLECTIONS,
  ProfileSchema,
  ScreeningRecordSchema,
  type SafetyProfile,
  type SyncMutation,
} from '@fitadapt/shared';
import type { MutationListener, MutationValidator } from '@fitadapt/sync';
import { and, eq, inArray } from 'drizzle-orm';
import { syncChanges } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import type { ConsentWithdrawalHandler, PrivacyService } from '../privacy/service.js';

/** Collections holding health data (screening answers, biometrics): need the health consent (L9, ADR-004). */
export const HEALTH_COLLECTIONS: readonly string[] = [PROFILE_COLLECTIONS.profile, PROFILE_COLLECTIONS.screenings];

/**
 * The latest calendar date anywhere on Earth right now (UTC+14). A user who is
 * under 16 even on that date is under 16 wherever they are, so the server-side
 * S7 check never refuses a user the device gate correctly let in, and never
 * lets in one it blocked.
 */
export function latestCalendarDate(now: Date): CalendarDate {
  const d = new Date(now.getTime() + 14 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const after = (a: CalendarDate, b: CalendarDate) => a.year - b.year || a.month - b.month || a.day - b.day;

export interface ProfileSyncDeps {
  privacy: PrivacyService;
  legal: LegalService;
  now: () => Date;
}

/**
 * Server-side checks for the M01 collections (ADR-012, ADR-013): zod schema,
 * health consent, the S7 age gate (closing the M17 gap: the server did no age
 * check) and, for screenings, a re-evaluation of the SafetyProfile so a
 * client can never store a looser profile than its answers give.
 */
export function profileSyncValidator(deps: ProfileSyncDeps): MutationValidator {
  const consentRequired = async (userId: string, m: SyncMutation) =>
    HEALTH_COLLECTIONS.includes(m.collection) && !(await deps.privacy.hasConsent(userId, 'health')) ? 'privacy.consent_required' : null;
  const ageBlocked = (birth: CalendarDate) => evaluateAgeGate(birth, latestCalendarDate(deps.now())).status !== 'allowed';

  return async (userId, m) => {
    if (m.op === 'delete') return null;
    switch (m.collection) {
      case PROFILE_COLLECTIONS.profile: {
        const parsed = ProfileSchema.safeParse(m.data);
        if (!parsed.success) return 'profile.invalid';
        if (ageBlocked(parsed.data.birthDate)) return 'safety.s7.under_minimum_age';
        return consentRequired(userId, m);
      }
      case PROFILE_COLLECTIONS.equipmentProfiles:
        return EquipmentProfileSchema.safeParse(m.data).success ? null : 'equipment_profile.invalid';
      case PROFILE_COLLECTIONS.screenings: {
        const parsed = ScreeningRecordSchema.safeParse(m.data);
        if (!parsed.success) return 'screening.invalid';
        const { responses, safetyProfile } = parsed.data;
        if (after(responses.answeredOn, latestCalendarDate(deps.now())) > 0) return 'screening.invalid';
        if (ageBlocked(responses.birthDate)) return 'safety.s7.under_minimum_age';
        if (!isDeepStrictEqual(evaluateScreening(responses), safetyProfile)) return 'screening.profile_mismatch';
        return consentRequired(userId, m);
      }
      default:
        return null;
    }
  };
}

/** Safety events a SafetyProfile implies, for the defensibility log (L6/L11). */
export function safetyEventsFor(profile: SafetyProfile) {
  const events: { invariant: 'S1' | 'S4' | 'S7'; reasonCode: string; action: 'capped' | 'blocked' }[] = [];
  if (profile.unresolvedFlags.length > 0) events.push({ invariant: 'S1', reasonCode: 'safety.s1.unresolved_flag', action: 'capped' });
  if (profile.specialPopulation === 'pregnancy_postpartum') events.push({ invariant: 'S7', reasonCode: 'safety.s7.pregnancy_postpartum', action: 'capped' });
  if (!profile.deficitNutritionAllowed) events.push({ invariant: 'S4', reasonCode: 'safety.s4.deficit_disabled', action: 'blocked' });
  return events;
}

/** After a screening is stored: write the safety gates it switched on to the defensibility log. */
export function profileSyncListener(deps: ProfileSyncDeps): MutationListener {
  return async (userId, m) => {
    if (m.collection !== PROFILE_COLLECTIONS.screenings) return;
    const record = ScreeningRecordSchema.parse(m.data);
    for (const event of safetyEventsFor(record.safetyProfile)) {
      await deps.legal.recordSafetyEvent(userId, { ...event, engineVersion: ENGINE_VERSION });
    }
  };
}

/** Health consent withdrawn: erase the synced health collections in the withdrawal transaction (ADR-004). */
export function healthWithdrawalHandler(): ConsentWithdrawalHandler {
  return async (tx, userId) => {
    await tx.delete(syncChanges).where(and(eq(syncChanges.userId, userId), inArray(syncChanges.collection, [...HEALTH_COLLECTIONS])));
  };
}
