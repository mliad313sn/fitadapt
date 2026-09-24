import { S1_RPE_AT_ZERO_RIR } from '@fitadapt/safety';
import { defineConfig } from '@fitadapt/shared';

/**
 * M07 coefficients and thresholds (CLAUDE.md rule 4). Every value is
 * `validated: false`: none has been reviewed by the council (seats A3 S&C
 * coach and A5 exercise physiologist, docs/governance/03 §3). Citations below
 * were compiled by an AI engineering assistant and have NOT been checked
 * against the original papers; "engineering default" means no external source.
 */
const ENG = 'M07 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M07-assessment-benchmarks.md';

export const ASSESSMENT_CONFIG = defineConfig({
  // ---- e1RM (gym tests)
  /** Epley: 1RM = w × (1 + reps / 30). */
  epleyRepDivisor: { value: 30, source: 'Epley B (1985), Poundage chart, as quoted in docs/specs/00-product-vision.md; not checked against the source', validated: false },
  /** Epley is used only while the effective reps (performed reps + reps in reserve) are 1–12 (A3/A5 pre-review #2). */
  epleyMaxReps: {
    value: 12,
    unit: 'effective reps (reps + RIR)',
    source:
      'docs/specs/M02-adaptive-training-engine.md ("valid ≤ 12 reps"); not checked against a primary source. Applied to reps + RIR, not to performed reps only, per docs/governance/ai-reviews/A3-A5-training-science.md (item 2: LeSuer 1997 and Reynolds 2006 as cited there support ≤ 10 better; seat A5 to decide the value)',
    validated: false,
  },
  /** RPE = rpeAtZeroRir − RIR (RIR-based RPE scale); never below packages/safety S1_RPE_AT_ZERO_RIR (rpeForRir). */
  rpeAtZeroRir: {
    value: 10,
    source:
      'Zourdos MC et al. (2016), J Strength Cond Res 30(1):267–275, as listed in docs/specs/00-product-vision.md; not checked against the source. Tied to S1 (CS-8, docs/governance/ai-reviews/A1-A2-clinical-safety.md M07-45): the engine uses max(this, S1_RPE_AT_ZERO_RIR), so it can raise the reserve but never loosen it',
    validated: false,
  },

  // ---- Starting loads from e1RM
  firstSessionTargetReps: { value: 8, unit: 'reps', source: 'docs/specs/M02 rep range example 6–10 (middle value chosen by the engineer)', validated: false },
  firstSessionRepRangeMin: { value: 6, unit: 'reps', source: 'docs/specs/M02 rep range example "6–10"', validated: false },
  firstSessionRepRangeMax: { value: 10, unit: 'reps', source: 'docs/specs/M02 rep range example "6–10"', validated: false },
  /** Starting load = load for the target reps at the target RIR × this factor (a lighter first session). */
  firstSessionLoadFactor: { value: 0.9, source: ENG, validated: false },
  /** Default rounding step when the equipment profile gives none (M02 owns per-equipment increments). */
  defaultLoadIncrementKg: { value: 2.5, unit: 'kg', source: ENG, validated: false },

  // ---- Bodyweight working targets derived from a test
  workingRepsLowFraction: { value: 0.6, source: ENG, validated: false },
  workingRepsHighFraction: { value: 0.8, source: ENG, validated: false },
  workingRepsFloor: { value: 3, unit: 'reps', source: ENG, validated: false },
  defaultRepsMin: { value: 5, unit: 'reps', source: ENG, validated: false },
  defaultRepsMax: { value: 8, unit: 'reps', source: ENG, validated: false },
  workingHoldFraction: { value: 0.6, source: ENG, validated: false },
  workingHoldFloorSeconds: { value: 10, unit: 's', source: ENG, validated: false },
  defaultHoldSeconds: { value: 15, unit: 's', source: ENG, validated: false },

  // ---- Protocol choice and re-assessment
  olderAdultProtocolAge: {
    value: 55,
    unit: 'years',
    source: `${SPEC} ("30-second chair stand (Jones et al., 1999, for 55+)"). Jones et al. validated the test in adults over 60; 55 is a product choice (a conservative extrapolation), per docs/governance/ai-reviews/A1-A2-clinical-safety.md M07-41`,
    validated: false,
  },
  chairStandWindowSeconds: { value: 30, unit: 's', source: 'Jones CJ, Rikli RE, Beam WC (1999), Res Q Exerc Sport 70(2):113–119, as quoted in the M07 spec; not checked against the source', validated: false },
  defaultMesocycleWeeks: { value: 4, unit: 'weeks', source: `${SPEC} ("end of each mesocycle (4–6 weeks)"); lower bound chosen by the engineer until M08 sets the real end`, validated: false },
  restBetweenTestsSeconds: { value: 60, unit: 's', source: ENG, validated: false },

  // ---- Mapping thresholds (result → rung): below stayMin one step down, from promoteAt one step up
  'push_reps.stayMin': { value: 5, unit: 'reps', source: ENG, validated: false },
  'push_reps.promoteAt': { value: 15, unit: 'reps', source: ENG, validated: false },
  'push_reps.capReps': { value: 25, unit: 'reps', source: ENG, validated: false },
  'dead_hang_hold.stayMin': { value: 10, unit: 's', source: ENG, validated: false },
  'dead_hang_hold.promoteAt': { value: 30, unit: 's', source: ENG, validated: false },
  'dead_hang_hold.capSeconds': { value: 45, unit: 's', source: ENG, validated: false },
  'row_reps.stayMin': { value: 5, unit: 'reps', source: ENG, validated: false },
  'row_reps.promoteAt': { value: 12, unit: 'reps', source: ENG, validated: false },
  'row_reps.capReps': { value: 20, unit: 'reps', source: ENG, validated: false },
  'squat_reps.stayMin': { value: 8, unit: 'reps', source: ENG, validated: false },
  'squat_reps.promoteAt': { value: 25, unit: 'reps', source: ENG, validated: false },
  'squat_reps.capReps': { value: 30, unit: 'reps', source: ENG, validated: false },
  'plank_hold.stayMin': { value: 20, unit: 's', source: ENG, validated: false },
  'plank_hold.promoteAt': { value: 60, unit: 's', source: ENG, validated: false },
  'plank_hold.capSeconds': { value: 90, unit: 's', source: ENG, validated: false },
  'chair_stand.stayMin': { value: 8, unit: 'reps', source: `${ENG}; not a Jones et al. norm (the test here stops at a reserve, so counts are lower than in the published protocol)`, validated: false },
  'chair_stand.promoteAt': { value: 14, unit: 'reps', source: `${ENG}; not a Jones et al. norm`, validated: false },
  'push_reps_55.stayMin': { value: 5, unit: 'reps', source: ENG, validated: false },
  'push_reps_55.promoteAt': { value: 15, unit: 'reps', source: ENG, validated: false },
  'push_reps_55.capReps': { value: 20, unit: 'reps', source: ENG, validated: false },
  'plank_hold_55.stayMin': { value: 15, unit: 's', source: ENG, validated: false },
  'plank_hold_55.promoteAt': { value: 45, unit: 's', source: ENG, validated: false },
  'plank_hold_55.capSeconds': { value: 60, unit: 's', source: ENG, validated: false },
  /** Loaded tests: a set of this many reps at most (above it Epley is not used). */
  'load.capReps': { value: 12, unit: 'reps', source: 'docs/specs/M02 ("Epley, valid ≤ 12 reps")', validated: false },

  // ---- Estimated durations (home protocol ≤ 15 min, M07 spec)
  'minutes.reps': { value: 2, unit: 'min', source: ENG, validated: false },
  'minutes.hold': { value: 2, unit: 'min', source: ENG, validated: false },
  'minutes.timed_reps': { value: 2, unit: 'min', source: ENG, validated: false },
  'minutes.load_reps': { value: 5, unit: 'min', source: `${ENG} (includes warm-up sets)`, validated: false },
});

export type AssessmentConfigKey = keyof typeof ASSESSMENT_CONFIG;

export function assessmentValue(key: AssessmentConfigKey): number {
  return ASSESSMENT_CONFIG[key].value;
}

/**
 * First-session prescription values (M07 → M02). M02 replaces these with its
 * own session rules; until then they are the only prescription coefficients.
 */
export const FIRST_SESSION_CONFIG = defineConfig({
  setsPerExercise: { value: 2, unit: 'sets', source: `${ENG} (a short, easy first session)`, validated: false },
  /** Reserve for first-session sets when S1 allows it (RIR 3 ≈ RPE 7). */
  targetRir: { value: 3, unit: 'reps', source: ENG, validated: false },
  warmUpMinutes: { value: 5, unit: 'min', source: ENG, validated: false },
  secondsPerRep: { value: 3, unit: 's', source: ENG, validated: false },
  restSecondsBodyweight: { value: 90, unit: 's', source: ENG, validated: false },
  restSecondsLoaded: { value: 120, unit: 's', source: ENG, validated: false },
});

export function firstSessionValue(key: keyof typeof FIRST_SESSION_CONFIG): number {
  return FIRST_SESSION_CONFIG[key].value;
}

/**
 * RPE on the RIR-based scale for a reserve (CS-8): the anchor is the S1
 * invariant's (packages/safety S1_RPE_AT_ZERO_RIR); the configured
 * `rpeAtZeroRir` can only raise it. Every S1 check of a reserve goes through
 * here, so no coefficient change can make a reserve pass S1 at a lower RPE.
 */
export function rpeForRir(rir: number): number {
  return Math.max(assessmentValue('rpeAtZeroRir'), S1_RPE_AT_ZERO_RIR) - rir;
}
