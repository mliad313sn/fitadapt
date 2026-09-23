import { defineConfig, type ContraindicationTag, type ImpactLevel, type ScreeningQuestionId } from '@fitadapt/shared';

/**
 * M01 screening rules: how each answer shapes the SafetyProfile.
 *
 * SAFETY-CRITICAL AND NOT VALIDATED. The questions are original wording
 * written by the drafting assistant (not PAR-Q+ or any other published
 * instrument: licence risk RSK-08). The mapping below was chosen by the
 * engineer as a conservative default. Every rule is `validated: false` and
 * must be reviewed by council seat A1 (sports & exercise medicine physician,
 * docs/governance/03 §3) before launch; seat A1 and counsel (B3) decide
 * whether a licensed instrument should replace these questions.
 *
 * The S1 caps themselves (RPE 7, no HIIT, no maximal tests while a flag is
 * unresolved), the S7 minimum age (16) and the S4 age (18) are invariants in
 * code (screening.ts), not configuration.
 */
export interface ReviewedRule {
  readonly source: string;
  readonly validated: boolean;
  /** Seat that must review it (docs/governance/03 §3). */
  readonly reviewSeat: 'A1' | 'A2' | 'A4';
  readonly validatedBy?: string;
  readonly signOff?: string;
}

export interface Restrictions {
  readonly maxRPE?: number;
  readonly allowHIIT?: false;
  readonly allowMaxTests?: false;
  readonly impactCeiling?: ImpactLevel;
  readonly avoidTags?: readonly ContraindicationTag[];
}

/**
 * - clearance_flag: S1 — caps apply until the user attests a professional's clearance;
 *   `afterClearance` restrictions stay after the attestation.
 * - restriction: never a flag; always applies (outcome "cleared with restrictions").
 * - special_population: S7 — professional guidance and the low-intensity library only; clearance does not lift it in v1.
 * - nutrition: S4 — deficit features off; no training restriction.
 */
export type QuestionKind = 'clearance_flag' | 'restriction' | 'special_population' | 'nutrition';

export interface QuestionRule extends ReviewedRule {
  readonly kind: QuestionKind;
  readonly afterClearance: Restrictions;
  readonly reasonCode: string;
}

const ENGINEER_DEFAULT = 'M01 engineering default (conservative choice by the engineer); original question wording; no external source. Requires seat A1 review.';

export const SCREENING_RULES_VERSION = '0.1.0';

/** In display order. */
export const SCREENING_RULES: Readonly<Record<ScreeningQuestionId, QuestionRule>> = Object.freeze({
  heart_or_blood_pressure: {
    kind: 'clearance_flag',
    afterClearance: { avoidTags: ['breath_hold_bracing', 'inversion'] },
    reasonCode: 'safety_profile.flag.heart_or_blood_pressure',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  chest_discomfort: {
    kind: 'clearance_flag',
    afterClearance: { avoidTags: ['breath_hold_bracing'] },
    reasonCode: 'safety_profile.flag.chest_discomfort',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  fainting_or_dizziness: {
    kind: 'clearance_flag',
    afterClearance: { avoidTags: ['inversion', 'high_balance_demand'] },
    reasonCode: 'safety_profile.flag.fainting_or_dizziness',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  unusual_breathlessness: {
    kind: 'clearance_flag',
    afterClearance: {},
    reasonCode: 'safety_profile.flag.unusual_breathlessness',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  ongoing_condition: {
    kind: 'clearance_flag',
    afterClearance: {},
    reasonCode: 'safety_profile.flag.ongoing_condition',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  medication_affecting_effort: {
    kind: 'clearance_flag',
    afterClearance: {},
    reasonCode: 'safety_profile.flag.medication_affecting_effort',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  advised_to_limit_activity: {
    kind: 'clearance_flag',
    afterClearance: {},
    reasonCode: 'safety_profile.flag.advised_to_limit_activity',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  bone_joint_back: {
    kind: 'restriction',
    afterClearance: { impactCeiling: 'low', avoidTags: ['jumping_landing'] },
    reasonCode: 'safety_profile.restriction.bone_joint_back',
    source: ENGINEER_DEFAULT,
    validated: false,
    reviewSeat: 'A1',
  },
  pregnancy_or_recent_birth: {
    kind: 'special_population',
    afterClearance: {
      allowHIIT: false,
      allowMaxTests: false,
      impactCeiling: 'low',
      avoidTags: ['jumping_landing', 'supine_position', 'prone_position', 'breath_hold_bracing', 'inversion', 'loaded_spinal_flexion', 'high_balance_demand'],
    },
    reasonCode: 'safety_profile.s7.pregnancy_postpartum',
    source: 'S7 (docs/specs/00-product-vision.md) routes pregnancy/postpartum to professional guidance and a low-intensity library; the tag list and RPE cap are the engineer\'s conservative choice. Requires seat A1 review.',
    validated: false,
    reviewSeat: 'A1',
  },
  advised_against_calorie_restriction: {
    kind: 'nutrition',
    afterClearance: {},
    reasonCode: 'safety_profile.s4.advised_against_calorie_restriction',
    source: 'S4 (docs/specs/00-product-vision.md) and M01 rules: deficit features disabled when a professional advised against calorie restriction. Question wording original; requires seat A1 (and A4) review.',
    validated: false,
    reviewSeat: 'A1',
  },
});

/** Numbers used by the screening. */
export const SCREENING_CONFIG = defineConfig({
  rescreenIntervalMonths: {
    value: 12,
    unit: 'months',
    source: 'docs/specs/M01-onboarding-screening-profile.md ("re-screen every 12 months")',
    validated: false,
  },
  symptomLookbackMonths: {
    value: 12,
    unit: 'months',
    source: 'M01 engineering default for the look-back period named in the symptom questions; no external source. Requires seat A1 review.',
    validated: false,
  },
  postpartumWindowMonths: {
    value: 12,
    unit: 'months',
    source: 'M01 engineering default for "recently given birth"; no external source. Requires seat A1 review.',
    validated: false,
  },
  specialPopulationMaxRPE: {
    value: 5,
    unit: 'RPE (0–10)',
    source: 'M01 engineering default (low intensity for the S7 low-intensity library); no external source. Requires seat A1 review.',
    validated: false,
  },
});

/** Every rule still awaiting review (for the status file and launch checks). */
export function unvalidatedScreeningRules(): ScreeningQuestionId[] {
  return (Object.keys(SCREENING_RULES) as ScreeningQuestionId[]).filter((id) => !SCREENING_RULES[id].validated);
}
