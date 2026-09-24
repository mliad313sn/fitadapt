import { defineConfig } from '@fitadapt/shared';

/**
 * M05 recovery coefficients and thresholds (CLAUDE.md rule 4): warm-up and
 * cool-down composition, readiness scoring, deload triggers and size. Every
 * value is `validated: false` — none has been reviewed by the council
 * (seats A3 S&C coach and A5 exercise physiologist for warm-ups, readiness
 * and deloads; A2 physiotherapist for the pain-related triggers; A1 for the
 * red-flag deload). "Engineering default" means no external source: the
 * engineer chose a conservative value. Values quoted from the M05 spec are the
 * spec's own examples ("e.g.", "~"), not checked against any primary source.
 *
 * The pain traffic light (amber 4, red 6 = S2) and the physiotherapist
 * persistence rule live in packages/safety (PAIN_CONFIG, S2_RED_PAIN_SCORE);
 * the warm-up total (5–8 min) is SESSION_CONFIG `warmUp.*` (M02).
 */
const ENG = 'M05 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M05-recovery-mobility-pain-safety.md';

export const RECOVERY_RULES_VERSION = '0.1.0';

export const RECOVERY_CONFIG = defineConfig({
  // ---- Warm-up (total from SESSION_CONFIG warmUp.minutes / minimumMinutes: 5–8 min)
  'warmUp.generalSecondsShort': { value: 120, unit: 's', source: `${SPEC} (Scope: "2–3 min general"), lower bound, used for warm-ups under 7 minutes`, validated: false },
  'warmUp.generalSecondsLong': { value: 180, unit: 's', source: `${SPEC} (Scope: "2–3 min general"), upper bound`, validated: false },
  'warmUp.longFromMinutes': { value: 7, unit: 'min', source: ENG, validated: false },
  'warmUp.drillMinSeconds': { value: 30, unit: 's', source: ENG, validated: false },
  'warmUp.drillMaxSeconds': { value: 60, unit: 's', source: ENG, validated: false },
  'rampUp.percent1': { value: 40, unit: '% of working load', source: `${SPEC} (Scope: "e.g., ~40/60/80% of working load")`, validated: false },
  'rampUp.percent2': { value: 60, unit: '% of working load', source: `${SPEC} (Scope: "e.g., ~40/60/80% of working load")`, validated: false },
  'rampUp.percent3': { value: 80, unit: '% of working load', source: `${SPEC} (Scope: "e.g., ~40/60/80% of working load")`, validated: false },
  'rampUp.reps1': { value: 8, unit: 'reps', source: ENG, validated: false },
  'rampUp.reps2': { value: 5, unit: 'reps', source: ENG, validated: false },
  'rampUp.reps3': { value: 3, unit: 'reps', source: ENG, validated: false },
  /** Transition after each ramp-up set (short: the loads are light). */
  'rampUp.restSeconds': { value: 30, unit: 's', source: ENG, validated: false },
  /** A warm-up shorter than this drops the lightest ramp-up set to keep room for mobility. */
  'rampUp.threeSetsFromMinutes': { value: 7, unit: 'min', source: ENG, validated: false },

  // ---- Cool-down (only with time left in the session)
  'coolDown.minSeconds': { value: 120, unit: 's', source: ENG, validated: false },
  'coolDown.maxMinutes': { value: 5, unit: 'min', source: ENG, validated: false },
  'coolDown.drillSeconds': { value: 60, unit: 's', source: ENG, validated: false },

  // ---- Readiness (optional 10-second check, 1–5 answers; M12 wearable readings optional)
  /** Score (0–100) below which the day is "reduced": one set fewer per exercise, one more rep in reserve (M02 rules). */
  'readiness.lowScore': { value: 50, unit: 'score 0–100', source: ENG, validated: false },
  /** HRV this fraction below its baseline lowers the score. */
  'readiness.hrvDropFraction': { value: 0.1, source: ENG, validated: false },
  'readiness.hrvPenalty': { value: 10, unit: 'score points', source: ENG, validated: false },
  /** Resting heart rate this many beats above its baseline lowers the score. */
  'readiness.restingHrRiseBpm': { value: 5, unit: 'bpm', source: ENG, validated: false },
  'readiness.restingHrPenalty': { value: 10, unit: 'score points', source: ENG, validated: false },

  // ---- Deloads (triggered; the scheduled ones are M08's deload weeks)
  /** Share of the session's sets removed in a triggered deload ("volume −40–50%"): the upper end, then rounded to whole sets. */
  'deload.volumeReduction': { value: 0.5, source: `${SPEC} (Scope: "volume −40–50%"); upper end chosen by the engineer (conservative)`, validated: false },
  'deload.triggeredDays': { value: 7, unit: 'days', source: ENG, validated: false },
  /** "Two amber weeks": amber or red pain reports this many days apart at least … */
  'deload.amberWeeksMinGapDays': { value: 7, unit: 'days', source: `${SPEC} (Scope: "two amber weeks")`, validated: false },
  /** … and at most this many days apart. */
  'deload.amberWeeksMaxGapDays': { value: 14, unit: 'days', source: `${SPEC} (Scope: "two amber weeks")`, validated: false },
  /** "Performance drop": the best set of an exercise this fraction below its previous session. */
  'deload.performanceDropFraction': { value: 0.05, source: ENG, validated: false },
  'deload.performanceDropSessions': { value: 2, unit: 'sessions', source: `${SPEC} (Scope: "performance drop two sessions running")`, validated: false },
  'deload.lowReadinessDays': { value: 3, unit: 'days', source: `${SPEC} (Scope: "low readiness three days")`, validated: false },

  // ---- Standalone mobility and balance sessions (P4, 55+)
  /**
   * Note (A1/A2 pre-review M05-32): ACSM 2011 (Garber et al., as cited there from search summaries, not checked) gives
   * 10–30 s holds for most adults and 30–60 s for older adults (about 60 s in total per stretch). The value is unchanged:
   * a longer hold changes the benefit more than the safety; seats A3, A2 and A1 decide (for 55+: 30 s × 2 suggested).
   */
  'mobility.holdSeconds': { value: 20, unit: 's', source: `${ENG}. Not aligned yet with ACSM 2011 for older adults (30–60 s), see docs/governance/ai-reviews/A1-A2-clinical-safety.md M05-32`, validated: false },
  'mobility.sets': { value: 2, unit: 'sets', source: ENG, validated: false },
  'mobility.restSeconds': { value: 30, unit: 's', source: ENG, validated: false },
  'mobility.targetRir': { value: 4, unit: 'reps', source: ENG, validated: false },
});

export type RecoveryConfigKey = keyof typeof RECOVERY_CONFIG;
export const recoveryValue = (key: RecoveryConfigKey): number => RECOVERY_CONFIG[key].value;
