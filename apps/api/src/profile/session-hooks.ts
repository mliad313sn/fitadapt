import { isDeepStrictEqual } from 'node:util';
import {
  ENGINE_VERSION,
  SESSION_RULES_VERSION,
  buildSessionHistory,
  consistentTraining,
  createEngineContext,
  defaultEquipmentLoads,
  deloadStatus,
  painReportsFrom,
  readinessCheckOn,
  readinessFromCheck,
  safetyStopsFrom,
  fixedClock,
  programDay,
  programSessionContext,
  s5Violations,
  type StoredSetLog,
} from '@fitadapt/engine';
import { generateSession } from '@fitadapt/exercise-library';
import { classifyPainReport, intensityLockStatus, jointFlagsFromPain } from '@fitadapt/safety';
import {
  ASSESSMENT_COLLECTION,
  AssessmentRecordSchema,
  EquipmentProfileSchema,
  ExecutionLogSchema,
  GenerateSessionInputSchema,
  PROFILE_COLLECTIONS,
  PROFILE_RECORD_ID,
  JOINTS,
  PROGRAM_COLLECTIONS,
  ProfileSchema,
  ProgramRecordSchema,
  RECOVERY_COLLECTIONS,
  ReadinessCheckSchema,
  SESSION_COLLECTIONS,
  SetLogSchema,
  WorkoutSessionRecordSchema,
  type ExecutionLog,
  type SafetyProfile,
  type WorkoutSessionRecord,
} from '@fitadapt/shared';
import type { z } from 'zod';
import { ApiError } from '../auth/errors.js';
import type { DbExecutor } from '../db/client.js';
import type { LegalService } from '../legal/service.js';
import { clientTimeInRange } from '../lib/client-time.js';
import type { PgServerTx } from '../sync/pg-store.js';
import { screeningsAgreeOnBirthDate } from './screenings.js';
import { retainedIntensityLock } from './intensity-lock.js';
import { orderedReflows } from './program-hooks.js';
import { collectionRows, latestRecordRow, parsedRows } from './stored-rows.js';

/**
 * M02 on the server (ADR-016). A started session (collection
 * `workout_sessions`) is the executed prescription with every input it was
 * generated from. The server refuses it unless:
 * - the first-workout gate (L2) is open for the user in the recorded jurisdiction;
 * - it was made by this engine and these session rules;
 * - its inputs match what the server stores: the SafetyProfile of the latest
 *   screening (S1/S7), the S3 lock from the stored execution logs, the
 *   equipment profile and its loads, the capacity model of a stored
 *   assessment, the program session of the stored program after its reflows,
 *   the profile's date of birth (S7);
 * - no load exceeds the S5 ceiling given every session the server stores;
 * - re-running the engine on those inputs (recorded clock and seed) gives
 *   exactly the plan and safety events recorded.
 * Then "prescription issued" (engine and rules versions, reason codes) and
 * the plan's safety events are written IN THE SYNC TRANSACTION (ADR-009).
 * Execution logs (health data): an S3 red flag (in a session or at an M05
 * check-in) writes "session ended" and "intensity locked"; an attested
 * medical review writes `safety.attested`; an M05 pain report that makes a
 * joint red writes an S2 "joint flagged". M05 also checks that the joint
 * flags are at least as strict as the stored pain reports (S2), that a
 * triggered deload the stored records imply is applied, and that a low
 * readiness check of that day is.
 */

/** API-11: stored rows are read through the per-push cache (profile/stored-rows.ts). */
const rows = collectionRows;

/** What the server stores about the user's execution: sessions, set logs, execution logs (in the order stored). */
async function storedExecution(db: DbExecutor, userId: string) {
  const sessions = parsedRows(await rows(db, userId, SESSION_COLLECTIONS.workoutSessions), WorkoutSessionRecordSchema).map((r) => r.data);
  const setLogs: StoredSetLog[] = parsedRows(await rows(db, userId, SESSION_COLLECTIONS.setLogs), SetLogSchema);
  const events: ExecutionLog[] = parsedRows(await rows(db, userId, SESSION_COLLECTIONS.executionLogs), ExecutionLogSchema).map((r) => r.data);
  return { sessions, setLogs, events };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/** The latest stored state of one record: a single indexed row (API-11), never the whole collection. */
async function latestState<S extends z.ZodType>(db: DbExecutor, userId: string, collection: string, recordId: string, schema: S): Promise<z.infer<S> | null> {
  const last = await latestRecordRow(db, userId, collection, recordId);
  if (!last || last.op === 'delete') return null;
  const p = schema.safeParse(last.data);
  return p.success ? p.data : null;
}

async function checkInputs(db: DbExecutor, userId: string, record: WorkoutSessionRecord, latestProfile: SafetyProfile, now: Date): Promise<string | null> {
  const { input, plan } = record;
  // S1/S7: the SafetyProfile of the latest stored screening, never a looser one.
  if (!isDeepStrictEqual(input.safetyProfile, latestProfile)) return 'session.safety_profile_mismatch';
  // S7 (M17 age gate): the date of birth of the stored profile.
  const profile = await latestState(db, userId, PROFILE_COLLECTIONS.profile, PROFILE_RECORD_ID, ProfileSchema);
  if (profile && !isDeepStrictEqual(input.birthDate ?? null, profile.birthDate)) return 'session.profile_mismatch';
  // API-5: the screening behind the SafetyProfile states the same date of birth as the profile.
  if (profile && !(await screeningsAgreeOnBirthDate(db, userId, profile.birthDate))) return 'session.profile_mismatch';
  // M03: the impact default (BMI ≥ 35) of every session reads the stored height and weight, never other numbers.
  if (profile && ((input.heightCm ?? null) !== profile.biometrics.heightCm || (input.bodyweightKg ?? null) !== profile.biometrics.weightKg)) return 'session.biometrics_mismatch';
  // S3: the lock the stored execution logs imply.
  const { sessions, setLogs, events } = await storedExecution(db, userId);
  const lock = intensityLockStatus(events);
  if (lock.locked) return 'safety.s3.intensity_locked';
  // MOB-08: and the lock the server retains apart from the erasable logs (it survives a health-consent withdrawal).
  if ((await retainedIntensityLock(db, userId)).locked) return 'safety.s3.intensity_locked';
  if (!isDeepStrictEqual(input.intensityLock ?? { locked: false, since: null }, lock)) return 'session.lock_mismatch';
  // M05 S2: the joint flags are at least as strict as the pain reports the server stores (red stays red, amber at least amber).
  const flags = jointFlagsFromPain(painReportsFrom(events));
  for (const joint of JOINTS) {
    const sent = input.jointFlags?.[joint];
    if (flags[joint] === 'red' && sent !== 'red') return 'safety.s2.joint_flags_mismatch';
    if (flags[joint] === 'amber' && sent !== 'amber' && sent !== 'red') return 'safety.s2.joint_flags_mismatch';
  }
  // M05: a triggered deload the stored records imply must be applied; a low readiness check that day must be too.
  const readiness = parsedRows(await rows(db, userId, RECOVERY_COLLECTIONS.readinessChecks), ReadinessCheckSchema).map((r) => r.data);
  const history = buildSessionHistory(sessions, setLogs, events);
  // M03 HIIT ramp: the engine reads the device-sent history for the first-exposure ramp; it may never claim more
  // completed HIIT sessions than the records the server stores give (that would skip the ramp).
  const hiitDone = (entries: readonly { hiitCompleted?: boolean }[]) => entries.filter((e) => e.hiitCompleted === true).length;
  if (hiitDone(input.history ?? []) > hiitDone(history)) return 'session.history_mismatch';
  // M03: HIIT needs ≥ 2 weeks of consistent training in the records the server stores (not only in the history the device sent).
  if (plan.cardio?.hiit && !consistentTraining(history, Date.parse(plan.generatedAt))) return 'session.hiit_not_allowed';
  const deload = deloadStatus({ asOfMs: Date.parse(plan.generatedAt), painReports: painReportsFrom(events), safetyStops: safetyStopsFrom(events), history, readinessChecks: readiness });
  if (deload && !isDeepStrictEqual(input.deload ?? null, deload)) return 'session.deload_mismatch';
  const day = input.programSession?.session.date ?? plan.generatedAt.slice(0, 10);
  const check = readinessCheckOn(readiness, day);
  if (check && readinessFromCheck(check).level === 'reduced' && input.readiness !== 'reduced' && input.mode !== 'mobility_balance') return 'session.readiness_mismatch';
  // The place: a stored equipment profile with the same equipment and loads (its own, or the location's defaults).
  if (input.equipmentProfileId) {
    const place = await latestState(db, userId, PROFILE_COLLECTIONS.equipmentProfiles, input.equipmentProfileId, EquipmentProfileSchema);
    if (!place || !sameSet(place.equipment, input.equipment)) return 'session.equipment_mismatch';
    if (!isDeepStrictEqual(input.equipmentLoads ?? null, place.loads ?? defaultEquipmentLoads(place.location))) return 'session.equipment_mismatch';
  }
  // M07: the capacity model of a stored assessment.
  if (input.capacity) {
    const assessments = parsedRows(await rows(db, userId, ASSESSMENT_COLLECTION), AssessmentRecordSchema);
    if (!assessments.some((a) => isDeepStrictEqual(a.data.capacity, input.capacity))) return 'session.capacity_mismatch';
  }
  // M08: the session of the stored program on that date, after the stored reflows.
  if (input.programSession) {
    const programs = parsedRows(await rows(db, userId, PROGRAM_COLLECTIONS.programs), ProgramRecordSchema).map((r) => r.data);
    const program = programs.find((p) => p.program.programId === input.programSession!.programId)?.program;
    if (!program) return 'session.program_mismatch';
    // ADR-023: in the device's replay order (the reflows' chain), not the push order.
    const reflows = orderedReflows(await rows(db, userId, PROGRAM_COLLECTIONS.reflows), program.programId);
    const day = programDay(program, reflows, input.programSession.session.date);
    const session = day?.sessions.find((s) => s.id === input.programSession!.session.id);
    if (!day || !session || !isDeepStrictEqual(programSessionContext(day, session), input.programSession)) return 'session.program_mismatch';
  }
  // S5 against every session the server stores (not only the history the device sent).
  // SAF-5: also at the server's time when the plan claims a later one (within the clock skew), so a clock moved
  // forward never drops a reference out of the 7-day window.
  const s5At = new Date(Math.min(Date.parse(plan.generatedAt), now.getTime())).toISOString();
  if (s5Violations(plan, history, input.recentLoads ?? []).length > 0 || s5Violations({ ...plan, generatedAt: s5At }, history, input.recentLoads ?? []).length > 0) return 'safety.s5.load_above_ceiling';
  return null;
}

export async function validateWorkoutSession(db: DbExecutor, legal: LegalService, userId: string, data: unknown, latestProfile: SafetyProfile, now: Date): Promise<string | null> {
  const parsed = WorkoutSessionRecordSchema.safeParse(data);
  if (!parsed.success) return 'session.invalid';
  const record = parsed.data;
  if (record.plan.engineVersion !== ENGINE_VERSION || record.plan.rulesVersion !== SESSION_RULES_VERSION) return 'session.engine_version_unsupported';
  // API-5 / SAF-5: the plan's clock drives the S5 window, the deload, the readiness day and the HIIT gate:
  // it must be plausible against the server's clock (no moving it forward past a window, no backdating
  // beyond the offline window).
  if (!clientTimeInRange(record.plan.generatedAt, now) || !clientTimeInRange(record.startedAt, now)) return 'session.client_time_out_of_range';
  // L2: the first workout (and every later one) needs the current Terms, Privacy, health consent and exercise-risk acknowledgment.
  try {
    await legal.requireFirstWorkoutAcceptance(userId, record.jurisdiction, db);
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  const mismatch = await checkInputs(db, userId, record, latestProfile, now);
  if (mismatch) return mismatch;
  // SAF-3 (FIX-A): a stored input may predate the required safety facts; a new session must carry them all (fail closed).
  const input = GenerateSessionInputSchema.safeParse(record.input);
  if (!input.success) return 'session.invalid';
  let expected;
  try {
    expected = generateSession(input.data, createEngineContext({ clock: fixedClock(Date.parse(record.plan.generatedAt)), seed: record.plan.seed }));
  } catch {
    return 'session.invalid';
  }
  if (expected.status !== 'ok') return 'session.not_allowed';
  if (!isDeepStrictEqual(expected.plan, record.plan) || !isDeepStrictEqual([...expected.safetyEvents], record.safetyEvents)) return 'session.mismatch';
  return null;
}

export async function validateExecutionLog(db: DbExecutor, userId: string, data: unknown): Promise<string | null> {
  const parsed = ExecutionLogSchema.safeParse(data);
  if (!parsed.success) return 'execution_log.invalid';
  const log = parsed.data;
  if (log.kind !== 'cardio_done') return null;
  // M03: a cardio log belongs to a stored session with a cardio block, and never counts more than that block planned (the weekly ledger).
  const sessions = parsedRows(await rows(db, userId, SESSION_COLLECTIONS.workoutSessions), WorkoutSessionRecordSchema).map((r) => r.data);
  const block = sessions.find((r) => r.plan.planId === log.planId)?.plan.cardio;
  if (!block || block.protocol !== log.protocol) return 'execution_log.cardio_unknown_block';
  const work = block.timeline.filter((s) => ['work', 'emom_minute', 'amrap', 'steady'].includes(s.kind)).length;
  if (log.moderateSeconds > block.planned.moderateSeconds || log.vigorousSeconds > block.planned.vigorousSeconds || log.totalWork !== work || log.completedWork > work) return 'execution_log.cardio_mismatch';
  return null;
}

/** Every reason code a plan carries, once (plan, exercises, sets). */
export function planReasonCodes(record: WorkoutSessionRecord): string[] {
  const { plan } = record;
  const cardio = plan.cardio ? [...plan.cardio.reasonCodes, ...plan.cardio.zones.reasonCodes] : [];
  return [...new Set([...plan.reasonCodes, ...plan.exercises.flatMap((e) => [...e.reasonCodes, ...e.sets.flatMap((s) => s.reasonCodes)]), ...cardio])];
}

/** In the sync transaction: the prescription and its safety events commit with the record, or neither does. */
export async function onSessionApplied(legal: LegalService, userId: string, collection: string, data: unknown, tx: PgServerTx): Promise<void> {
  if (collection === SESSION_COLLECTIONS.workoutSessions) {
    const record = WorkoutSessionRecordSchema.parse(data);
    await legal.recordPrescription(userId, { prescriptionId: record.plan.planId, engineVersion: record.plan.engineVersion, rulesVersion: record.plan.rulesVersion, reasonCodes: planReasonCodes(record) }, tx.db);
    for (const event of record.safetyEvents) await legal.recordSafetyEvent(userId, event, tx.db);
  } else if (collection === SESSION_COLLECTIONS.executionLogs) {
    const log = ExecutionLogSchema.parse(data);
    if (log.kind === 'pain' && classifyPainReport(log) === 'red') {
      // M05 S2: a pain report of ≥ 6, or a next-morning check that has not settled, makes the joint red for the next session.
      await legal.recordSafetyEvent(userId, { invariant: 'S2', reasonCode: `safety.s2.joint_red.${log.joint}`, action: 'joint_flagged', engineVersion: ENGINE_VERSION }, tx.db);
    } else if (log.kind === 'red_flag') {
      await legal.recordSafetyEvent(userId, { invariant: 'S3', reasonCode: `safety.s3.${log.symptom}`, action: 'session_ended', engineVersion: ENGINE_VERSION }, tx.db);
      await legal.recordSafetyEvent(userId, { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: ENGINE_VERSION }, tx.db);
    } else if (log.kind === 'medical_review_attested') {
      await legal.recordSafetyAttested(userId, { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: ENGINE_VERSION }, tx.db);
    }
  }
}
