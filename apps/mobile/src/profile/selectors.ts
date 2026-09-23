import { featureOn } from '../privacy/consents';
import { intensityLockStatus, jointFlagsFromPain, notScreenedSafetyProfile, rescreenStatus, evaluateScreening, type RescreenStatus } from '@fitadapt/safety';
import { buildSessionHistory, fixedClock, reassessmentDateFor, reassessmentStatus, type ReassessmentStatus } from '@fitadapt/engine';
import type { CapacityModel, ConsentRecord, IntensityLock, IsoDate, JointFlags, ProgramRecord, ReflowRecord, SafetyProfile, SessionHistoryEntry } from '@fitadapt/shared';
import type { StoredAssessment, StoredExecutionLog, StoredProgram, StoredReflow, StoredScreening, StoredSetLog, StoredWorkout } from './profile-store';

/**
 * The user's SafetyProfile (S1, S4, S7) as every module must read it.
 * Fail-closed:
 * - no health consent (never given or withdrawn) → "not screened" (ADR-004: safety is never traded for privacy);
 * - no screening yet → "not screened";
 * - otherwise the profile is re-derived from the latest answers with the
 *   bundled rules, so a stored profile can never be looser than its answers.
 */
export function selectSafetyProfile(screenings: readonly StoredScreening[], consents: readonly ConsentRecord[]): SafetyProfile {
  if (!featureOn('health.screening', consents)) return notScreenedSafetyProfile('safety_profile.not_screened.no_consent');
  const latest = screenings[screenings.length - 1];
  if (!latest) return notScreenedSafetyProfile('safety_profile.not_screened.incomplete');
  return evaluateScreening(latest.data.responses);
}

/** Re-screen every 12 months or after a newly reported condition (M01). */
export function selectRescreen(screenings: readonly StoredScreening[], newConditionReportedAt: string | null, now: Date): RescreenStatus {
  return rescreenStatus(screenings[screenings.length - 1]?.data.completedAt ?? null, now, newConditionReportedAt);
}

/**
 * M07: the latest CapacityModel, or null. Assessment results are health data:
 * without the health consent the device does not use them (fail closed, like the SafetyProfile).
 */
export function selectCapacity(assessments: readonly StoredAssessment[], consents: readonly ConsentRecord[]): CapacityModel | null {
  if (!featureOn('health.screening', consents)) return null;
  return assessments[assessments.length - 1]?.data.capacity ?? null;
}

/** M07: re-assessment prompt at the end of the mesocycle (engine rule, app clock). */
export function selectReassessment(capacity: CapacityModel | null, now: Date, mesocycleEndsAt: string | null = null): ReassessmentStatus {
  return reassessmentStatus(capacity, fixedClock(now.getTime()), mesocycleEndsAt);
}

/** The device's local calendar date ('YYYY-MM-DD'); programs are planned on the user's own calendar. */
export function localIsoDate(at: Date): IsoDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Local midnight at the start of a calendar date, as an instant. */
export function localMidnight(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** M08: the latest program, or null. Programs embed the SafetyProfile (health data): none without the health consent. */
export function selectProgram(programs: readonly StoredProgram[], consents: readonly ConsentRecord[]): ProgramRecord | null {
  if (!featureOn('health.screening', consents)) return null;
  return programs[programs.length - 1]?.data ?? null;
}

/** M08: the reflows of a program, in the order they were decided. */
export function selectReflows(reflows: readonly StoredReflow[], programId: string | null): ReflowRecord[] {
  return programId ? reflows.map((r) => r.data).filter((r) => r.programId === programId) : [];
}

/**
 * M07 + M08: the re-assessment falls due at the end of the mesocycle the
 * assessment was made in (engine rule, reassessmentDateFor), at local
 * midnight; without a program, or after it, the CapacityModel's default
 * (4 weeks) applies.
 */
export function selectMesocycleEnd(capacity: CapacityModel | null, program: ProgramRecord | null): string | null {
  if (!capacity || !program) return null;
  const due = reassessmentDateFor(program.program, localIsoDate(new Date(capacity.assessedAt)));
  return due ? localMidnight(due).toISOString() : null;
}

/**
 * M02: the engine's history from the device's records (started sessions, set
 * logs, execution events). Health data: nothing without the health consent.
 */
export function selectHistory(workouts: readonly StoredWorkout[], setLogs: readonly StoredSetLog[], executionLogs: readonly StoredExecutionLog[], consents: readonly ConsentRecord[]): SessionHistoryEntry[] {
  if (!featureOn('health.screening', consents)) return [];
  return buildSessionHistory(
    workouts.map((w) => w.data),
    setLogs,
    executionLogs.map((e) => e.data),
  );
}

/** M02 (S2): joint flags from the pain flags logged during sessions (packages/safety; M05 builds the full model). */
export function selectJointFlags(executionLogs: readonly StoredExecutionLog[]): JointFlags {
  return jointFlagsFromPain(executionLogs.flatMap((e) => (e.data.kind === 'pain' ? [{ joint: e.data.joint, score: e.data.score, at: e.data.at }] : [])));
}

/** M02 (S3): intensity stays locked after a red-flag stop until a medical review is attested (packages/safety). */
export function selectIntensityLock(executionLogs: readonly StoredExecutionLog[]): IntensityLock {
  return intensityLockStatus(executionLogs.map((e) => e.data));
}
