import { evaluateAgeGate, screeningGateCheck } from '@fitadapt/safety';
import type { AssessmentSkipReason, AssessmentTestKind, CalendarDateValue, IntensityLock, JointFlags, SafetyProfile } from '@fitadapt/shared';
import { ageGateDate } from '../local-date.js';
import { ENGINE_VERSION } from '../version.js';
import { blockingReasons, type EquipmentSet, type GraphExercise } from '../substitution.js';
import { assessmentValue, rpeForRir } from './config.js';
import type { AssessmentProtocol, AssessmentTestDefinition } from './protocols.js';

/**
 * Minimum reserve of every assessment test (M07 rule: "tests stop at RIR 2").
 * A constant, not configuration: nothing may lower it.
 */
export const ASSESSMENT_MIN_STOP_RIR = 2 as const;
/** Largest reserve the builder will raise the stop to before declaring the assessment unavailable. */
const MAX_STOP_RIR = 5;

export type AssessmentUnavailableReason =
  | 'assessment.unavailable.blocked'
  | 'assessment.unavailable.not_screened'
  | 'assessment.unavailable.professional_guidance'
  | 'assessment.unavailable.effort_cap'
  | 'assessment.unavailable.s3_intensity_locked'
  | 'assessment.unavailable.s7_age'
  | 'assessment.unavailable.clock_mismatch';

/**
 * The safety facts an assessment needs, all required (SAF-2, SAF-3: an absent
 * fact never reads as "safe"): the S3 lock, the S2 joint flags, the date of
 * birth and local date for the S7 re-check, and the engine time.
 */
export interface AssessmentSafetyFacts {
  readonly jointFlags: JointFlags;
  readonly intensityLock: IntensityLock;
  readonly birthDate: CalendarDateValue | null;
  readonly localDate: CalendarDateValue | null;
  /** The injected clock's time (the engine never reads the system clock). */
  readonly nowMs: number;
}

export interface StopRule {
  /** Stop with at least this many reps in reserve (for holds: this much effort left, see rpe). */
  readonly rir: number;
  /** The same reserve on the RPE scale (RPE = 10 − RIR), for hold tests. */
  readonly rpe: number;
  /** Never to failure: false for every instruction a user can receive without allowMaxTests. */
  readonly toFailure: boolean;
  readonly capReps: number | null;
  readonly capSeconds: number | null;
  readonly windowSeconds: number | null;
}

export interface TestInstruction {
  readonly testId: string;
  readonly kind: AssessmentTestKind;
  readonly messageId: string;
  /** Variants the user may pick (allowed by equipment and SafetyProfile), easiest first. */
  readonly options: readonly string[];
  /** Empty options: the test is skipped for this reason. */
  readonly skipReason: AssessmentSkipReason | null;
  readonly stop: StopRule;
  readonly reasonCodes: readonly string[];
}

export interface AssessmentSafetyEvent {
  readonly invariant: 'S1';
  readonly reasonCode: 'safety.s1.rpe_above_cap' | 'safety.s1.max_test_not_allowed';
  readonly action: 'capped';
  readonly engineVersion: string;
}

export type AssessmentPlan =
  | {
      readonly status: 'available';
      readonly protocolId: AssessmentProtocol['id'];
      readonly protocolVersion: number;
      readonly stopRir: number;
      readonly cappedByS1: boolean;
      readonly instructions: readonly TestInstruction[];
      /** For the defensibility log (L11): S1 gates that changed the tests. */
      readonly safetyEvents: readonly AssessmentSafetyEvent[];
      /** The L3 notice every assessment shows first (packages/legal NOTICES). */
      readonly noticeId: 'assessment';
    }
  | { readonly status: 'unavailable'; readonly reasonCode: AssessmentUnavailableReason };

const rpeFor = rpeForRir;
const value = (key: AssessmentTestDefinition['capReps']) => (key ? assessmentValue(key) : null);

/**
 * The reserve every test stops at for this SafetyProfile: RIR 2, raised while
 * the S1 gate (packages/safety screeningGateCheck) refuses the matching RPE —
 * RIR 3 (RPE 7) while a screening flag is unresolved. Never below 2.
 */
export function assessmentStopRir(profile: SafetyProfile): number | null {
  for (let rir = ASSESSMENT_MIN_STOP_RIR; rir <= MAX_STOP_RIR; rir++) {
    if (screeningGateCheck({ profile, request: { rpe: rpeFor(rir), hiit: false, maximalTest: false } }) === null) return rir;
  }
  return null;
}

/**
 * Builds the guided assessment for a user: which tests, which variants they
 * may pick, and when each test stops. Pure. The S1 gate decides:
 * - maximal (to-failure) tests only with allowMaxTests and no unresolved flag
 *   (screeningGateCheck); otherwise they are given as submaximal tests;
 * - every submaximal test stops at the reserve of assessmentStopRir (≥ 2).
 * Users the screening blocks, did not screen, or routes to professional
 * guidance (S7: no automatic programming) get no assessment. SAF-2: nor do
 * users whose intensity is locked after a red-flag stop (S3: loaded tests to
 * RPE 8 are intensity), users under 16 on the local date (S7), or a device
 * whose date is far from the engine clock; a red joint (S2) removes every
 * option loading it (the test is skipped for safety).
 */
export function buildAssessmentPlan(
  protocol: AssessmentProtocol,
  input: { safetyProfile: SafetyProfile; equipment: EquipmentSet; exercises: ReadonlyMap<string, GraphExercise> } & AssessmentSafetyFacts,
): AssessmentPlan {
  const profile = input.safetyProfile;
  if (profile.screeningOutcome === 'blocked') return { status: 'unavailable', reasonCode: 'assessment.unavailable.blocked' };
  if (profile.screeningOutcome === 'not_screened') return { status: 'unavailable', reasonCode: 'assessment.unavailable.not_screened' };
  if (!profile.automaticProgrammingAllowed || profile.lowIntensityLibraryOnly) return { status: 'unavailable', reasonCode: 'assessment.unavailable.professional_guidance' };
  const stopRir = assessmentStopRir(profile);
  if (stopRir === null) return { status: 'unavailable', reasonCode: 'assessment.unavailable.effort_cap' };
  const gateDate = ageGateDate(input.localDate, input.nowMs);
  if (gateDate === null) return { status: 'unavailable', reasonCode: 'assessment.unavailable.clock_mismatch' };
  if (input.birthDate && evaluateAgeGate(input.birthDate, gateDate).status !== 'allowed') return { status: 'unavailable', reasonCode: 'assessment.unavailable.s7_age' };
  if (input.intensityLock.locked) return { status: 'unavailable', reasonCode: 'assessment.unavailable.s3_intensity_locked' };

  const safetyEvents: AssessmentSafetyEvent[] = [];
  const event = (reasonCode: AssessmentSafetyEvent['reasonCode']) => {
    if (!safetyEvents.some((e) => e.reasonCode === reasonCode)) safetyEvents.push({ invariant: 'S1', reasonCode, action: 'capped', engineVersion: ENGINE_VERSION });
  };
  if (stopRir > ASSESSMENT_MIN_STOP_RIR) event('safety.s1.rpe_above_cap');

  const instructions = protocol.tests.map((t): TestInstruction => {
    const reasonCodes: string[] = [];
    let toFailure = false;
    if (t.effort === 'maximal') {
      const refused = screeningGateCheck({ profile, request: { rpe: rpeFor(0), hiit: false, maximalTest: true } });
      if (refused) {
        event('safety.s1.max_test_not_allowed');
        reasonCodes.push('assessment.stop.max_test_not_allowed');
      } else {
        toFailure = true;
      }
    }
    const rir = toFailure ? 0 : stopRir;
    reasonCodes.push(toFailure ? 'assessment.stop.technical_failure' : stopRir > ASSESSMENT_MIN_STOP_RIR ? 'assessment.stop.s1_reserve' : 'assessment.stop.reserve');

    const options: string[] = [];
    let safetyBlocked = false;
    for (const id of t.options) {
      const exercise = input.exercises.get(id);
      const blocked = exercise ? blockingReasons(exercise, input.equipment, input.jointFlags, profile) : [{ code: 'substitution.equipment_unavailable' }];
      if (blocked.length === 0) options.push(id);
      else if (blocked.some((b) => b.code !== 'substitution.equipment_unavailable')) safetyBlocked = true;
    }
    const skipReason: AssessmentSkipReason | null = options.length > 0 ? null : safetyBlocked ? 'safety' : 'equipment';
    if (skipReason) reasonCodes.push(`assessment.skip.${skipReason}`);
    return {
      testId: t.id,
      kind: t.kind,
      messageId: t.messageId,
      options,
      skipReason,
      stop: { rir, rpe: rpeFor(rir), toFailure, capReps: value(t.capReps), capSeconds: value(t.capSeconds), windowSeconds: value(t.windowSeconds) },
      reasonCodes,
    };
  });

  return { status: 'available', protocolId: protocol.id, protocolVersion: protocol.version, stopRir, cappedByS1: safetyEvents.length > 0, instructions, safetyEvents, noticeId: 'assessment' };
}
