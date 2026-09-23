import {
  CONTRAINDICATION_TAGS,
  IMPACT_LEVELS,
  JOINTS,
  SCREENING_QUESTION_IDS,
  SafetyProfileSchema,
  ScreeningResponsesSchema,
  type ContraindicationTag,
  type ImpactLevel,
  type Joint,
  type SafetyProfile,
  type ScreeningQuestionId,
  type ScreeningResponses,
} from '@fitadapt/shared';
import { ageInYears, evaluateAgeGate } from './age-gate.js';
import type { SafetyCheck } from './evaluate.js';
import { SCREENING_CONFIG, SCREENING_RULES, SCREENING_RULES_VERSION, type Restrictions } from './screening.config.js';

/**
 * M01 health screening → SafetyProfile (S1, S4, S7). Pure and fail-closed:
 * an incomplete, invalid or unreadable response set never yields a looser
 * profile than "not screened".
 *
 * Invariants in code (never configuration):
 * - S1: while a flag is unresolved, maxRPE ≤ 7, no HIIT, no maximal tests.
 * - S7: under 16 is blocked (the M17 age-gate constant); pregnancy/postpartum
 *   gets professional guidance and the low-intensity library only, and is
 *   excluded from automatic programming.
 * - S4: deficit nutrition features are off under 18 or when a professional
 *   advised against calorie restriction.
 */
export const S1_MAX_RPE_WHILE_UNRESOLVED = 7 as const;
export const S4_DEFICIT_MINIMUM_AGE_YEARS = 18 as const;

export const SCREENING_QUESTIONS: readonly ScreeningQuestionId[] = SCREENING_QUESTION_IDS;

const OPEN: Omit<SafetyProfile, 'reasonCodes' | 'screeningOutcome' | 'unresolvedFlags' | 'limitedJoints' | 'excludedExerciseIds'> = {
  maxRPE: 10,
  allowHIIT: true,
  allowMaxTests: true,
  impactCeiling: 'high',
  avoidTags: [],
  deficitNutritionAllowed: true,
  specialPopulation: 'none',
  automaticProgrammingAllowed: true,
  lowIntensityLibraryOnly: false,
  professionalGuidance: false,
  rulesVersion: SCREENING_RULES_VERSION,
};

const lowerImpact = (a: ImpactLevel, b: ImpactLevel): ImpactLevel => (IMPACT_LEVELS.indexOf(a) <= IMPACT_LEVELS.indexOf(b) ? a : b);
const sortedTags = (tags: Iterable<ContraindicationTag>) => CONTRAINDICATION_TAGS.filter((t) => new Set(tags).has(t));
const sortedJoints = (joints: Iterable<Joint>) => JOINTS.filter((j) => new Set(joints).has(j));

function apply(profile: SafetyProfile, r: Restrictions): SafetyProfile {
  return {
    ...profile,
    maxRPE: r.maxRPE === undefined ? profile.maxRPE : Math.min(profile.maxRPE, r.maxRPE),
    allowHIIT: profile.allowHIIT && r.allowHIIT !== false,
    allowMaxTests: profile.allowMaxTests && r.allowMaxTests !== false,
    impactCeiling: r.impactCeiling ? lowerImpact(profile.impactCeiling, r.impactCeiling) : profile.impactCeiling,
    avoidTags: sortedTags([...profile.avoidTags, ...(r.avoidTags ?? [])]),
  };
}

const S1_CAPS: Restrictions = { maxRPE: S1_MAX_RPE_WHILE_UNRESOLVED, allowHIIT: false, allowMaxTests: false };

/**
 * Fail-closed profile when no valid screening exists (not answered, health
 * consent missing or withdrawn, invalid input): S1 caps, low impact, no
 * deficit features, no automatic programming.
 */
export function notScreenedSafetyProfile(reasonCode = 'safety_profile.not_screened.incomplete'): SafetyProfile {
  return {
    ...apply({ ...OPEN, screeningOutcome: 'not_screened', unresolvedFlags: [], limitedJoints: [], excludedExerciseIds: [], reasonCodes: [] }, { ...S1_CAPS, impactCeiling: 'low' }),
    deficitNutritionAllowed: false,
    automaticProgrammingAllowed: false,
    reasonCodes: [reasonCode],
  };
}

/** S7: under the minimum age nothing is offered. */
export function blockedSafetyProfile(): SafetyProfile {
  return {
    ...notScreenedSafetyProfile(),
    screeningOutcome: 'blocked',
    maxRPE: 1,
    impactCeiling: 'none',
    lowIntensityLibraryOnly: true,
    reasonCodes: ['safety_profile.s7.under_minimum_age'],
  };
}

/**
 * Evaluates screening responses into a SafetyProfile. Table-driven tests in
 * screening.test.ts cover every branch.
 */
export function evaluateScreening(input: ScreeningResponses): SafetyProfile {
  const parsed = ScreeningResponsesSchema.safeParse(input);
  if (!parsed.success) return notScreenedSafetyProfile('safety_profile.not_screened.invalid');
  const responses = parsed.data;

  const age = evaluateAgeGate(responses.birthDate, responses.answeredOn);
  if (age.status === 'invalid') return notScreenedSafetyProfile('safety_profile.not_screened.invalid_birth_date');
  if (age.status === 'blocked') return blockedSafetyProfile();

  // A missing answer is never a "no".
  if (SCREENING_QUESTIONS.some((q) => responses.answers[q] === undefined)) return notScreenedSafetyProfile('safety_profile.not_screened.incomplete');
  const yes = SCREENING_QUESTIONS.filter((q) => responses.answers[q] === 'yes');

  let profile: SafetyProfile = {
    ...OPEN,
    screeningOutcome: 'cleared',
    unresolvedFlags: [],
    limitedJoints: sortedJoints(responses.limitations.map((l) => l.region)),
    excludedExerciseIds: [...new Set(responses.excludedExerciseIds)].sort(),
    reasonCodes: [],
  };
  const reasons: string[] = [];
  let restricted = profile.limitedJoints.length > 0;
  if (restricted) reasons.push('safety_profile.limitation.reported');

  const flags: ScreeningQuestionId[] = [];
  for (const q of yes) {
    const rule = SCREENING_RULES[q];
    reasons.push(rule.reasonCode);
    switch (rule.kind) {
      case 'clearance_flag':
        flags.push(q);
        profile = apply(profile, rule.afterClearance);
        break;
      case 'restriction':
        restricted = true;
        profile = apply(profile, rule.afterClearance);
        break;
      case 'special_population':
        profile = apply(profile, { ...rule.afterClearance, maxRPE: SCREENING_CONFIG.specialPopulationMaxRPE.value });
        profile = { ...profile, specialPopulation: 'pregnancy_postpartum', automaticProgrammingAllowed: false, lowIntensityLibraryOnly: true, professionalGuidance: true };
        break;
      case 'nutrition':
        profile = { ...profile, deficitNutritionAllowed: false };
        break;
    }
  }

  if (flags.length > 0) {
    profile = { ...profile, professionalGuidance: true };
    if (responses.clearanceAttested) {
      restricted = true;
      reasons.push('safety_profile.s1.clearance_attested');
    } else {
      profile = { ...apply(profile, S1_CAPS), unresolvedFlags: flags };
      reasons.push('safety_profile.s1.unresolved_flag');
    }
  }

  // S4: deficit features off under 18 (users 16–17 pass the S7 gate).
  if (ageInYears(responses.birthDate, responses.answeredOn) < S4_DEFICIT_MINIMUM_AGE_YEARS) {
    profile = { ...profile, deficitNutritionAllowed: false };
    reasons.push('safety_profile.s4.minor');
  }

  const screeningOutcome =
    profile.specialPopulation !== 'none' || profile.unresolvedFlags.length > 0 ? 'consult_professional' : restricted ? 'cleared_with_restrictions' : 'cleared';
  if (screeningOutcome === 'cleared') reasons.push('safety_profile.cleared');
  return SafetyProfileSchema.parse({ ...profile, screeningOutcome, reasonCodes: reasons });
}

/** Adds whole months in UTC, clamping to the last day of the target month. */
export function addMonths(at: Date, months: number): Date {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  return target;
}

export type RescreenStatus =
  | { readonly status: 'never_screened' }
  | { readonly status: 'current'; readonly dueAt: string }
  | { readonly status: 'due'; readonly reason: 'annual' | 'new_condition'; readonly dueAt: string };

/**
 * M01: re-screen every 12 months (config) or when the user reports a new
 * condition after the last screening. Clock injected.
 */
export function rescreenStatus(lastScreenedAt: string | null, now: Date, newConditionReportedAt: string | null = null): RescreenStatus {
  if (lastScreenedAt === null || Number.isNaN(Date.parse(lastScreenedAt))) return { status: 'never_screened' };
  const dueAt = addMonths(new Date(lastScreenedAt), SCREENING_CONFIG.rescreenIntervalMonths.value).toISOString();
  if (newConditionReportedAt !== null && Date.parse(newConditionReportedAt) > Date.parse(lastScreenedAt)) {
    return { status: 'due', reason: 'new_condition', dueAt: newConditionReportedAt };
  }
  if (now.getTime() >= Date.parse(dueAt)) return { status: 'due', reason: 'annual', dueAt };
  return { status: 'current', dueAt };
}

/** A planned piece of training, as far as S1 is concerned. */
export interface IntensityRequest {
  readonly rpe: number;
  readonly hiit: boolean;
  readonly maximalTest: boolean;
}

/**
 * S1 as a safety check for the engine (M02, M03, M07): refuses anything the
 * SafetyProfile does not allow. An unresolved flag always implies the S1 caps,
 * whatever the profile's other fields say (defence in depth).
 */
export const screeningGateCheck: SafetyCheck<{ profile: SafetyProfile; request: IntensityRequest }> = ({ profile, request }) => {
  const unresolved = profile.unresolvedFlags.length > 0 || profile.screeningOutcome === 'not_screened' || profile.screeningOutcome === 'blocked';
  const maxRPE = unresolved ? Math.min(profile.maxRPE, S1_MAX_RPE_WHILE_UNRESOLVED) : profile.maxRPE;
  if (!(request.rpe <= maxRPE)) return { invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap' };
  if (request.hiit && (unresolved || !profile.allowHIIT)) return { invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed' };
  if (request.maximalTest && (unresolved || !profile.allowMaxTests)) return { invariant: 'S1', reasonCode: 'safety.s1.max_test_not_allowed' };
  return null;
};
