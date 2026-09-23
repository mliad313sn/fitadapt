import { CONTRAINDICATION_TAGS, SCREENING_QUESTION_IDS, type ContraindicationTag, SafetyProfileSchema, type SafetyProfile, type ScreeningQuestionId, type ScreeningResponses } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AGE_GATE_MINIMUM_YEARS,
  S1_MAX_RPE_WHILE_UNRESOLVED,
  SCREENING_CONFIG,
  SCREENING_RULES,
  addMonths,
  blockedSafetyProfile,
  evaluateSafety,
  evaluateScreening,
  notScreenedSafetyProfile,
  rescreenStatus,
  screeningGateCheck,
  unvalidatedScreeningRules,
  type CalendarDate,
} from './index.js';

const TODAY: CalendarDate = { year: 2026, month: 9, day: 23 };
const ADULT: CalendarDate = { year: 1988, month: 3, day: 14 };
const allNo = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])) as Record<ScreeningQuestionId, 'no'>;

function responses(overrides: Partial<ScreeningResponses> & { yes?: ScreeningQuestionId[] } = {}): ScreeningResponses {
  const { yes = [], ...rest } = overrides;
  return {
    answers: { ...allNo, ...Object.fromEntries(yes.map((q) => [q, 'yes'])) },
    clearanceAttested: false,
    birthDate: ADULT,
    answeredOn: TODAY,
    limitations: [],
    excludedExerciseIds: [],
    ...rest,
  };
}

/** The fields that matter per branch; every row is also schema-valid. */
type Expect = Partial<Pick<SafetyProfile, 'screeningOutcome' | 'maxRPE' | 'allowHIIT' | 'allowMaxTests' | 'impactCeiling' | 'avoidTags' | 'unresolvedFlags' | 'deficitNutritionAllowed' | 'specialPopulation' | 'automaticProgrammingAllowed' | 'lowIntensityLibraryOnly' | 'professionalGuidance' | 'limitedJoints'>> & { reasons?: string[] };

const S1_CAPPED = { maxRPE: S1_MAX_RPE_WHILE_UNRESOLVED, allowHIIT: false, allowMaxTests: false } as const;

/** Tags are reported in taxonomy order. */
const inTagOrder = (tags: readonly ContraindicationTag[]) => CONTRAINDICATION_TAGS.filter((t) => tags.includes(t));

const clearanceFlags = SCREENING_QUESTION_IDS.filter((q) => SCREENING_RULES[q].kind === 'clearance_flag');

const table: Array<{ name: string; input: ScreeningResponses; expect: Expect }> = [
  {
    name: 'all no → cleared, nothing restricted',
    input: responses(),
    expect: {
      screeningOutcome: 'cleared',
      maxRPE: 10,
      allowHIIT: true,
      allowMaxTests: true,
      impactCeiling: 'high',
      avoidTags: [],
      unresolvedFlags: [],
      deficitNutritionAllowed: true,
      specialPopulation: 'none',
      automaticProgrammingAllowed: true,
      lowIntensityLibraryOnly: false,
      professionalGuidance: false,
      reasons: ['safety_profile.cleared'],
    },
  },
  // Every single "yes", one row each.
  ...clearanceFlags.map((q) => ({
    name: `single yes: ${q} → consult a professional, S1 caps until clearance`,
    input: responses({ yes: [q] }),
    expect: {
      screeningOutcome: 'consult_professional' as const,
      ...S1_CAPPED,
      unresolvedFlags: [q],
      professionalGuidance: true,
      deficitNutritionAllowed: true,
      automaticProgrammingAllowed: true,
      avoidTags: inTagOrder(SCREENING_RULES[q].afterClearance.avoidTags ?? []),
      reasons: [SCREENING_RULES[q].reasonCode, 'safety_profile.s1.unresolved_flag'],
    },
  })),
  {
    name: 'single yes: bone_joint_back → cleared with restrictions (low impact, no jumping), no S1 cap',
    input: responses({ yes: ['bone_joint_back'] }),
    expect: { screeningOutcome: 'cleared_with_restrictions', maxRPE: 10, allowHIIT: true, allowMaxTests: true, impactCeiling: 'low', avoidTags: ['jumping_landing'], unresolvedFlags: [] },
  },
  {
    name: 'single yes: pregnancy_or_recent_birth → professional guidance and low-intensity library only (S7)',
    input: responses({ yes: ['pregnancy_or_recent_birth'] }),
    expect: {
      screeningOutcome: 'consult_professional',
      specialPopulation: 'pregnancy_postpartum',
      automaticProgrammingAllowed: false,
      lowIntensityLibraryOnly: true,
      professionalGuidance: true,
      maxRPE: SCREENING_CONFIG.specialPopulationMaxRPE.value,
      allowHIIT: false,
      allowMaxTests: false,
      impactCeiling: 'low',
      unresolvedFlags: [],
    },
  },
  {
    name: 'pregnancy is not lifted by an attested clearance (S7 in v1)',
    input: responses({ yes: ['pregnancy_or_recent_birth'], clearanceAttested: true }),
    expect: { screeningOutcome: 'consult_professional', specialPopulation: 'pregnancy_postpartum', automaticProgrammingAllowed: false, lowIntensityLibraryOnly: true, allowHIIT: false },
  },
  {
    name: 'single yes: advised_against_calorie_restriction → deficit features off, training cleared (S4)',
    input: responses({ yes: ['advised_against_calorie_restriction'] }),
    expect: { screeningOutcome: 'cleared', deficitNutritionAllowed: false, maxRPE: 10, allowHIIT: true, reasons: ['safety_profile.s4.advised_against_calorie_restriction', 'safety_profile.cleared'] },
  },
  {
    name: 'age 15 (one day before the 16th birthday) → blocked (S7)',
    input: responses({ birthDate: { year: 2010, month: 9, day: 24 } }),
    expect: { screeningOutcome: 'blocked', automaticProgrammingAllowed: false, allowHIIT: false, allowMaxTests: false, deficitNutritionAllowed: false, impactCeiling: 'none', lowIntensityLibraryOnly: true },
  },
  {
    name: 'age 12 → blocked (S7)',
    input: responses({ birthDate: { year: 2014, month: 1, day: 1 } }),
    expect: { screeningOutcome: 'blocked', reasons: ['safety_profile.s7.under_minimum_age'] },
  },
  {
    name: 'age 16 on the birthday → allowed, deficit features disabled (S4)',
    input: responses({ birthDate: { year: 2010, month: 9, day: 23 } }),
    expect: { screeningOutcome: 'cleared', deficitNutritionAllowed: false, maxRPE: 10, reasons: ['safety_profile.s4.minor', 'safety_profile.cleared'] },
  },
  {
    name: 'age 17 → allowed, deficit features disabled (S4)',
    input: responses({ birthDate: { year: 2009, month: 1, day: 1 } }),
    expect: { screeningOutcome: 'cleared', deficitNutritionAllowed: false },
  },
  {
    name: 'age 18 on the birthday → deficit features allowed',
    input: responses({ birthDate: { year: 2008, month: 9, day: 23 } }),
    expect: { screeningOutcome: 'cleared', deficitNutritionAllowed: true },
  },
  {
    name: 'flag with an attested clearance → cleared with restrictions, S1 caps lifted, residual restrictions kept (P4-like)',
    input: responses({ yes: ['heart_or_blood_pressure'], clearanceAttested: true }),
    expect: {
      screeningOutcome: 'cleared_with_restrictions',
      unresolvedFlags: [],
      maxRPE: 10,
      allowHIIT: true,
      allowMaxTests: true,
      avoidTags: inTagOrder(['inversion', 'breath_hold_bracing']),
      professionalGuidance: true,
      reasons: ['safety_profile.flag.heart_or_blood_pressure', 'safety_profile.s1.clearance_attested'],
    },
  },
  {
    name: 'a clearance attested without any flag changes nothing',
    input: responses({ clearanceAttested: true }),
    expect: { screeningOutcome: 'cleared', maxRPE: 10 },
  },
  {
    name: 'reported limitation → cleared with restrictions, joint listed',
    input: responses({ limitations: [{ region: 'knee' }, { region: 'shoulder' }, { region: 'knee' }] }),
    expect: { screeningOutcome: 'cleared_with_restrictions', limitedJoints: ['shoulder', 'knee'], maxRPE: 10 },
  },
  {
    name: 'several flags combine: strictest of each field wins',
    input: responses({ yes: ['fainting_or_dizziness', 'bone_joint_back', 'advised_against_calorie_restriction'] }),
    expect: {
      screeningOutcome: 'consult_professional',
      ...S1_CAPPED,
      impactCeiling: 'low',
      avoidTags: inTagOrder(['jumping_landing', 'high_balance_demand', 'inversion']),
      unresolvedFlags: ['fainting_or_dizziness'],
      deficitNutritionAllowed: false,
    },
  },
  {
    name: 'an unanswered question is not a "no" → not screened (fails closed)',
    input: { ...responses(), answers: Object.fromEntries(Object.entries(allNo).filter(([q]) => q !== 'chest_discomfort')) },
    expect: { screeningOutcome: 'not_screened', ...S1_CAPPED, automaticProgrammingAllowed: false, deficitNutritionAllowed: false, reasons: ['safety_profile.not_screened.incomplete'] },
  },
  {
    name: 'an impossible birth date → not screened',
    input: responses({ birthDate: { year: 2001, month: 2, day: 29 } }),
    expect: { screeningOutcome: 'not_screened', ...S1_CAPPED, reasons: ['safety_profile.not_screened.invalid_birth_date'] },
  },
  {
    name: 'a malformed response set → not screened',
    input: { ...responses(), answers: { ...allNo, chest_discomfort: 'maybe' } } as unknown as ScreeningResponses,
    expect: { screeningOutcome: 'not_screened', ...S1_CAPPED, reasons: ['safety_profile.not_screened.invalid'] },
  },
];

describe('evaluateScreening (table-driven, goal condition 2)', () => {
  it('covers every question with a single-yes row', () => {
    for (const q of SCREENING_QUESTION_IDS) expect(table.some((row) => row.name.startsWith(`single yes: ${q}`))).toBe(true);
  });

  it.each(table)('$name', ({ input, expect: want }) => {
    const profile = evaluateScreening(input);
    expect(SafetyProfileSchema.safeParse(profile).success).toBe(true);
    const { reasons, ...fields } = want;
    expect(profile).toMatchObject(fields);
    if (reasons) expect(profile.reasonCodes).toEqual(reasons);
    // Every output is attributed to the rules version.
    expect(profile.rulesVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the user’s excluded exercises, de-duplicated', () => {
    expect(evaluateScreening(responses({ excludedExerciseIds: ['burpee', 'air_squat', 'burpee'] })).excludedExerciseIds).toEqual(['air_squat', 'burpee']);
  });

  it('uses the M17 age-gate constant (16), which cannot be lowered', () => {
    expect(AGE_GATE_MINIMUM_YEARS).toBe(16);
    expect(evaluateScreening(responses({ birthDate: { year: TODAY.year - 16, month: TODAY.month, day: TODAY.day } })).screeningOutcome).toBe('cleared');
  });

  it('fail-closed profiles are the most restrictive ones', () => {
    for (const p of [notScreenedSafetyProfile(), blockedSafetyProfile()]) {
      expect(SafetyProfileSchema.safeParse(p).success).toBe(true);
      expect(p).toMatchObject({ allowHIIT: false, allowMaxTests: false, automaticProgrammingAllowed: false, deficitNutritionAllowed: false });
      expect(p.maxRPE).toBeLessThanOrEqual(S1_MAX_RPE_WHILE_UNRESOLVED);
    }
    expect(notScreenedSafetyProfile('safety_profile.not_screened.no_consent').reasonCodes).toEqual(['safety_profile.not_screened.no_consent']);
  });

  it('every screening rule awaits seat A1 review (validated:false)', () => {
    expect(unvalidatedScreeningRules()).toEqual([...SCREENING_QUESTION_IDS]);
    for (const q of SCREENING_QUESTION_IDS) expect(SCREENING_RULES[q]).toMatchObject({ validated: false, reviewSeat: 'A1' });
    for (const v of Object.values(SCREENING_CONFIG)) expect(v.validated).toBe(false);
  });
});

const arbAnswers = fc.record(Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, fc.constantFrom('yes' as const, 'no' as const)])) as Record<ScreeningQuestionId, fc.Arbitrary<'yes' | 'no'>>);
const arbResponses: fc.Arbitrary<ScreeningResponses> = fc.record({
  answers: arbAnswers,
  clearanceAttested: fc.boolean(),
  birthDate: fc.record({ year: fc.integer({ min: 1930, max: 2020 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) }),
  answeredOn: fc.constant(TODAY),
  limitations: fc.subarray([{ region: 'knee' as const }, { region: 'lumbar' as const }]),
  excludedExerciseIds: fc.constant([]),
});

describe('screening properties', () => {
  it('S1: an unresolved flag always means RPE ≤ 7, no HIIT, no maximal test', () => {
    fc.assert(
      fc.property(arbResponses, (r) => {
        const p = evaluateScreening(r);
        return p.unresolvedFlags.length === 0 || (p.maxRPE <= S1_MAX_RPE_WHILE_UNRESOLVED && !p.allowHIIT && !p.allowMaxTests);
      }),
      { numRuns: 2000 },
    );
  });

  it('S1: a flag answered yes stays unresolved until clearance is attested', () => {
    fc.assert(
      fc.property(arbResponses, (r) => {
        const p = evaluateScreening(r);
        if (p.screeningOutcome === 'blocked') return true;
        const flagged = clearanceFlags.filter((q) => r.answers[q] === 'yes');
        return r.clearanceAttested ? p.unresolvedFlags.length === 0 : p.unresolvedFlags.length === flagged.length;
      }),
      { numRuns: 2000 },
    );
  });

  it('S4/S7: under 18 never gets deficit features; pregnancy never gets automatic programming; under 16 is always blocked', () => {
    fc.assert(
      fc.property(arbResponses, (r) => {
        const p = evaluateScreening(r);
        const age = TODAY.year - r.birthDate.year - (TODAY.month < r.birthDate.month || (TODAY.month === r.birthDate.month && TODAY.day < r.birthDate.day) ? 1 : 0);
        if (age < 16) return p.screeningOutcome === 'blocked';
        if (age < 18 && p.deficitNutritionAllowed) return false;
        if (r.answers.advised_against_calorie_restriction === 'yes' && p.deficitNutritionAllowed) return false;
        if (r.answers.pregnancy_or_recent_birth === 'yes' && (p.automaticProgrammingAllowed || !p.lowIntensityLibraryOnly)) return false;
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  it('answering an extra "yes" never loosens any field (monotone)', () => {
    fc.assert(
      fc.property(arbResponses, fc.constantFrom(...SCREENING_QUESTION_IDS), (r, q) => {
        const before = evaluateScreening(r);
        const after = evaluateScreening({ ...r, answers: { ...r.answers, [q]: 'yes' } });
        const impact = ['none', 'low', 'moderate', 'high'];
        return (
          after.maxRPE <= before.maxRPE &&
          (!after.allowHIIT || before.allowHIIT) &&
          (!after.allowMaxTests || before.allowMaxTests) &&
          impact.indexOf(after.impactCeiling) <= impact.indexOf(before.impactCeiling) &&
          before.avoidTags.every((t) => after.avoidTags.includes(t)) &&
          (!after.deficitNutritionAllowed || before.deficitNutritionAllowed) &&
          (!after.automaticProgrammingAllowed || before.automaticProgrammingAllowed)
        );
      }),
      { numRuns: 2000 },
    );
  });
});

describe('re-screening (every 12 months or on a new condition)', () => {
  it('is due exactly 12 months after the last screening', () => {
    const at = '2026-09-23T10:00:00.000Z';
    expect(rescreenStatus(at, new Date('2027-09-23T09:59:59.999Z'))).toEqual({ status: 'current', dueAt: '2027-09-23T10:00:00.000Z' });
    expect(rescreenStatus(at, new Date('2027-09-23T10:00:00.000Z'))).toEqual({ status: 'due', reason: 'annual', dueAt: '2027-09-23T10:00:00.000Z' });
  });

  it('is due at once when a new condition is reported after the last screening', () => {
    expect(rescreenStatus('2026-09-23T10:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'), '2026-09-30T08:00:00.000Z')).toEqual({ status: 'due', reason: 'new_condition', dueAt: '2026-09-30T08:00:00.000Z' });
    expect(rescreenStatus('2026-09-23T10:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'), '2026-09-01T08:00:00.000Z').status).toBe('current');
  });

  it('asks for a first screening when none exists', () => {
    expect(rescreenStatus(null, new Date())).toEqual({ status: 'never_screened' });
    expect(rescreenStatus('not a date', new Date())).toEqual({ status: 'never_screened' });
  });

  it('adds months in UTC and clamps to the end of the month', () => {
    expect(addMonths(new Date('2024-02-29T12:00:00.000Z'), 12).toISOString()).toBe('2025-02-28T12:00:00.000Z');
    expect(addMonths(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('S1 screening gate check (for the engine)', () => {
  const cleared = evaluateScreening(responses());
  const flagged = evaluateScreening(responses({ yes: ['chest_discomfort'] }));
  const gate = (profile: SafetyProfile, request: { rpe: number; hiit: boolean; maximalTest: boolean }) => evaluateSafety([{ invariant: 'S1', check: screeningGateCheck }], { profile, request });

  it('allows anything within the profile', () => {
    expect(gate(cleared, { rpe: 9, hiit: true, maximalTest: true }).allowed).toBe(true);
    expect(gate(flagged, { rpe: 7, hiit: false, maximalTest: false }).allowed).toBe(true);
  });

  it('refuses RPE above 7, HIIT and maximal tests with an unresolved flag', () => {
    expect(gate(flagged, { rpe: 7.5, hiit: false, maximalTest: false }).violations).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap' }]);
    expect(gate(flagged, { rpe: 5, hiit: true, maximalTest: false }).violations).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed' }]);
    expect(gate(flagged, { rpe: 5, hiit: false, maximalTest: true }).violations).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.max_test_not_allowed' }]);
  });

  it('property: a tampered profile (flag kept, caps removed) still cannot pass the S1 caps', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10, noNaN: true }), fc.boolean(), fc.boolean(), (rpe, hiit, maximalTest) => {
        const tampered: SafetyProfile = { ...flagged, maxRPE: 10, allowHIIT: true, allowMaxTests: true };
        const decision = gate(tampered, { rpe, hiit, maximalTest });
        return decision.allowed === (rpe <= S1_MAX_RPE_WHILE_UNRESOLVED && !hiit && !maximalTest);
      }),
    );
  });

  it('fails closed on a NaN intensity', () => {
    expect(gate(cleared, { rpe: Number.NaN, hiit: false, maximalTest: false }).allowed).toBe(false);
  });
});
