import { CAPACITY_SLOTS, ASSESSMENT_SKIP_REASONS } from '@fitadapt/shared';

/**
 * Every reason code the M07 assessment and the first-session generator emit.
 * Each has an FR and EN explanation in packages/i18n (`engine.reason.<code>`);
 * a test in packages/exercise-library renders them all and checks that the
 * engine never emits a code outside this list.
 */
export const ASSESSMENT_REASON_CODES: readonly string[] = Object.freeze([
  'assessment.stop.reserve',
  'assessment.stop.s1_reserve',
  'assessment.stop.max_test_not_allowed',
  'assessment.stop.technical_failure',
  'assessment.skip.equipment',
  'assessment.skip.safety',
  'assessment.unavailable.blocked',
  'assessment.unavailable.not_screened',
  'assessment.unavailable.professional_guidance',
  'assessment.unavailable.effort_cap',
  'assessment.mapping.zero_lowest_rung',
  'assessment.mapping.step_down',
  'assessment.mapping.in_range',
  'assessment.mapping.step_up',
  'assessment.mapping.not_tested_lowest_rung',
  ...ASSESSMENT_SKIP_REASONS.map((r) => `assessment.mapping.skipped_${r}`),
  'assessment.e1rm.epley_rir',
  'assessment.e1rm.out_of_range',
  'assessment.load.first_session_factor',
  'assessment.reassess.mesocycle_end',
]);

export const SESSION_REASON_CODES: readonly string[] = Object.freeze([
  'session.first.from_assessment',
  'session.exercise.from_assessment',
  'session.exercise.stepped_down',
  'session.exercise.substituted',
  'session.load.from_e1rm',
  'session.load.from_test_load',
  'session.load.self_select_light',
  'session.load.bodyweight_variant',
  'session.load.s5_capped',
  'session.rir.first_session',
  'session.rir.s1_capped',
  ...CAPACITY_SLOTS.map((s) => `session.slot_dropped.${s}`),
  'session.time.trimmed',
  'session.unavailable.blocked',
  'session.unavailable.not_screened',
  'session.unavailable.professional_guidance',
  'session.unavailable.effort_cap',
  'session.unavailable.no_exercise',
]);
