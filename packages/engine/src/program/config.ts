import { defineConfig } from '@fitadapt/shared';

/**
 * M08 program coefficients and thresholds (CLAUDE.md rule 4). Every value is
 * `validated: false`: none has been reviewed by the council (seats A3 S&C
 * coach and A5 exercise physiologist, docs/governance/03 §3). The weekly
 * hard-set ranges are the spec's "starting points, to be validated"; every
 * other number is an engineering default unless a spec is named. Nothing here
 * is a published norm.
 */
const ENG = 'M08 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M08-program-architect-periodization.md';
const VOLUME = `${SPEC} ("weekly hard-set targets per muscle … starting points: beginner 8–12, intermediate 10–16, advanced 12–20; to be validated")`;

export const PROGRAM_CONFIG = defineConfig({
  // ---- Weekly hard sets per muscle group, by training age (spec starting points)
  'volume.beginner.min': { value: 8, unit: 'sets/week', source: VOLUME, validated: false },
  'volume.beginner.max': { value: 12, unit: 'sets/week', source: VOLUME, validated: false },
  'volume.intermediate.min': { value: 10, unit: 'sets/week', source: VOLUME, validated: false },
  'volume.intermediate.max': { value: 16, unit: 'sets/week', source: VOLUME, validated: false },
  'volume.advanced.min': { value: 12, unit: 'sets/week', source: VOLUME, validated: false },
  'volume.advanced.max': { value: 20, unit: 'sets/week', source: VOLUME, validated: false },
  /** Where the first-week target sits in the range, by goal (0 = min, 1 = max). */
  'volume.position.muscle_gain': { value: 0.5, source: ENG, validated: false },
  'volume.position.strength': { value: 0.25, source: ENG, validated: false },
  'volume.position.calisthenics_skills': { value: 0.25, source: ENG, validated: false },
  'volume.position.fat_loss': { value: 0, source: ENG, validated: false },
  'volume.position.general_health': { value: 0, source: ENG, validated: false },
  'volume.position.endurance': { value: 0, source: ENG, validated: false },
  /** Added to the weekly target per accumulation week of a mesocycle (never above the range max). */
  'volume.weeklyIncrementSets': { value: 1, unit: 'sets/week', source: ENG, validated: false },

  // ---- Hard sets counted per muscle group for a set of each movement pattern (fractional counting)
  'contribution.squat.quads': { value: 1, source: ENG, validated: false },
  'contribution.squat.glutes_hamstrings': { value: 0.5, source: ENG, validated: false },
  'contribution.lunge.quads': { value: 1, source: ENG, validated: false },
  'contribution.lunge.glutes_hamstrings': { value: 0.5, source: ENG, validated: false },
  'contribution.hinge.glutes_hamstrings': { value: 1, source: ENG, validated: false },
  'contribution.horizontal_push.chest': { value: 1, source: ENG, validated: false },
  'contribution.horizontal_push.shoulders': { value: 0.5, source: ENG, validated: false },
  'contribution.horizontal_push.arms': { value: 0.5, source: ENG, validated: false },
  'contribution.vertical_push.shoulders': { value: 1, source: ENG, validated: false },
  'contribution.vertical_push.arms': { value: 0.5, source: ENG, validated: false },
  'contribution.horizontal_pull.back': { value: 1, source: ENG, validated: false },
  'contribution.horizontal_pull.arms': { value: 0.5, source: ENG, validated: false },
  'contribution.vertical_pull.back': { value: 1, source: ENG, validated: false },
  'contribution.vertical_pull.arms': { value: 0.5, source: ENG, validated: false },
  'contribution.core.core': { value: 1, source: ENG, validated: false },
  'contribution.carry.core': { value: 0.5, source: ENG, validated: false },
  'contribution.isolation.arms': { value: 1, source: ENG, validated: false },

  // ---- Mesocycles (spec: 4–6 weeks, accumulation → deload)
  'mesocycle.weeks.beginner': { value: 6, unit: 'weeks', source: `${SPEC} ("mesocycles of 4–6 weeks"); length per training age chosen by the engineer`, validated: false },
  'mesocycle.weeks.intermediate': { value: 5, unit: 'weeks', source: `${SPEC} ("mesocycles of 4–6 weeks"); length per training age chosen by the engineer`, validated: false },
  'mesocycle.weeks.advanced': { value: 4, unit: 'weeks', source: `${SPEC} ("mesocycles of 4–6 weeks"); length per training age chosen by the engineer`, validated: false },
  'program.mesocycles': { value: 3, unit: 'mesocycles', source: ENG, validated: false },
  /** Deload volume (M05: "volume −40–50%"): the larger reduction is used. */
  'deload.volumeFactor': { value: 0.5, source: 'docs/specs/M05-recovery-mobility-pain-safety.md ("volume −40–50%"); −50% chosen by the engineer', validated: false },
  /** First week after a goal change. */
  'transition.volumeFactor': { value: 0.7, source: ENG, validated: false },

  // ---- Effort (RPE on the RIR-based scale, M07 `rpeAtZeroRir`); S1 caps it further
  'rpe.accumulationStart': { value: 7, unit: 'RPE', source: ENG, validated: false },
  'rpe.accumulationEnd': { value: 8, unit: 'RPE', source: ENG, validated: false },
  'rpe.deload': { value: 6, unit: 'RPE', source: ENG, validated: false },
  'rpe.transition': { value: 6.5, unit: 'RPE', source: ENG, validated: false },
  /** Below this effort ceiling the program schedules nothing (the SafetyProfile routes elsewhere). */
  'rpe.minimum': { value: 5, unit: 'RPE', source: ENG, validated: false },

  // ---- Session time model
  'session.warmUpMinutes': { value: 5, unit: 'min', source: 'docs/specs/M05-recovery-mobility-pain-safety.md ("warm-ups stay within 5–8 minutes"); lower bound', validated: false },
  'session.minutesPerHardSet': { value: 3, unit: 'min', source: `${ENG} (set plus rest)`, validated: false },
  'session.maxSetsPerSlot': { value: 5, unit: 'sets', source: ENG, validated: false },
  /** Balance and mobility slots (not counted as hard sets). */
  'session.balanceSets': { value: 2, unit: 'sets', source: ENG, validated: false },
  /** Greedy set allocation: bonus for primary / secondary slots and penalty per set already in the slot (spreads the volume). */
  'allocation.bonus.primary': { value: 0.1, source: ENG, validated: false },
  'allocation.bonus.secondary': { value: 0.05, source: ENG, validated: false },
  'allocation.spreadPenalty': { value: 0.05, source: ENG, validated: false },
  'schedule.maxTrainingDays': { value: 6, unit: 'days/week', source: `${ENG} (at least one rest day each week)`, validated: false },

  // ---- Concurrent training (M03/M08)
  'conditioning.finisherMinutes': { value: 10, unit: 'min', source: ENG, validated: false },
  /** A finisher is added only when this much strength time is left in the session. */
  'conditioning.minStrengthMinutes': { value: 20, unit: 'min', source: ENG, validated: false },
  /** M03: HIIT only after ≥ 2 weeks of consistent training, so intervals are scheduled from week 3 at the earliest. */
  'conditioning.intervalsFromWeek': { value: 3, unit: 'week', source: 'docs/specs/M03-cardio-conditioning.md ("HIIT/Tabata only when … ≥ 2 weeks of consistent training are logged")', validated: false },

  // ---- Reflow
  /** Sets per slot moved into another session when a missed session is merged. */
  'reflow.mergeSetsPerSlot': { value: 2, unit: 'sets', source: ENG, validated: false },
});

export type ProgramConfigKey = keyof typeof PROGRAM_CONFIG;

export function programValue(key: ProgramConfigKey): number {
  return PROGRAM_CONFIG[key].value;
}

/** Spec rules (not coefficients): mesocycle length bounds and the reflow limit. */
export const MESOCYCLE_MIN_WEEKS = 4 as const;
export const MESOCYCLE_MAX_WEEKS = 6 as const;
export const REFLOW_MAX_EXTRA_SESSIONS_PER_WEEK = 1 as const;

/** Version of the program rules and templates; bump when generation or reflow changes. */
/** 0.2.0 (M05): a deload week is the accumulation week before it with 40–50 % of its sets removed. */
export const PROGRAM_RULES_VERSION = '0.2.0';
