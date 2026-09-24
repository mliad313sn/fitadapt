import { defineConfig } from '@fitadapt/shared';

/**
 * M10 nutrition coefficients and thresholds (CLAUDE.md rule 4). NONE IS
 * VALIDATED. Seats (docs/governance/03 §3): A4 (registered dietitian) for
 * every value; A5 (exercise physiologist) for the energy equation, activity
 * factors and the adaptive update; A1 (sports medicine physician) with A4
 * for the guardrail pause.
 *
 * "not checked against the source" means the drafting assistant quotes the
 * reference from its own knowledge (docs/specs/00-product-vision.md,
 * Evidence references: "compiled by the drafting assistant from its own
 * knowledge, not retrieved and checked"). "Spec" quotes
 * docs/specs/M10-nutrition-energy-balance.md, not a primary source.
 * "Engineering default" = no external source, a conservative choice.
 *
 * The S4 limits (target ≥ BMR, ≤ 1 %/week, BMI 18.5, age 18) are NOT here:
 * they are constants in packages/safety (nutrition-floors.ts). The energy
 * density that turns a deficit into a rate is packages/safety
 * NUTRITION_SAFETY_CONFIG (one value for the engine and the S4 check).
 */
const MIFFLIN = 'Mifflin MD, St Jeor ST et al. (1990), Am J Clin Nutr 51(2):241–247 (docs/specs/00-product-vision.md, Evidence references); coefficient quoted from the drafting assistant’s knowledge, not checked against the source';
const ACTIVITY =
  'Activity multipliers commonly used with resting-energy equations in practice (1.2 / 1.375 / 1.55 / 1.725 / 1.9); drafting-assistant knowledge, no primary source identified, not checked against a source';
const PAL =
  'Practitioner multipliers with no identified primary source. The reference bands are FAO/WHO/UNU (2004) PAL 1.40–1.69 for sedentary or light activity and EFSA (2013) PAL 1.4 as the low level, as cited by docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md (M10-3: 1.2 is closer to bed rest; an under-estimated factor makes the real deficit larger than the one S4 checks). Raised to the EFSA low PAL (stricter: higher targets); not checked against the sources; seats A4 and A5 to decide';
const SPEC = 'docs/specs/M10-nutrition-energy-balance.md';
const ENG = 'M10 engineering default (conservative choice by the engineer); no external source';
const ADAPT = `${ENG}; asymmetric band and per-update limit per ${'docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md'} (M10-8/9: under-reported intake pushes the estimate down; a small downward limit such as −10 %, upward unchanged)`;
const HAND =
  'Estimated; the hand-portion method as used in coaching practice (a palm of protein food, a fist of vegetables, a cupped hand of starchy food, a thumb of oils and fats). Energy and protein per portion are the engineer’s rough estimates, not checked against any source; to be verified by seat A4';

/** Version of the M10 nutrition rules (energy model, targets, guardrail, portions). Stored in every NutritionTarget. */
export const NUTRITION_RULES_VERSION = '0.1.0';

export const NUTRITION_CONFIG = defineConfig({
  // ---- Mifflin-St Jeor resting energy (kcal/day) = w·kg + h·cm − a·years + sex constant
  'bmr.weightKcalPerKg': { value: 10, unit: 'kcal per kg', source: MIFFLIN, validated: false },
  'bmr.heightKcalPerCm': { value: 6.25, unit: 'kcal per cm', source: MIFFLIN, validated: false },
  'bmr.ageKcalPerYear': { value: 5, unit: 'kcal per year', source: MIFFLIN, validated: false },
  'bmr.maleConstantKcal': { value: 5, unit: 'kcal', source: MIFFLIN, validated: false },
  'bmr.femaleConstantKcal': { value: -161, unit: 'kcal', source: MIFFLIN, validated: false },
  /** "Unspecified": the midpoint of the two constants (the equation has no other option). */
  'bmr.unspecifiedConstantKcal': { value: -78, unit: 'kcal', source: `${ENG}: midpoint of the Mifflin-St Jeor male and female constants`, validated: false },

  // ---- Activity factors (expenditure = BMR × factor)
  'activity.sedentary': { value: 1.4, unit: '× BMR', source: `${PAL} (was 1.2)`, validated: false },
  /** Kept above sedentary (was 1.375, now below the new sedentary value): between EFSA's 1.4 and 1.6 levels. */
  'activity.light': { value: 1.5, unit: '× BMR', source: `${ENG}: kept above the sedentary factor, between the EFSA (2013) 1.4 and 1.6 PAL levels as cited by ${'docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md'} (was 1.375); seats A4 and A5 to decide`, validated: false },
  'activity.moderate': { value: 1.55, unit: '× BMR', source: ACTIVITY, validated: false },
  'activity.very_active': { value: 1.725, unit: '× BMR', source: ACTIVITY, validated: false },
  'activity.extra_active': { value: 1.9, unit: '× BMR', source: ACTIVITY, validated: false },

  // ---- Goal targets
  'loss.defaultPercentPerWeek': { value: 0.5, unit: '% body weight per week', source: `${SPEC} (Scope: "fat loss sized to ~0.5–1% BW/week"); the lower end is the default`, validated: false },
  'gain.surplusFraction': { value: 0.05, unit: 'fraction of expenditure', source: `${ENG}; ${SPEC} (Scope: "muscle gain with a small surplus") names no size`, validated: false },
  'gain.maxSurplusKcal': { value: 300, unit: 'kcal per day', source: `${ENG}; ${SPEC} ("a small surplus")`, validated: false },
  'protein.minGPerKg': { value: 1.6, unit: 'g per kg per day', source: `${SPEC} (Scope: "protein ≈ 1.6–2.2 g/kg/day (Morton et al., 2018 found benefits plateau around 1.6 g/kg)"); Morton RW et al. (2018) Br J Sports Med 52(6):376–384, not checked against the source`, validated: false },
  'protein.maxGPerKg': {
    value: 2.2,
    unit: 'g per kg per day',
    source: `${SPEC} (Scope: "protein ≈ 1.6–2.2 g/kg/day … the upper end is often used in a deficit"); per ${'docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md'} this is the upper 95 % CI bound of the Morton et al. (2018) breakpoint, also consistent with ISSN 2017 (up to ~2.0, higher in a deficit); not checked against a primary source. Shown with a kidney-disease notice (KDIGO 2024 as cited there advises less in CKD)`,
    validated: false,
  },
  /** Protein is sized on the body weight at this BMI when the current weight is higher (not on the whole body weight). */
  'protein.referenceBmi': { value: 25, unit: 'kg/m²', source: `${ENG} (reference-weight approach for higher body weights; seat A4 to decide)`, validated: false },

  // ---- Adaptive expenditure (updated weekly from the weight trend and logged intake)
  'adaptive.windowDays': { value: 14, unit: 'days', source: ENG, validated: false },
  'adaptive.minLoggedDays': { value: 10, unit: 'days with a log in the window', source: ENG, validated: false },
  /** Share of the gap between the observed and the previous expenditure taken at each weekly update. */
  'adaptive.blend': { value: 0.5, unit: 'fraction', source: ENG, validated: false },
  /** The adaptive expenditure stays at most this share ABOVE the formula estimate. */
  'adaptive.maxDeviationFraction': { value: 0.25, unit: 'fraction of the formula estimate', source: ENG, validated: false },
  /** … and at most this share BELOW it (asymmetric band: was −25 %). */
  'adaptive.maxDownwardFraction': { value: 0.1, unit: 'fraction of the formula estimate', source: ADAPT, validated: false },
  /** One weekly update lowers the expenditure by at most this share of the previous one. */
  'adaptive.maxDecreasePerUpdateFraction': { value: 0.05, unit: 'fraction of the previous estimate', source: ADAPT, validated: false },
  /** A day whose logged energy is below this is treated as incompletely logged and not counted. */
  'adaptive.minPlausibleDayKcal': { value: 1200, unit: 'kcal logged in a day', source: `${ADAPT}; "leave out days whose logged energy is implausibly low"; the value is the S4 absolute energy floor`, validated: false },
  'update.intervalDays': { value: 7, unit: 'days', source: `${SPEC} (Scope: "adaptive expenditure updated weekly")`, validated: false },

  // ---- M04 sustained-loss guardrail (S4 hand-off)
  /** After a hand-off, no deficit for this long (M04 copy: "will not suggest eating less for now"). */
  'guardrail.pauseDays': { value: 14, unit: 'days', source: `${ENG}; docs/specs/M04-tracking-progress-dashboard.md (Rules: sustained loss "hands off to M10 guardrails")`, validated: false },
  /** Then the pace is capped at `guardrail.reducedRateMaxPercent` for this long after the hand-off. */
  'guardrail.reducedRateDays': { value: 56, unit: 'days', source: ENG, validated: false },
  'guardrail.reducedRateMaxPercent': { value: 0.5, unit: '% body weight per week', source: `${ENG} (the lower end of the spec's 0.5–1 %)`, validated: false },

  // ---- Display rounding (rounding the energy target is always UP: it can only reduce a deficit)
  'rounding.kcal': { value: 10, unit: 'kcal', source: ENG, validated: false },
  'rounding.proteinG': { value: 5, unit: 'g', source: ENG, validated: false },

  // ---- Hand portions (quick log), energy and protein per portion
  'handPortion.protein_palm.kcal': { value: 150, unit: 'kcal per portion', source: HAND, validated: false },
  'handPortion.protein_palm.proteinG': { value: 25, unit: 'g per portion', source: HAND, validated: false },
  'handPortion.vegetables_fist.kcal': { value: 30, unit: 'kcal per portion', source: HAND, validated: false },
  'handPortion.vegetables_fist.proteinG': { value: 2, unit: 'g per portion', source: HAND, validated: false },
  'handPortion.carbs_cupped_hand.kcal': { value: 120, unit: 'kcal per portion', source: HAND, validated: false },
  'handPortion.carbs_cupped_hand.proteinG': { value: 3, unit: 'g per portion', source: HAND, validated: false },
  'handPortion.fats_thumb.kcal': { value: 90, unit: 'kcal per portion', source: HAND, validated: false },
  'handPortion.fats_thumb.proteinG': { value: 1, unit: 'g per portion', source: HAND, validated: false },
});

export type NutritionConfigKey = keyof typeof NUTRITION_CONFIG;

export function nutritionValue(key: NutritionConfigKey): number {
  return NUTRITION_CONFIG[key].value;
}
