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
  strictestSafetyProfile,
  trainingHoldCheck,
  trainingHoldFlags,
  unvalidatedScreeningRules,
  deficitFeatures,
  holdsUntilClearance,
  TRAINING_HOLD_REASON,
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
type Expect = Partial<Pick<SafetyProfile, 'screeningOutcome' | 'maxRPE' | 'allowHIIT' | 'allowMaxTests' | 'impactCeiling' | 'avoidTags' | 'unresolvedFlags' | 'deficitNutritionAllowed' | 'specialPopulation' | 'automaticProgrammingAllowed' | 'lowIntensityLibraryOnly' | 'professionalGuidance' | 'limitedJoints' | 'heartRateZonesAllowed'>> & { reasons?: string[] };

const S1_CAPPED = { maxRPE: S1_MAX_RPE_WHILE_UNRESOLVED, allowHIIT: false, allowMaxTests: false } as const;

/** Tags are reported in taxonomy order. */
const inTagOrder = (tags: readonly ContraindicationTag[]) => CONTRAINDICATION_TAGS.filter((t) => tags.includes(t));

const clearanceFlags = SCREENING_QUESTION_IDS.filter((q) => SCREENING_RULES[q].kind === 'clearance_flag');
/** FIX-B (CS-1): symptom flags and "advised to limit activity" hold all training until clearance (stricter than S1). */
const HOLDING_FLAGS: readonly ScreeningQuestionId[] = ['chest_discomfort', 'fainting_or_dizziness', 'unusual_breathlessness', 'advised_to_limit_activity'];
const cappedFlags = clearanceFlags.filter((q) => !HOLDING_FLAGS.includes(q));

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
  ...cappedFlags.map((q) => ({
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
  // FIX-B (CS-1): stricter than the S1 caps — no automatic programming, session or assessment until clearance.
  ...HOLDING_FLAGS.map((q) => ({
    name: `single yes: ${q} → consult a professional, training HELD until clearance (stricter than S1)`,
    input: responses({ yes: [q] }),
    expect: {
      screeningOutcome: 'consult_professional' as const,
      ...S1_CAPPED,
      unresolvedFlags: [q],
      professionalGuidance: true,
      deficitNutritionAllowed: true,
      automaticProgrammingAllowed: false,
      avoidTags: inTagOrder(SCREENING_RULES[q].afterClearance.avoidTags ?? []),
      reasons: [SCREENING_RULES[q].reasonCode, 'safety_profile.s1.unresolved_flag', TRAINING_HOLD_REASON],
    },
  })),
  {
    name: 'a holding flag with an attested clearance → the hold is lifted, after-clearance restrictions kept',
    input: responses({ yes: ['fainting_or_dizziness'], clearanceAttested: true }),
    expect: { screeningOutcome: 'cleared_with_restrictions', unresolvedFlags: [], automaticProgrammingAllowed: true, maxRPE: 10, avoidTags: inTagOrder(['inversion', 'high_balance_demand']) },
  },
  {
    name: 'single yes: medication_affecting_heart_rate → effort-based zones (no heart-rate zones), before and after clearance (CS-7)',
    input: responses({ yes: ['medication_affecting_heart_rate'] }),
    expect: { screeningOutcome: 'cleared_with_restrictions', heartRateZonesAllowed: false, unresolvedFlags: [], maxRPE: 10, automaticProgrammingAllowed: true, reasons: ['safety_profile.restriction.medication_affecting_heart_rate'] },
  },
  {
    name: 'single yes: eating_disorder → deficit features off, training cleared (S4, A4 M10-20)',
    input: responses({ yes: ['eating_disorder'] }),
    expect: { screeningOutcome: 'cleared', deficitNutritionAllowed: false, maxRPE: 10, heartRateZonesAllowed: true, reasons: ['safety_profile.s4.eating_disorder', 'safety_profile.cleared'] },
  },
  {
    name: 'medication_affecting_effort, cleared → heart-rate zones still not used (CS-7)',
    input: responses({ yes: ['medication_affecting_effort'], clearanceAttested: true }),
    expect: { screeningOutcome: 'cleared_with_restrictions', heartRateZonesAllowed: false, unresolvedFlags: [] },
  },
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
    // The eating-disorder answer is led by seat A4 (nutrition), with A1 (FIX-B).
    for (const q of SCREENING_QUESTION_IDS) expect(SCREENING_RULES[q]).toMatchObject({ validated: false, reviewSeat: q === 'eating_disorder' ? 'A4' : 'A1' });
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
          (!after.automaticProgrammingAllowed || before.automaticProgrammingAllowed) &&
          (after.heartRateZonesAllowed !== true || before.heartRateZonesAllowed === true) &&
          trainingHoldFlags(before).every((f) => trainingHoldFlags(after).includes(f))
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
  // A flag that caps (FIX-B: chest discomfort now holds; see the hold tests below).
  const flagged = evaluateScreening(responses({ yes: ['heart_or_blood_pressure'] }));
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

describe('FIX-B (CS-1): symptom flags hold all training until clearance (stricter than S1)', () => {
  const gate = (profile: SafetyProfile, request: { rpe: number; hiit: boolean; maximalTest: boolean }) => evaluateSafety([{ invariant: 'S1', check: screeningGateCheck }], { profile, request });

  it('the holding flags are exactly the symptom flags and "advised to limit activity", sourced to the A1/A2 pre-review', () => {
    expect(SCREENING_QUESTION_IDS.filter(holdsUntilClearance)).toEqual(HOLDING_FLAGS);
    for (const q of HOLDING_FLAGS) expect(SCREENING_RULES[q]).toMatchObject({ validated: false, source: expect.stringContaining('A1-A2-clinical-safety.md') });
  });

  it('refuses even the lightest request while a holding flag is unresolved (sessions, assessments, programs)', () => {
    const held = evaluateScreening(responses({ yes: ['chest_discomfort'] }));
    expect(trainingHoldFlags(held)).toEqual(['chest_discomfort']);
    expect(gate(held, { rpe: 1, hiit: false, maximalTest: false }).violations).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.training_hold' }]);
    expect(trainingHoldCheck({ profile: held })).toEqual({ invariant: 'S1', reasonCode: 'safety.s1.training_hold' });
    expect(trainingHoldCheck({ profile: evaluateScreening(responses({ yes: ['heart_or_blood_pressure'] })) })).toBeNull();
    expect(trainingHoldCheck({ profile: evaluateScreening(responses({ yes: ['chest_discomfort'], clearanceAttested: true })) })).toBeNull();
  });

  it('property: any response set with a holding flag and no clearance → no automatic programming and every request refused', () => {
    fc.assert(
      fc.property(arbResponses, fc.constantFrom(...HOLDING_FLAGS), fc.double({ min: 0, max: 10, noNaN: true }), fc.boolean(), fc.boolean(), (r, q, rpe, hiit, maximalTest) => {
        const p = evaluateScreening({ ...r, answers: { ...r.answers, [q]: 'yes' }, clearanceAttested: false });
        if (p.screeningOutcome === 'blocked') return !p.automaticProgrammingAllowed;
        return !p.automaticProgrammingAllowed && trainingHoldFlags(p).includes(q) && !gate(p, { rpe, hiit, maximalTest }).allowed;
      }),
      { numRuns: 2000 },
    );
  });

  it('property: a tampered held profile (every permission reopened) is still refused', () => {
    const held = evaluateScreening(responses({ yes: ['unusual_breathlessness'] }));
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10, noNaN: true }), fc.boolean(), fc.boolean(), (rpe, hiit, maximalTest) => {
        const tampered: SafetyProfile = { ...held, maxRPE: 10, allowHIIT: true, allowMaxTests: true, automaticProgrammingAllowed: true, screeningOutcome: 'cleared' };
        return !gate(tampered, { rpe, hiit, maximalTest }).allowed;
      }),
    );
  });

  it('property: combining screenings keeps any hold (a clearance in one screening never lifts a hold raised in another)', () => {
    fc.assert(
      fc.property(fc.array(arbResponses, { minLength: 2, maxLength: 4 }), (rs) => {
        const profiles = rs.map(evaluateScreening);
        const combined = strictestSafetyProfile(profiles);
        const anyHeld = profiles.some((p) => trainingHoldFlags(p).length > 0);
        return !anyHeld || (trainingHoldFlags(combined).length > 0 && !combined.automaticProgrammingAllowed);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('FIX-B (CS-7): heart-rate zones only when no medicine may change the heart-rate response', () => {
  it('property: either medication answer "yes" never allows heart-rate zones; not screened never allows them', () => {
    fc.assert(
      fc.property(arbResponses, (r) => {
        const p = evaluateScreening(r);
        const med = r.answers.medication_affecting_heart_rate === 'yes' || r.answers.medication_affecting_effort === 'yes';
        if (p.screeningOutcome === 'blocked' || p.screeningOutcome === 'not_screened') return p.heartRateZonesAllowed === false;
        return p.heartRateZonesAllowed === !med;
      }),
      { numRuns: 2000 },
    );
    expect(notScreenedSafetyProfile().heartRateZonesAllowed).toBe(false);
    expect(blockedSafetyProfile().heartRateZonesAllowed).toBe(false);
  });

  it('a combination allows heart-rate zones only if every screening does; a profile without the field counts as "not allowed"', () => {
    const open = evaluateScreening(responses());
    const med = evaluateScreening(responses({ yes: ['medication_affecting_heart_rate'] }));
    expect(strictestSafetyProfile([open, med]).heartRateZonesAllowed).toBe(false);
    const { heartRateZonesAllowed: _drop, ...legacy } = open;
    expect(strictestSafetyProfile([open, legacy as SafetyProfile]).heartRateZonesAllowed).toBe(false);
    expect(strictestSafetyProfile([open, open]).heartRateZonesAllowed).toBe(true);
  });
});

describe('FIX-B (A4 M10-20): a self-reported eating disorder switches deficit features off with its own reason', () => {
  it('deficitFeatures names the eating-disorder reason (signposting copy), not "advised against"', () => {
    const p = evaluateScreening(responses({ yes: ['eating_disorder'] }));
    expect(deficitFeatures(p, ADULT, TODAY)).toEqual({ allowed: false, reasonCodes: ['safety.s4.eating_disorder'] });
    const both = evaluateScreening(responses({ yes: ['eating_disorder', 'advised_against_calorie_restriction'] }));
    expect(deficitFeatures(both, ADULT, TODAY).reasonCodes).toEqual(['safety.s4.eating_disorder', 'safety.s4.deficit_disabled']);
    expect(deficitFeatures(evaluateScreening(responses({ yes: ['advised_against_calorie_restriction'] })), ADULT, TODAY).reasonCodes).toEqual(['safety.s4.deficit_disabled']);
  });

  it('property: an eating-disorder "yes" never allows deficit features, whatever else is answered', () => {
    fc.assert(
      fc.property(arbResponses, (r) => {
        const p = evaluateScreening({ ...r, answers: { ...r.answers, eating_disorder: 'yes' } });
        return !p.deficitNutritionAllowed && !deficitFeatures(p, r.birthDate, TODAY).allowed;
      }),
      { numRuns: 1000 },
    );
  });
});
