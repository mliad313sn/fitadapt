import { defineConfig } from '@fitadapt/shared';

/**
 * M02 session coefficients and thresholds (CLAUDE.md rule 4). Every value is
 * `validated: false`: none has been reviewed by the council (seats A3 S&C
 * coach, A5 exercise physiologist; A2 physiotherapist for joint-related
 * rules — docs/governance/03 §3). "Engineering default" means no external
 * source: the engineer chose a conservative value. Values quoted from the
 * M02 spec are the spec's own examples ("e.g.", "~"), not checked against any
 * primary source. Nothing here is a published norm.
 *
 * The safety invariants the session obeys (S1 RPE cap, S2 red joint, S3
 * lock, S5 +10 %/7 days, S7) are constants in packages/safety, never here.
 */
const ENG = 'M02 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M02-adaptive-training-engine.md';

/** 0.2.0 (M05): warm-up content, cool-down, triggered deloads, amber variant hints, mobility sessions. 0.3.0 (M03): cardio blocks, the HIIT training-history gate, cardio sessions. */
export const SESSION_RULES_VERSION = '0.3.0';

export const SESSION_CONFIG = defineConfig({
  // ---- Rep ranges by slot intent (double progression works inside the range)
  'repRange.strength.min': { value: 4, unit: 'reps', source: ENG, validated: false },
  'repRange.strength.max': { value: 6, unit: 'reps', source: ENG, validated: false },
  /** Primary slots of a hypertrophy block: the spec's strength-hypertrophy example. */
  'repRange.hypertrophyPrimary.min': { value: 6, unit: 'reps', source: `${SPEC} (Rules: "e.g., 6–10 strength-hypertrophy")`, validated: false },
  'repRange.hypertrophyPrimary.max': { value: 10, unit: 'reps', source: `${SPEC} (Rules: "e.g., 6–10 strength-hypertrophy")`, validated: false },
  'repRange.hypertrophy.min': { value: 8, unit: 'reps', source: `${SPEC} (Rules: "8–15 hypertrophy")`, validated: false },
  'repRange.hypertrophy.max': { value: 15, unit: 'reps', source: `${SPEC} (Rules: "8–15 hypertrophy")`, validated: false },
  'repRange.general.min': { value: 8, unit: 'reps', source: ENG, validated: false },
  'repRange.general.max': { value: 12, unit: 'reps', source: ENG, validated: false },
  'repRange.skill.min': { value: 3, unit: 'reps', source: `${ENG} (few, high-quality reps for skill work)`, validated: false },
  'repRange.skill.max': { value: 6, unit: 'reps', source: `${ENG} (few, high-quality reps for skill work)`, validated: false },
  'repRange.mobility.min': { value: 8, unit: 'reps', source: ENG, validated: false },
  'repRange.mobility.max': { value: 10, unit: 'reps', source: ENG, validated: false },

  // ---- Holds (isometric exercises, balance)
  'hold.defaultSeconds': { value: 20, unit: 's', source: ENG, validated: false },
  'hold.minSeconds': { value: 10, unit: 's', source: ENG, validated: false },
  'hold.maxSeconds': { value: 60, unit: 's', source: `${ENG} (above this the next variant is used instead)`, validated: false },
  'hold.stepSeconds': { value: 5, unit: 's', source: ENG, validated: false },

  // ---- Effort (RIR = reps in reserve; RPE = 10 − RIR on the RIR-based scale, ASSESSMENT_CONFIG.rpeAtZeroRir)
  /** Reserve when no program session gives a target RPE (RIR 3 ≈ RPE 7). */
  'rir.default': { value: 3, unit: 'reps', source: ENG, validated: false },
  /** Largest reserve the engine will prescribe; above it no session is built (effort cap). */
  'rir.max': { value: 5, unit: 'reps', source: ENG, validated: false },
  'readiness.extraRir': { value: 1, unit: 'reps', source: `${ENG} (M05/M12 own readiness; a reduced day adds reserve and drops accessories)`, validated: false },

  // ---- Double progression and regression
  /** Smallest load increase for upper-body lifts, as a fraction of the current load (then the smallest step the equipment allows at or above it). */
  'progression.upperIncrementFraction': { value: 0.025, source: `${SPEC} (Rules: "smallest increment ≥ ~2.5% (upper body)")`, validated: false },
  'progression.lowerIncrementFraction': { value: 0.05, source: `${SPEC} (Rules: "~5% (lower body)")`, validated: false },
  /** Sessions at the top of the range (all sets, at or below the target RPE) before a loaded exercise gets heavier. */
  'progression.loadSessions': { value: 1, unit: 'sessions', source: `${SPEC} (Rules: "When all working sets reach the top of the range at or below target RPE")`, validated: false },
  /** Sessions at the top of the range before a bodyweight exercise moves to the next variant. */
  'progression.variantSessions': { value: 2, unit: 'sessions', source: `${SPEC} (Rules: "top of range on all sets for two sessions → next variant")`, validated: false },
  'regression.sessionsBelowRange': { value: 2, unit: 'sessions', source: `${SPEC} (Rules: "two consecutive sessions below the bottom of the range")`, validated: false },
  /** RPE at or above which the next session gets lighter. */
  'regression.rpeThreshold': { value: 9.5, unit: 'RPE', source: `${SPEC} (Rules: "or RPE ≥ 9.5")`, validated: false },
  'regression.loadReductionFraction': { value: 0.1, source: `${SPEC} (Rules: "reduce load 5–10%"); upper bound chosen by the engineer (conservative)`, validated: false },
  /** Share of a session's done sets below the range bottom for the session to count as "below the range". */
  'regression.belowRangeShare': { value: 0.5, source: ENG, validated: false },

  // ---- In-session autoregulation (RIR reported after a set)
  /** A set reported this many reps closer to failure than the target makes the next sets lighter. */
  'autoregulation.rirDeviation': { value: 2, unit: 'reps', source: ENG, validated: false },
  'autoregulation.loadReductionFraction': { value: 0.05, source: `${ENG} (lower end of the spec's 5–10 % regression)`, validated: false },

  // ---- Tempo (Thomas: slow eccentrics are a tool for specific progressions, not a default)
  'tempo.eccentricSeconds': { value: 4, unit: 's', source: `${ENG} (only for exercises tagged eccentric_focus, e.g. negatives)`, validated: false },

  // ---- Rest between sets
  'rest.strengthLoaded': { value: 150, unit: 's', source: ENG, validated: false },
  'rest.strength': { value: 120, unit: 's', source: ENG, validated: false },
  'rest.hypertrophy': { value: 90, unit: 's', source: ENG, validated: false },
  'rest.general': { value: 75, unit: 's', source: ENG, validated: false },
  'rest.skill': { value: 120, unit: 's', source: ENG, validated: false },
  'rest.balance': { value: 30, unit: 's', source: ENG, validated: false },
  'rest.mobility': { value: 20, unit: 's', source: ENG, validated: false },

  // ---- Time model and time-boxing (David: the plan must fit the clock)
  'time.secondsPerRep': { value: 3, unit: 's', source: ENG, validated: false },
  'time.setupSecondsPerExercise': { value: 30, unit: 's', source: ENG, validated: false },
  'time.supersetTransitionSeconds': { value: 15, unit: 's', source: ENG, validated: false },
  'warmUp.minutes': { value: 8, unit: 'min', source: 'docs/specs/M05 ("warm-ups stay within 5–8 minutes"), upper bound; M05 owns the warm-up content', validated: false },
  'warmUp.minimumMinutes': { value: 5, unit: 'min', source: 'docs/specs/M05 ("warm-ups stay within 5–8 minutes"), lower bound: time-boxing never cuts below it', validated: false },
  'conditioning.minimumFinisherMinutes': { value: 5, unit: 'min', source: ENG, validated: false },

  // ---- Exercise choice without history or capacity (skill level by self-reported experience; 0 entry … 4 expert)
  'selection.maxSkill.none': { value: 1, source: ENG, validated: false },
  'selection.maxSkill.returning': { value: 1, source: ENG, validated: false },
  'selection.maxSkill.beginner': { value: 1, source: ENG, validated: false },
  'selection.maxSkill.intermediate': { value: 2, source: ENG, validated: false },
  'selection.maxSkill.advanced': { value: 3, source: ENG, validated: false },

  /** Score penalties for exercises loading an amber joint (M05 caution) when choosing without history. */
  'selection.amberHighPenalty': { value: 1, source: `${ENG} (A2: how strongly amber joints should steer the choice)`, validated: false },
  'selection.amberMediumPenalty': { value: 0.5, source: `${ENG} (A2: how strongly amber joints should steer the choice)`, validated: false },

  // ---- History the engine reads
  'history.maxSessions': { value: 24, unit: 'sessions', source: ENG, validated: false },
});

export type SessionConfigKey = keyof typeof SESSION_CONFIG;

export function sessionValue(key: SessionConfigKey): number {
  return SESSION_CONFIG[key].value;
}

/**
 * Default loads of a commercial gym when the user has not described them
 * (M02 load rounding). A home, park or travel place has no defaults: the
 * engine asks the user to choose a light load rather than inventing a
 * number. validated: false (A3: which steps a typical gym offers).
 */
export const INCREMENT_CONFIG = defineConfig({
  'gym.barKg': { value: 20, unit: 'kg', source: `${ENG} (common barbell weight; the user can enter theirs)`, validated: false },
  'gym.smallestPlateKg': { value: 1.25, unit: 'kg', source: `${ENG} (plates in pairs: a 2.5 kg step on a barbell)`, validated: false },
  'gym.dumbbellMinKg': { value: 2, unit: 'kg', source: ENG, validated: false },
  'gym.dumbbellStepKg': { value: 2, unit: 'kg', source: ENG, validated: false },
  'gym.dumbbellMaxKg': { value: 50, unit: 'kg', source: ENG, validated: false },
  'gym.kettlebellMinKg': { value: 8, unit: 'kg', source: ENG, validated: false },
  'gym.kettlebellStepKg': { value: 4, unit: 'kg', source: ENG, validated: false },
  'gym.kettlebellMaxKg': { value: 32, unit: 'kg', source: ENG, validated: false },
  'gym.stackMinKg': { value: 5, unit: 'kg', source: ENG, validated: false },
  'gym.stackStepKg': { value: 5, unit: 'kg', source: ENG, validated: false },
  'gym.stackMaxKg': { value: 120, unit: 'kg', source: ENG, validated: false },
});

export function incrementValue(key: keyof typeof INCREMENT_CONFIG): number {
  return INCREMENT_CONFIG[key].value;
}
