import { featureOn } from '../privacy/consents';
import { notScreenedSafetyProfile, rescreenStatus, evaluateScreening, type RescreenStatus } from '@fitadapt/safety';
import { fixedClock, reassessmentStatus, type ReassessmentStatus } from '@fitadapt/engine';
import type { CapacityModel, ConsentRecord, SafetyProfile } from '@fitadapt/shared';
import type { StoredAssessment, StoredScreening } from './profile-store';

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
