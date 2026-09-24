import { defineConfig } from '@fitadapt/shared';

/**
 * M10 physiological coefficient the S4 checks need to turn a daily energy
 * deficit into a planned loss rate (CLAUDE.md rule 4). It is a coefficient,
 * not an invariant: the S4 limits themselves (target ≥ estimated BMR,
 * planned loss ≤ 1 % body weight per week, goal weight ≥ BMI 18.5, no
 * deficit under 18 or when advised against calorie restriction) are
 * constants in nutrition-floors.ts and are never configuration.
 *
 * NOT VALIDATED: seats A4 (registered dietitian) and A5 (exercise
 * physiologist) must review it (docs/governance/03 §3). The engine
 * (packages/engine `nutrition`) reads the same value, so a deficit and the
 * rate S4 checks are computed with one number.
 */
export const NUTRITION_SAFETY_CONFIG = defineConfig({
  /** Energy per kg of body-mass change used to convert a deficit into a rate. */
  energyDensityKcalPerKg: {
    value: 7700,
    unit: 'kcal per kg of body-mass change',
    source:
      'Commonly quoted rule of thumb (≈ 3,500 kcal per pound, ≈ 7,700 kcal per kg); drafting-assistant knowledge, not checked against a source. Known to be a simplification (the true figure varies with body composition and over time). Seats A4, A5',
    validated: false,
  },
});
