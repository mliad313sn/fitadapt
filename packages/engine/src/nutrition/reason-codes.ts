/**
 * Every reason code the M10 nutrition engine emits (packages/i18n
 * `engine.reason.<code>`, FR and EN). None takes parameters: the numbers are
 * shown from the target itself, and only in the numeric mode. A test renders
 * every code in both languages (packages/food-library).
 */
const codes = (list: readonly string[]) => Object.fromEntries(list.map((c) => [c, [] as readonly string[]]));

export const M10_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  codes([
    // Energy model
    'nutrition.energy.bmr_mifflin',
    'nutrition.energy.activity_factor',
    'nutrition.energy.adaptive',
    'nutrition.energy.adaptive_insufficient_data',
    'nutrition.energy.unavailable',
    // Goals
    'nutrition.goal.fat_loss',
    'nutrition.goal.maintain',
    'nutrition.goal.muscle_gain',
    'nutrition.goal.goal_weight_reached',
    'nutrition.protein.range',
    'nutrition.protein.reference_weight',
    'nutrition.rounding.up',
    // S4 floors applied
    'nutrition.s4.bmr_floor',
    'nutrition.s4.rate_capped',
    'nutrition.s4.goal_weight_below_floor',
    'nutrition.s4.at_bmi_floor',
    // M04 sustained-loss guardrail
    'nutrition.guardrail.paused',
    'nutrition.guardrail.rate_reduced',
    // Modes without numbers
    'nutrition.supportive.chosen',
    'nutrition.supportive.minor',
    'nutrition.supportive.advised_against',
    'nutrition.supportive.eating_disorder',
    'nutrition.supportive.not_screened',
    'nutrition.supportive.special_population',
    'nutrition.needs_measurements',
    // Portions
    'nutrition.portion.hand_estimate',
    'nutrition.portion.food_estimate',
  ]),
);

export const M10_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M10_REASON_PARAMS));
