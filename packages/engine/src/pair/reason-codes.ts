/**
 * Every reason code the M09 pair planner and the Fair Challenge Score emit,
 * with the parameters its FR/EN sentence needs (packages/i18n
 * `engine.reason.<code>`). A test renders every code in both languages.
 */
export const M09_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Timeline
  'pair.timeline.turns': [],
  'pair.timeline.rest_kept': [],
  'pair.timeline.own_prescriptions': [],
  'pair.timeline.partner_ended': [],
  // Blocks
  'pair.block.shared_pattern': [],
  'pair.block.solo': [],
  'pair.block.warm_up_together': [],
  'pair.block.conditioning_together': [],
  'pair.block.cool_down_together': [],
  'pair.equipment.staggered': ['seconds'],
  // Fair Challenge Score
  'pair.score.relative': [],
  'pair.score.capped_at_plan': [],
  'pair.score.load_coefficient': [],
  'pair.score.variant_coefficient': [],
  'pair.score.complete': [],
  'pair.score.scoring': [],
  'pair.score.stopped': [],
  'pair.score.paused_pain': [],
  'pair.score.safety_stop': [],
  // Pair session generation
  'pair.session.own_profile': [],
  'pair.session.shared_place': [],
  'pair.unavailable.partner': [],
});

export const M09_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M09_REASON_PARAMS));
