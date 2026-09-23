import { GOAL_IDS, MICROCYCLE_KINDS, SESSION_FOCUSES, SPLIT_IDS, TRAINING_AGES } from '@fitadapt/shared';

/**
 * Every reason code the program generator and the reflow emit. Each has an
 * FR and EN explanation in packages/i18n (`engine.reason.<code>`); a test in
 * packages/exercise-library checks that the engine never emits a code outside
 * this list, and packages/i18n that every code has both texts.
 */
export const PROGRAM_REASON_CODES: readonly string[] = Object.freeze([
  ...GOAL_IDS.map((g) => `program.goal.${g}`),
  ...TRAINING_AGES.map((a) => `program.training_age.${a}`),
  ...SPLIT_IDS.map((s) => `program.split.${s}`),
  ...MICROCYCLE_KINDS.map((k) => `program.week.${k}`),
  ...MICROCYCLE_KINDS.map((k) => `program.rpe.${k}`),
  ...SESSION_FOCUSES.map((f) => `program.session.${f}`),
  'program.schedule.rest_day_kept',
  'program.schedule.days_as_chosen',
  'program.schedule.days_adjusted',
  'program.schedule.days_spread',
  'program.transition.goal_change',
  'program.rpe.s1_capped',
  'program.conditioning.intervals_not_allowed',
  'program.conditioning.steady',
  'program.conditioning.intervals',
  'program.conditioning.finisher',
  'program.concurrent.no_intervals_before_heavy_lower',
  'program.concurrent.intervals_replaced',
  'program.slot.not_possible_here',
  'program.session.none_possible_here',
  'program.volume.time_limited',
  'program.unavailable.blocked',
  'program.unavailable.not_screened',
  'program.unavailable.professional_guidance',
  'program.unavailable.effort_cap',
  'program.reflow.shifted',
  'program.reflow.merged',
  'program.reflow.skipped',
  'program.reflow.week_over',
  'program.reflow.unknown_session',
  'program.reflow.already_handled',
]);
