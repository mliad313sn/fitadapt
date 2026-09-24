import { SCREENING_QUESTION_IDS, type SafetyProfile, type ScreeningQuestionId } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NUTRITION_SAFETY_CONFIG,
  S4_DEFICIT_MINIMUM_AGE_YEARS,
  S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK,
  S4_MIN_ENERGY_KCAL_PER_DAY,
  S4_MIN_GOAL_BMI,
  deficitFeatures,
  deficitForLossPercent,
  enforceNutritionFloors,
  evaluateSafety,
  evaluateScreening,
  impliedLossPercentPerWeek,
  minimumGoalWeightKg,
  notScreenedSafetyProfile,
  nutritionFloorCheck,
  nutritionTargetViolations,
  type CalendarDate,
  type S4Context,
} from './index.js';

/**
 * S4 nutrition floors (M10 goal condition 2): unit rows for every branch,
 * then adversarial property tests — random, hostile proposals (NaN,
 * infinities, negative and huge numbers, goal weights far below the floor,
 * rates of 5 %/week) against random profiles — prove the result always
 * satisfies S4 or fails closed.
 */
const TODAY: CalendarDate = { year: 2026, month: 9, day: 24 };
const ADULT: CalendarDate = { year: 1988, month: 3, day: 14 };
const allNo = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])) as Record<ScreeningQuestionId, 'no'>;
const screened = (yes: ScreeningQuestionId[] = [], birthDate: CalendarDate = ADULT): SafetyProfile =>
  evaluateScreening({ answers: { ...allNo, ...Object.fromEntries(yes.map((q) => [q, 'yes'])) }, clearanceAttested: false, birthDate, answeredOn: TODAY, limitations: [], excludedExerciseIds: [] });
const CLEARED = screened();
const density = NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;

const ctx = (over: Partial<S4Context> = {}): S4Context => ({ safetyProfile: CLEARED, birthDate: ADULT, today: TODAY, weightKg: 120, heightCm: 178, bmrKcal: 2127.5, maintenanceKcal: 2932, ...over });

describe('S4 constants are invariants, not configuration', () => {
  it('1 %/week, BMI 18.5 and age 18 are constants; only the energy density is a (validated:false) coefficient', () => {
    expect(S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK).toBe(1);
    expect(S4_MIN_GOAL_BMI).toBe(18.5);
    expect(S4_DEFICIT_MINIMUM_AGE_YEARS).toBe(18);
    expect(S4_MIN_ENERGY_KCAL_PER_DAY).toBe(1200);
    expect(Object.keys(NUTRITION_SAFETY_CONFIG)).toEqual(['energyDensityKcalPerKg']);
    expect(NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.validated).toBe(false);
    expect(NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.source).toMatch(/not checked against a source/);
  });
});

describe('deficitFeatures: who may get a deficit at all', () => {
  it.each([
    ['cleared adult', CLEARED, ADULT, true, []],
    ['advised against calorie restriction', screened(['advised_against_calorie_restriction']), ADULT, false, ['safety.s4.deficit_disabled']],
    ['17 years old (the day before the 18th birthday)', screened([], { year: 2008, month: 9, day: 25 }), { year: 2008, month: 9, day: 25 }, false, ['safety.s4.deficit_disabled', 'safety.s4.minor']],
    ['18 on the birthday', screened([], { year: 2008, month: 9, day: 24 }), { year: 2008, month: 9, day: 24 }, true, []],
    ['not screened', notScreenedSafetyProfile(), ADULT, false, ['safety.s4.deficit_disabled', 'safety.s4.not_screened']],
    ['pregnancy or recent birth (S7)', screened(['pregnancy_or_recent_birth']), ADULT, false, ['safety.s4.special_population']],
  ] as const)('%s', (_name, profile, birth, allowed, reasons) => {
    const r = deficitFeatures(profile, birth, TODAY);
    expect(r.allowed).toBe(allowed);
    expect(r.reasonCodes).toEqual(reasons);
  });

  it('a tampered profile that allows deficits for a minor is still refused by the birth date', () => {
    expect(deficitFeatures({ ...CLEARED, deficitNutritionAllowed: true }, { year: 2012, month: 1, day: 1 }, TODAY)).toEqual({ allowed: false, reasonCodes: ['safety.s4.minor'] });
  });

  it('fails closed on an unreadable profile, an impossible date or a future birth date', () => {
    expect(deficitFeatures({ ...CLEARED, maxRPE: 99 } as SafetyProfile, ADULT, TODAY)).toEqual({ allowed: false, reasonCodes: ['safety.s4.invalid_profile'] });
    expect(deficitFeatures(CLEARED, { year: 1990, month: 2, day: 30 }, TODAY).allowed).toBe(false);
    expect(deficitFeatures(CLEARED, { year: 2030, month: 1, day: 1 }, TODAY).allowed).toBe(false);
    expect(deficitFeatures(null as unknown as SafetyProfile, ADULT, TODAY).allowed).toBe(false);
    expect(deficitFeatures(CLEARED, null as unknown as CalendarDate, TODAY)).toEqual({ allowed: false, reasonCodes: ['safety.s4.check_failed'] });
  });
});

describe('floors and conversions', () => {
  it('the minimum goal weight is BMI 18.5 for the height, rounded up', () => {
    expect(minimumGoalWeightKg(178)).toBe(58.7); // 18.5 × 1.78² = 58.6154
    expect(minimumGoalWeightKg(165)).toBe(50.4); // 18.5 × 1.65² = 50.366
    expect(minimumGoalWeightKg(200)).toBe(74);
    expect(minimumGoalWeightKg(0)).toBeNaN();
    expect(minimumGoalWeightKg(Number.NaN)).toBeNaN();
  });

  it('a deficit and a weekly rate convert with one energy density', () => {
    expect(deficitForLossPercent(1, 120)).toBeCloseTo((0.01 * 120 * density) / 7, 6);
    expect(impliedLossPercentPerWeek(deficitForLossPercent(0.5, 80), 80)).toBeCloseTo(0.5, 9);
    expect(impliedLossPercentPerWeek(-100, 80)).toBe(0);
    expect(impliedLossPercentPerWeek(100, 0)).toBe(0);
    expect(deficitForLossPercent(-1, 80)).toBe(0);
    expect(deficitForLossPercent(Number.NaN, 80)).toBe(0);
  });
});

describe('enforceNutritionFloors', () => {
  it('keeps a proposal that is already safe', () => {
    const lowest = 2932 - deficitForLossPercent(0.5, 120);
    const r = enforceNutritionFloors({ targetKcal: Math.ceil(lowest), plannedLossPercentPerWeek: 0.5, goalWeightKg: 90 }, ctx());
    expect(r).toMatchObject({ status: 'ok', targetKcal: Math.ceil(lowest), floorKcal: 2128, deficitAllowed: true, goalWeightKg: 90, adjustments: [] });
    expect(r.status === 'ok' && r.plannedLossPercentPerWeek).toBeCloseTo(0.5, 2);
  });

  it('caps a rate above 1 %/week and a target below what 1 % allows', () => {
    const r = enforceNutritionFloors({ targetKcal: 500, plannedLossPercentPerWeek: 3, goalWeightKg: null }, ctx({ maintenanceKcal: 3500 }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.adjustments.map((a) => a.reasonCode)).toEqual(['safety.s4.rate_capped']);
    expect(r.targetKcal).toBe(Math.ceil(3500 - deficitForLossPercent(1, 120)));
    expect(r.plannedLossPercentPerWeek).toBeLessThanOrEqual(1);
  });

  it('never goes below the estimated BMR, even when 1 %/week would', () => {
    // A light, sedentary adult: maintenance barely above BMR.
    const r = enforceNutritionFloors({ targetKcal: 900, plannedLossPercentPerWeek: 1, goalWeightKg: null }, ctx({ weightKg: 70, heightCm: 160, bmrKcal: 1400, maintenanceKcal: 1680 }));
    expect(r).toMatchObject({ status: 'ok', targetKcal: 1400, floorKcal: 1400, deficitKcal: 280 });
    if (r.status === 'ok') expect(r.adjustments.map((a) => a.reasonCode)).toContain('safety.s4.bmr_floor');
  });

  it('A4/A6: never a number below 1,200 kcal/day whatever the BMR; below it the supportive mode (no number)', () => {
    // A small, older, sedentary adult (BMR ≈ 951, maintenance ≈ 1141): the BMR floor alone allowed 960 kcal/day.
    const small = ctx({ weightKg: 50, heightCm: 150, bmrKcal: 951, maintenanceKcal: 1141 });
    expect(enforceNutritionFloors({ targetKcal: 900, plannedLossPercentPerWeek: 0.5, goalWeightKg: null }, small)).toEqual({ status: 'supportive', deficitAllowed: false, adjustments: expect.arrayContaining([{ invariant: 'S4', reasonCode: 'safety.s4.absolute_floor' }]) });
    // Maintenance itself below the floor: no number for maintaining either.
    expect(enforceNutritionFloors({ targetKcal: 1141, plannedLossPercentPerWeek: 0, goalWeightKg: null }, small).status).toBe('supportive');
    // At or above the floor: a number, and the floor reported is the higher of BMR and 1,200.
    const r = enforceNutritionFloors({ targetKcal: 1200, plannedLossPercentPerWeek: 0.5, goalWeightKg: null }, ctx({ weightKg: 60, heightCm: 160, bmrKcal: 1150, maintenanceKcal: 1500 }));
    expect(r).toMatchObject({ status: 'ok', targetKcal: 1200, floorKcal: 1200 });
    expect(nutritionTargetViolations({ targetKcal: 1199, deficitKcal: 0, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx({ bmrKcal: 1000, maintenanceKcal: 1199 }))).toContainEqual({ invariant: 'S4', reasonCode: 'safety.s4.absolute_floor' });
  });

  it('refuses a goal weight below BMI 18.5', () => {
    const r = enforceNutritionFloors({ targetKcal: 2600, plannedLossPercentPerWeek: 0.5, goalWeightKg: 55 }, ctx());
    expect(r).toMatchObject({ status: 'ok', goalWeightKg: null });
    if (r.status === 'ok') expect(r.adjustments.map((a) => a.reasonCode)).toContain('safety.s4.goal_weight_below_floor');
    expect(enforceNutritionFloors({ targetKcal: 2600, plannedLossPercentPerWeek: 0.5, goalWeightKg: Number.NaN }, ctx())).toMatchObject({ goalWeightKg: null });
  });

  it('no deficit at or below the BMI floor', () => {
    const r = enforceNutritionFloors({ targetKcal: 1200, plannedLossPercentPerWeek: 0.5, goalWeightKg: null }, ctx({ weightKg: 58, heightCm: 178, bmrKcal: 1450, maintenanceKcal: 1990 }));
    expect(r).toMatchObject({ status: 'ok', targetKcal: 1990, deficitKcal: 0, plannedLossPercentPerWeek: 0, deficitAllowed: false });
    if (r.status === 'ok') expect(r.adjustments.map((a) => a.reasonCode)).toContain('safety.s4.at_bmi_floor');
  });

  it.each([
    ['a minor', { birthDate: { year: 2010, month: 5, day: 1 } }, 'safety.s4.minor'],
    ['advised against calorie restriction', { safetyProfile: screened(['advised_against_calorie_restriction']) }, 'safety.s4.deficit_disabled'],
    ['not screened', { safetyProfile: notScreenedSafetyProfile() }, 'safety.s4.not_screened'],
  ] as const)('deficit disabled for %s: the target is at least maintenance, no planned loss', (_n, over, reason) => {
    const r = enforceNutritionFloors({ targetKcal: 1800, plannedLossPercentPerWeek: 1, goalWeightKg: 80 }, ctx(over as Partial<S4Context>));
    expect(r).toMatchObject({ status: 'ok', targetKcal: 2932, deficitKcal: 0, plannedLossPercentPerWeek: 0, deficitAllowed: false });
    if (r.status === 'ok') expect(r.adjustments.map((a) => a.reasonCode)).toContain(reason);
  });

  it('a surplus is not touched (deficit rules only), a non-finite target falls back to maintenance', () => {
    expect(enforceNutritionFloors({ targetKcal: 3100, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx({ birthDate: { year: 2009, month: 1, day: 1 } }))).toMatchObject({ status: 'ok', targetKcal: 3100, adjustments: [] });
    expect(enforceNutritionFloors({ targetKcal: Number.NaN, plannedLossPercentPerWeek: Number.NaN, goalWeightKg: null }, ctx())).toMatchObject({ status: 'ok', targetKcal: 2932, plannedLossPercentPerWeek: 0 });
  });

  it('fails closed on unreadable context numbers', () => {
    for (const over of [{ weightKg: 0 }, { heightCm: Number.NaN }, { bmrKcal: -1 }, { maintenanceKcal: Number.POSITIVE_INFINITY }]) {
      expect(enforceNutritionFloors({ targetKcal: 2000, plannedLossPercentPerWeek: 0.5, goalWeightKg: null }, ctx(over))).toEqual({ status: 'invalid', deficitAllowed: false, adjustments: [{ invariant: 'S4', reasonCode: 'safety.s4.invalid_input' }] });
    }
    const hostile = { get targetKcal(): number { throw new Error('boom'); }, plannedLossPercentPerWeek: 1, goalWeightKg: null };
    expect(enforceNutritionFloors(hostile, ctx())).toEqual({ status: 'invalid', deficitAllowed: false, adjustments: [{ invariant: 'S4', reasonCode: 'safety.s4.check_failed' }] });
  });
});

describe('nutritionTargetViolations (re-checking a stored or tampered target)', () => {
  it('a safe target has no violation; each unsafe field is named', () => {
    expect(nutritionTargetViolations({ targetKcal: 2600, deficitKcal: 332, plannedLossPercentPerWeek: 0.2, goalWeightKg: 90 }, ctx())).toEqual([]);
    expect(nutritionTargetViolations({ targetKcal: 2000, deficitKcal: 932, plannedLossPercentPerWeek: 1.5, goalWeightKg: 50 }, ctx()).map((v) => v.reasonCode).sort()).toEqual(['safety.s4.bmr_floor', 'safety.s4.goal_weight_below_floor', 'safety.s4.rate_capped']);
    expect(nutritionTargetViolations({ targetKcal: 2000, deficitKcal: 0, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx({ bmrKcal: 2100 })).map((v) => v.reasonCode)).toEqual(['safety.s4.bmr_floor']);
    expect(nutritionTargetViolations({ targetKcal: 2200, deficitKcal: 1800, plannedLossPercentPerWeek: 0.5, goalWeightKg: null }, ctx({ maintenanceKcal: 4000 })).map((v) => v.reasonCode)).toEqual(['safety.s4.rate_capped']);
    expect(nutritionTargetViolations({ targetKcal: 2800, deficitKcal: 132, plannedLossPercentPerWeek: 0.1, goalWeightKg: null }, ctx({ safetyProfile: screened(['advised_against_calorie_restriction']) })).map((v) => v.reasonCode)).toEqual(['safety.s4.deficit_disabled']);
    expect(nutritionTargetViolations({ targetKcal: null, deficitKcal: 0, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx({ birthDate: { year: 2012, month: 1, day: 1 } }))).toEqual([]);
    expect(nutritionTargetViolations({ targetKcal: Number.NaN, deficitKcal: 0, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx()).map((v) => v.reasonCode)).toEqual(['safety.s4.invalid_input']);
    expect(nutritionTargetViolations({ targetKcal: 2000, deficitKcal: 0, plannedLossPercentPerWeek: Number.NaN, goalWeightKg: null }, ctx()).map((v) => v.reasonCode)).toContain('safety.s4.rate_capped');
    expect(nutritionTargetViolations(null as never, ctx())).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.check_failed' }]);
  });

  it('works as a SafetyCheck in evaluateSafety', () => {
    expect(evaluateSafety([{ invariant: 'S4', check: nutritionFloorCheck }], { target: { targetKcal: 1000, deficitKcal: 1932, plannedLossPercentPerWeek: 1, goalWeightKg: null }, ctx: ctx() }).allowed).toBe(false);
    expect(evaluateSafety([{ invariant: 'S4', check: nutritionFloorCheck }], { target: { targetKcal: 2932, deficitKcal: 0, plannedLossPercentPerWeek: 0, goalWeightKg: null }, ctx: ctx() }).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------- properties

const hostileNumber = fc.oneof(fc.double({ noNaN: false }), fc.integer({ min: -100_000, max: 100_000 }), fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0));
const date = fc.record({ year: fc.integer({ min: 1920, max: 2026 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) });
const profiles = fc.oneof(
  fc.constant(CLEARED),
  fc.constant(notScreenedSafetyProfile()),
  fc.subarray([...SCREENING_QUESTION_IDS]).map((yes) => screened(yes)),
  fc.boolean().map((allowed) => ({ ...CLEARED, deficitNutritionAllowed: allowed })),
);
const context = fc.record({
  safetyProfile: profiles,
  birthDate: date,
  today: fc.constant(TODAY),
  weightKg: fc.double({ min: 25, max: 350, noNaN: true }),
  heightCm: fc.double({ min: 100, max: 250, noNaN: true }),
  bmrKcal: fc.double({ min: 500, max: 4000, noNaN: true }),
  maintenanceKcal: fc.double({ min: 500, max: 7000, noNaN: true }),
});
const proposal = fc.record({ targetKcal: hostileNumber, plannedLossPercentPerWeek: fc.oneof(hostileNumber, fc.double({ min: 0, max: 5, noNaN: true })), goalWeightKg: fc.option(hostileNumber, { nil: null }) });
const RUNS = { numRuns: 5000 };

describe('S4 properties over random profiles and adversarial proposals (goal condition 2)', () => {
  it('target ≥ estimated BMR, planned loss ≤ 1 %/week (declared and implied), goal weight ≥ BMI 18.5', () => {
    fc.assert(
      fc.property(proposal, context, (p, c) => {
        const r = enforceNutritionFloors(p, c);
        if (r.status !== 'ok') return r.deficitAllowed === false;
        const minGoal = 18.5 * (c.heightCm / 100) ** 2;
        return (
          Number.isInteger(r.targetKcal) &&
          r.targetKcal >= c.bmrKcal &&
          r.targetKcal >= S4_MIN_ENERGY_KCAL_PER_DAY &&
          r.floorKcal >= S4_MIN_ENERGY_KCAL_PER_DAY &&
          r.plannedLossPercentPerWeek >= 0 &&
          r.plannedLossPercentPerWeek <= 1 &&
          impliedLossPercentPerWeek(Math.max(0, c.maintenanceKcal - r.targetKcal), c.weightKg) <= 1 + 1e-9 &&
          (r.goalWeightKg === null || r.goalWeightKg >= minGoal) &&
          nutritionTargetViolations(r, c).length === 0
        );
      }),
      RUNS,
    );
  });

  it('no deficit for anyone under 18, advised against calorie restriction, not screened or in a special population', () => {
    fc.assert(
      fc.property(proposal, context, (p, c) => {
        const r = enforceNutritionFloors(p, c);
        const age = TODAY.year - c.birthDate.year - (TODAY.month < c.birthDate.month || (TODAY.month === c.birthDate.month && TODAY.day < c.birthDate.day) ? 1 : 0);
        const mustBeOff = age < 18 || !c.safetyProfile.deficitNutritionAllowed || c.safetyProfile.screeningOutcome === 'not_screened' || c.safetyProfile.specialPopulation !== 'none';
        if (!mustBeOff) return true;
        // 'supportive' (below the absolute floor) and 'invalid' give no number at all, so no deficit either.
        return r.deficitAllowed === false && (r.status !== 'ok' || (r.plannedLossPercentPerWeek === 0 && r.deficitKcal === 0 && r.targetKcal >= c.maintenanceKcal));
      }),
      RUNS,
    );
  });

  it('A4/A6 absolute floor: a number is never below max(BMR, 1,200 kcal/day); the supportive mode exactly when the S4 target would be', () => {
    fc.assert(
      fc.property(proposal, context, (p, c) => {
        const r = enforceNutritionFloors(p, c);
        if (r.status === 'ok') return r.targetKcal >= Math.max(Math.ceil(c.bmrKcal), S4_MIN_ENERGY_KCAL_PER_DAY) && nutritionTargetViolations(r, c).length === 0;
        if (r.status === 'supportive') return r.deficitAllowed === false && r.adjustments.some((a) => a.reasonCode === 'safety.s4.absolute_floor');
        return r.deficitAllowed === false;
      }),
      RUNS,
    );
  });

  it('the check catches every tampering of a safe target that breaks S4', () => {
    fc.assert(
      fc.property(context, fc.double({ min: 0, max: 8000, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), fc.option(fc.double({ min: 20, max: 200, noNaN: true }), { nil: null }), (c, targetKcal, rate, goal) => {
        const minGoal = minimumGoalWeightKg(c.heightCm);
        const features = deficitFeatures(c.safetyProfile, c.birthDate, c.today);
        const allowed = features.allowed && c.weightKg > minGoal;
        const deficit = Math.max(0, c.maintenanceKcal - targetKcal);
        const unsafe =
          targetKcal < Math.ceil(c.bmrKcal) ||
          targetKcal < S4_MIN_ENERGY_KCAL_PER_DAY ||
          rate > 1 ||
          impliedLossPercentPerWeek(deficit, c.weightKg) > 1 + 1e-9 ||
          (goal !== null && goal < minGoal) ||
          (!allowed && (rate > 0 || deficit >= 1));
        const found = nutritionTargetViolations({ targetKcal, deficitKcal: Math.floor(deficit), plannedLossPercentPerWeek: rate, goalWeightKg: goal }, c).length > 0;
        return unsafe === found;
      }),
      RUNS,
    );
  });
});
