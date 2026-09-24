import { isDeepStrictEqual } from 'node:util';
import { ASSESSMENT_MIN_STOP_RIR, ENGINE_VERSION, assessmentStopRir } from '@fitadapt/engine';
import { buildCapacityModel } from '@fitadapt/exercise-library';
import { evaluateAgeGate, evaluateScreening, type CalendarDate } from '@fitadapt/safety';
import {
  ASSESSMENT_COLLECTION,
  AssessmentRecordSchema,
  BodyMetricSchema,
  EquipmentProfileSchema,
  MeasurementSchema,
  NUTRITION_COLLECTIONS,
  PROFILE_COLLECTIONS,
  PROGRAM_COLLECTIONS,
  PROGRESS_COLLECTIONS,
  PreferencesRecordSchema,
  ProfileSchema,
  RECOVERY_COLLECTIONS,
  ReadinessCheckSchema,
  SESSION_COLLECTIONS,
  ScreeningRecordSchema,
  SetLogSchema,
  type SafetyProfile,
} from '@fitadapt/shared';
import type { MutationListener, MutationValidator } from '@fitadapt/sync';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database, DbExecutor } from '../db/client.js';
import { syncChanges } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import type { ConsentWithdrawalHandler, PrivacyService } from '../privacy/service.js';
import type { PgServerTx } from '../sync/pg-store.js';
import { onProgramApplied, validateProgram, validateReflow } from './program-hooks.js';
import { latestSafetyProfile, storedProfileBirthDate } from './screenings.js';
import { onSessionApplied, validateExecutionLog, validateWorkoutSession } from './session-hooks.js';
import { onNutritionApplied, validateHabitCheck, validateIntakeLog, validateNutritionPlan } from './nutrition-hooks.js';

/**
 * Collections holding health data (screening answers, biometrics, M07
 * assessment results, M08 programs, which embed the SafetyProfile, and their
 * reflows, M02 started sessions and execution logs, M05 readiness checks, M04 body weight, body-fat
 * estimates and circumferences, M10 nutrition plans, intake logs and habit ticks): need the health consent
 * (L9, ADR-004) and are erased when it is withdrawn. M00 set logs
 * (reps, load, reserve) stay outside, as before (open question, B1).
 */
export const HEALTH_COLLECTIONS: readonly string[] = [
  PROFILE_COLLECTIONS.profile,
  PROFILE_COLLECTIONS.screenings,
  ASSESSMENT_COLLECTION,
  PROGRAM_COLLECTIONS.programs,
  PROGRAM_COLLECTIONS.reflows,
  // M02: started sessions embed the SafetyProfile and joint flags; execution logs hold pain flags and S3 red flags.
  SESSION_COLLECTIONS.workoutSessions,
  SESSION_COLLECTIONS.executionLogs,
  // M05: readiness checks (sleep, soreness, stress, energy, wearable readings).
  RECOVERY_COLLECTIONS.readinessChecks,
  // M04: body weight, body-fat estimates and circumferences (progress photos are never synced, ADR-020).
  PROGRESS_COLLECTIONS.bodyMetrics,
  PROGRESS_COLLECTIONS.measurements,
  // M10: nutrition plans (embed the SafetyProfile, weight, height, birth date), intake logs and habit ticks.
  NUTRITION_COLLECTIONS.plans,
  NUTRITION_COLLECTIONS.intakeLogs,
  NUTRITION_COLLECTIONS.habitChecks,
];

/** The `preferences` sync collection (per-user settings). */
export const PREFERENCES_COLLECTION = 'preferences';

/** Every collection the validator checks; any other collection is refused (fail closed, PKG-06). */
export const VALIDATED_COLLECTIONS: readonly string[] = [
  ...HEALTH_COLLECTIONS,
  PROFILE_COLLECTIONS.equipmentProfiles,
  SESSION_COLLECTIONS.setLogs,
  PREFERENCES_COLLECTION,
];

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
  /** The pool; the validator itself reads only through the sync transaction it is handed (API-1). */
  db: Database;
}

export { latestSafetyProfile } from './screenings.js';

/**
 * M07: an assessment record must be what the engine derives from its result
 * (CapacityModel re-computed on the seed library), made by this engine
 * version, and stopped at least as far from failure as S1 requires for the
 * user's latest screening (never below RIR 2).
 */
async function validateAssessment(db: DbExecutor, userId: string, data: unknown): Promise<string | null> {
  const parsed = AssessmentRecordSchema.safeParse(data);
  if (!parsed.success) return 'assessment.invalid';
  const { result, capacity, cappedByS1 } = parsed.data;
  if (capacity.engineVersion !== ENGINE_VERSION) return 'assessment.engine_version_unsupported';
  if (cappedByS1 !== result.stopRir > ASSESSMENT_MIN_STOP_RIR) return 'assessment.invalid';
  let expected;
  try {
    expected = buildCapacityModel(result);
  } catch {
    return 'assessment.invalid';
  }
  if (!isDeepStrictEqual(expected, capacity)) return 'assessment.capacity_mismatch';
  const profile = await latestSafetyProfile(db, userId);
  if (profile.screeningOutcome === 'blocked') return 'safety.s7.under_minimum_age';
  const required = assessmentStopRir(profile);
  if (profile.screeningOutcome === 'not_screened' || required === null || !profile.automaticProgrammingAllowed) return 'assessment.not_allowed';
  if (result.stopRir < required) return 'safety.s1.assessment_reserve_too_low';
  return null;
}

/**
 * Server-side checks for the M01 collections (ADR-012, ADR-013): zod schema,
 * health consent, the S7 age gate (closing the M17 gap: the server did no age
 * check) and, for screenings, a re-evaluation of the SafetyProfile so a
 * client can never store a looser profile than its answers give.
 */
export function profileSyncValidator(deps: ProfileSyncDeps): MutationValidator<PgServerTx> {
  const ageBlocked = (birth: CalendarDate) => evaluateAgeGate(birth, latestCalendarDate(deps.now())).status !== 'allowed';

  // API-1/API-2: every read goes through the sync transaction (`tx.db`), which holds the per-user lock:
  // no second pooled connection is taken while this one is held, and the consent read here is the one
  // the change commits under (a withdrawal waits for this transaction, then erases what it stored).
  return async (userId, m, tx) => {
    if (m.op === 'delete') return null;
    const db = tx.db;
    const consentRequired = async () =>
      HEALTH_COLLECTIONS.includes(m.collection) && !(await deps.privacy.hasConsent(userId, 'health', db)) ? 'privacy.consent_required' : null;
    switch (m.collection) {
      case PROFILE_COLLECTIONS.profile: {
        const parsed = ProfileSchema.safeParse(m.data);
        if (!parsed.success) return 'profile.invalid';
        if (ageBlocked(parsed.data.birthDate)) return 'safety.s7.under_minimum_age';
        return consentRequired();
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
        // API-5: the screening's date of birth is the stored profile's (S4/S7 read the profile, S1 the screening).
        const stored = await storedProfileBirthDate(db, userId);
        if (stored && !isDeepStrictEqual(stored, responses.birthDate)) return 'screening.profile_mismatch';
        return consentRequired();
      }
      case ASSESSMENT_COLLECTION:
        return (await consentRequired()) ?? validateAssessment(db, userId, m.data);
      case PROGRAM_COLLECTIONS.programs:
        return (await consentRequired()) ?? validateProgram(db, userId, m.data, await latestSafetyProfile(db, userId));
      case PROGRAM_COLLECTIONS.reflows:
        return (await consentRequired()) ?? validateReflow(db, userId, m.data);
      case SESSION_COLLECTIONS.workoutSessions:
        return (await consentRequired()) ?? validateWorkoutSession(db, deps.legal, userId, m.data, await latestSafetyProfile(db, userId), deps.now());
      case SESSION_COLLECTIONS.executionLogs:
        return (await consentRequired()) ?? (await validateExecutionLog(db, userId, m.data));
      case RECOVERY_COLLECTIONS.readinessChecks:
        return (await consentRequired()) ?? (ReadinessCheckSchema.safeParse(m.data).success ? null : 'readiness_check.invalid');
      case PROGRESS_COLLECTIONS.bodyMetrics:
        return (await consentRequired()) ?? (BodyMetricSchema.safeParse(m.data).success ? null : 'body_metric.invalid');
      case PROGRESS_COLLECTIONS.measurements:
        return (await consentRequired()) ?? (MeasurementSchema.safeParse(m.data).success ? null : 'measurement.invalid');
      case NUTRITION_COLLECTIONS.plans:
        return (await consentRequired()) ?? validateNutritionPlan(db, userId, m.data, await latestSafetyProfile(db, userId), deps.now());
      case NUTRITION_COLLECTIONS.intakeLogs:
        return (await consentRequired()) ?? validateIntakeLog(m.data);
      case NUTRITION_COLLECTIONS.habitChecks:
        return (await consentRequired()) ?? validateHabitCheck(m.data);
      // API-12 / PKG-06: set logs and preferences are schema-checked too (no free text, no unbounded values).
      case SESSION_COLLECTIONS.setLogs:
        return SetLogSchema.safeParse(m.data).success ? null : 'set_log.invalid';
      case PREFERENCES_COLLECTION:
        return PreferencesRecordSchema.safeParse(m.data).success ? null : 'preferences.invalid';
      default:
        // Fail closed: a collection added to the registry without a validator here is refused, never stored unchecked.
        return 'sync.collection_not_validated';
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

/**
 * When a screening (or an S1-capped M07 assessment, or an M08 program or reflow) is stored: write the
 * safety gates it switched on to the defensibility log IN THE SYNC
 * TRANSACTION (L11). A failed log write rolls the record back and fails the
 * push, so the device retries; a record is never stored without its safety
 * events (fixes M01 deviation 14).
 */
export function profileSyncListener(deps: ProfileSyncDeps): MutationListener<PgServerTx> {
  return async (userId, m, tx) => {
    if (m.collection === PROFILE_COLLECTIONS.screenings) {
      const record = ScreeningRecordSchema.parse(m.data);
      for (const event of safetyEventsFor(record.safetyProfile)) {
        await deps.legal.recordSafetyEvent(userId, { ...event, engineVersion: ENGINE_VERSION }, tx.db);
      }
    } else if (m.collection === ASSESSMENT_COLLECTION) {
      // M07: S1 made the tests stop further from failure (L11), in the same transaction as the record.
      const record = AssessmentRecordSchema.parse(m.data);
      if (record.cappedByS1) {
        await deps.legal.recordSafetyEvent(userId, { invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: record.capacity.engineVersion }, tx.db);
      }
    } else if (m.collection === PROGRAM_COLLECTIONS.programs || m.collection === PROGRAM_COLLECTIONS.reflows) {
      // M08: "program generated" (engine and rules versions) and its S1 caps, or the reflow, in the same transaction as the record.
      await onProgramApplied(deps.legal, userId, m.collection, m.data, tx);
    } else if (m.collection === SESSION_COLLECTIONS.workoutSessions || m.collection === SESSION_COLLECTIONS.executionLogs) {
      // M02: "prescription issued" (engine and rules versions) and its safety events, or the S3 events, in the same transaction as the record.
      await onSessionApplied(deps.legal, userId, m.collection, m.data, tx);
    } else if (m.collection === NUTRITION_COLLECTIONS.plans) {
      // M10: "nutrition target set" (engine and nutrition-rules versions, mode, codes) and its S4 events, in the same transaction as the record.
      await onNutritionApplied(deps.legal, userId, m.collection, m.data, tx);
    }
  };
}

/** Health consent withdrawn: erase the synced health collections in the withdrawal transaction (ADR-004). */
export function healthWithdrawalHandler(): ConsentWithdrawalHandler {
  return async (tx, userId) => {
    await tx.delete(syncChanges).where(and(eq(syncChanges.userId, userId), inArray(syncChanges.collection, [...HEALTH_COLLECTIONS])));
  };
}
