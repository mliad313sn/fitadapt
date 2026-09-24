import { CARDIO_PROTOCOLS, IMPACT_LEVELS } from '@fitadapt/shared';

/**
 * Every reason code the M03 cardio rules emit (protocols, gates, impact,
 * movements, zones, the weekly ledger), with the parameters its FR/EN
 * sentence needs (packages/i18n `engine.reason.<code>`; all are sentences
 * without numbers: the numbers are shown from the plan itself). A test
 * renders every code in both languages.
 */
const LOWER = ['knee', 'ankle', 'hip'] as const;
const codes = (list: readonly string[]) => Object.fromEntries(list.map((c) => [c, [] as readonly string[]]));

export const M03_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...codes(CARDIO_PROTOCOLS.map((p) => `cardio.protocol.${p}`)),
  ...codes(['cardio.placement.session', 'cardio.placement.finisher', 'cardio.intensity.moderate', 'cardio.intensity.vigorous', 'cardio.warm_up.included', 'cardio.cool_down.easy']),
  ...codes(LOWER.flatMap((j) => [`cardio.impact.low_default.limited.${j}`, `cardio.impact.low_default.pain.${j}`, `cardio.impact.red_joint.${j}`])),
  ...codes(['cardio.impact.low_default.bmi', 'cardio.impact.opted_up', 'cardio.impact.any']),
  ...codes(IMPACT_LEVELS.filter((l) => l !== 'high').map((l) => `cardio.impact.profile_ceiling.${l}`)),
  ...codes(['requested', 'venue_swap', 'requested_unavailable', 'machine', 'steady', 'any_easy', 'circuit', 'none', 'rotation'].map((m) => `cardio.movement.${m}`)),
  ...codes(['cardio.hiit.gates_passed', 'cardio.hiit.needs_consistent_training', 'cardio.hiit.first_exposure']),
  ...codes(['heart_rate_reserve', 'hr_max_estimated', 'perceived_exertion', 'no_resting_hr', 'no_age', 'reserve_too_small', 'medication_effort_only', 'profile_effort_only', 'talk_test'].map((z) => `cardio.zones.${z}`)),
  ...codes(['cardio.session.standalone', 'cardio.unavailable.hiit_s1', 'cardio.unavailable.hiit_needs_consistent_training', 'cardio.unavailable.no_movement', 'cardio.unavailable.readiness_reduced', 'cardio.readiness.reduced']),
  ...codes(['below', 'within', 'above', 'vigorous_double', 'who_range'].map((l) => `cardio.ledger.${l}`)),
});

export const M03_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M03_REASON_PARAMS));
