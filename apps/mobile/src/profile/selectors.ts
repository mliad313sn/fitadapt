import { featureOn } from '../privacy/consents';
import { intensityLockStatus, jointFlagsFromPain, lastScreenedAt, notScreenedSafetyProfile, physioRecommendations, rescreenStatus, safetyProfileFromScreenings, type PhysioRecommendation, type RescreenStatus } from '@fitadapt/safety';
import { buildSessionHistory, deloadStatus, fixedClock, painReportsFrom, readinessLevelOn, reassessmentDateFor, reassessmentStatus, safetyStopsFrom, type ReassessmentStatus } from '@fitadapt/engine';
import type { CapacityModel, ConsentRecord, DeloadEvent, IntensityLock, IsoDate, Joint, JointFlags, ProgramRecord, ReadinessCheck, ReflowRecord, SafetyProfile, SessionHistoryEntry } from '@fitadapt/shared';
import { latestAssessment, latestProgram } from './history';
import type { StoredAssessment, StoredExecutionLog, StoredProgram, StoredReadinessCheck, StoredReflow, StoredScreening, StoredSetLog, StoredWorkout } from './profile-store';

/**
 * The user's SafetyProfile (S1, S4, S7) as every module must read it.
 * Fail-closed:
 * - no health consent (never given or withdrawn) → "not screened" (ADR-004: safety is never traded for privacy);
 * - no screening yet → "not screened";
 * - otherwise the profile is re-derived from the latest answers with the
 *   bundled rules, so a stored profile can never be looser than its answers;
 * - "latest" is the head of the screenings' `supersedes` chain, never the
 *   newest timestamp (ADR-023); several heads → the strictest combination.
 *   The server derives it with the same function (packages/safety).
 */
export function selectSafetyProfile(screenings: readonly StoredScreening[], consents: readonly ConsentRecord[]): SafetyProfile {
  if (!featureOn('health.screening', consents)) return notScreenedSafetyProfile('safety_profile.not_screened.no_consent');
  return safetyProfileFromScreenings(screenings);
}

/** Re-screen every 12 months or after a newly reported condition (M01); several heads → the earliest (due soonest). */
export function selectRescreen(screenings: readonly StoredScreening[], newConditionReportedAt: string | null, now: Date): RescreenStatus {
  return rescreenStatus(lastScreenedAt(screenings), now, newConditionReportedAt);
}

/**
 * M07: the latest CapacityModel, or null. Assessment results are health data:
 * without the health consent the device does not use them (fail closed, like the SafetyProfile).
 */
export function selectCapacity(assessments: readonly StoredAssessment[], consents: readonly ConsentRecord[]): CapacityModel | null {
  if (!featureOn('health.screening', consents)) return null;
  // ADR-023: the head of the assessments' chain (several → the most conservative).
  return latestAssessment(assessments)?.data.capacity ?? null;
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
  // ADR-023: the head of the programs' chain (several → the one made on the strictest SafetyProfile).
  return latestProgram(programs)?.data ?? null;
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

/** S2: joint flags from the M05 pain-monitoring model over every pain report (during, after the session, next morning). */
export function selectJointFlags(executionLogs: readonly StoredExecutionLog[]): JointFlags {
  return jointFlagsFromPain(painReportsFrom(executionLogs.map((e) => e.data)));
}

/** M05: amber or red on the same joint for more than two weeks → suggest a physiotherapist. */
export function selectPhysio(executionLogs: readonly StoredExecutionLog[], now: Date): PhysioRecommendation[] {
  return physioRecommendations(painReportsFrom(executionLogs.map((e) => e.data)), now.getTime());
}

/** M05: the readiness checks (health data: none without the health consent). */
export function selectReadinessChecks(checks: readonly StoredReadinessCheck[], consents: readonly ConsentRecord[]): ReadinessCheck[] {
  return featureOn('health.screening', consents) ? checks.map((c) => c.data) : [];
}

/** M05: generateSession's readiness for today ('reduced' only after a low check today; no check → no adjustment). */
export function selectReadiness(checks: readonly ReadinessCheck[], today: IsoDate): 'normal' | 'reduced' | undefined {
  return readinessLevelOn(checks, today);
}

/** M05: the triggered deload in force at `atMs` (the same derivation as the server's, at the plan's generation time). */
export function selectDeload(executionLogs: readonly StoredExecutionLog[], history: readonly SessionHistoryEntry[], checks: readonly ReadinessCheck[], atMs: number): DeloadEvent | null {
  const logs = executionLogs.map((e) => e.data);
  return deloadStatus({ asOfMs: atMs, painReports: painReportsFrom(logs), safetyStops: safetyStopsFrom(logs), history, readinessChecks: checks });
}

/**
 * M05 next-morning check: joints rated above 0 in (or after) a session on an
 * earlier day, within the last two days, with no next-morning answer since.
 */
export function selectMorningCheck(executionLogs: readonly StoredExecutionLog[], now: Date): Joint[] {
  const today = localIsoDate(now);
  const due = new Map<Joint, boolean>();
  for (const { data: e } of executionLogs) {
    if (e.kind !== 'pain') continue;
    if (e.phase === 'next_morning') {
      due.set(e.joint, false);
      continue;
    }
    const at = new Date(e.at);
    const recent = now.getTime() - at.getTime() <= 2 * 86_400_000;
    due.set(e.joint, e.score > 0 && recent && localIsoDate(at) < today);
  }
  return [...due].filter(([, d]) => d).map(([j]) => j);
}

/** M02 (S3): intensity stays locked after a red-flag stop until a medical review is attested (packages/safety). */
export function selectIntensityLock(executionLogs: readonly StoredExecutionLog[]): IntensityLock {
  return intensityLockStatus(executionLogs.map((e) => e.data));
}
