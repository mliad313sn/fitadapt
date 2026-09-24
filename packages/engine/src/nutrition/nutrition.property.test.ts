import { NUTRITION_SAFETY_CONFIG, ageInYears, evaluateScreening, notScreenedSafetyProfile, nutritionTargetViolations } from '@fitadapt/safety';
import { ACTIVITY_LEVELS, ESTIMATE_SEXES, NUTRITION_GOALS, NutritionTargetSchema, SCREENING_QUESTION_IDS, type NutritionInput, type ScreeningQuestionId } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { addDays } from '../program/dates.js';
import { calendarOf, computeNutritionTarget } from './index.js';

/**
 * M10 goal condition 2 through the whole engine: for random profiles
 * (age 16–90, 25–350 kg, 100–250 cm, every sex option, activity level,
 * goal, requested pace up to 5 %/week, goal weights far below the floor,
 * random screening answers, adaptive observations and guardrail events),
 * the target the engine prescribes always satisfies S4 — the independent
 * Mifflin-St Jeor BMR is recomputed here from the published equation.
 */
const TODAY = '2026-09-24';
const today = calendarOf(TODAY);
const allNo = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])) as Record<ScreeningQuestionId, 'no'>;
const density = NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;
const SEX = { male: 5, female: -161, unspecified: -78 } as const;

const birth = fc.record({ year: fc.integer({ min: 1936, max: 2010 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) });
const input: fc.Arbitrary<NutritionInput> = fc
  .record({
    birthDate: birth,
    yes: fc.subarray([...SCREENING_QUESTION_IDS], { maxLength: 3 }),
    unscreened: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
    goal: fc.constantFrom(...NUTRITION_GOALS),
    trackingStyle: fc.constantFrom('numbers' as const, 'numbers' as const, 'habits' as const),
    activityLevel: fc.constantFrom(...ACTIVITY_LEVELS),
    sexForEstimate: fc.constantFrom(...ESTIMATE_SEXES),
    weightKg: fc.option(fc.double({ min: 25, max: 350, noNaN: true }), { nil: null, freq: 10 }),
    heightCm: fc.option(fc.double({ min: 100, max: 250, noNaN: true }), { nil: null, freq: 10 }),
    plannedLossPercentPerWeek: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: null }),
    goalWeightKg: fc.option(fc.double({ min: 25, max: 350, noNaN: true }), { nil: null }),
    guardrailEvents: fc.array(fc.integer({ min: 0, max: 90 }).map((d) => addDays(TODAY, -d)), { maxLength: 3 }),
    adaptive: fc.option(
      fc.record({ loggedDays: fc.integer({ min: 0, max: 14 }), meanIntakeKcal: fc.integer({ min: 0, max: 20_000 }), trendChangeKg: fc.double({ min: -50, max: 50, noNaN: true }) }).map((a) => ({ from: addDays(TODAY, -14), to: addDays(TODAY, -1), windowDays: 14, ...a })),
      { nil: null },
    ),
    previousExpenditureKcal: fc.option(fc.double({ min: 1, max: 10_000, noNaN: true }), { nil: null }),
  })
  .map(({ yes, unscreened, ...r }) => ({
    schemaVersion: 1 as const,
    today: TODAY,
    ...r,
    guardrailEvents: [...r.guardrailEvents].sort(),
    safetyProfile: unscreened ? notScreenedSafetyProfile() : evaluateScreening({ answers: { ...allNo, ...Object.fromEntries(yes.map((q) => [q, 'yes'])) }, clearanceAttested: false, birthDate: r.birthDate, answeredOn: today, limitations: [], excludedExerciseIds: [] }),
  }));

const ctx = createEngineContext({ clock: fixedClock(Date.parse(`${TODAY}T08:00:00Z`)), seed: 3 });
const RUNS = { numRuns: 3000 };

describe('S4 over random profiles, through computeNutritionTarget (goal condition 2)', () => {
  it('target ≥ estimated BMR; planned loss ≤ 1 %/week (declared and implied by the deficit); no goal weight below BMI 18.5', () => {
    fc.assert(
      fc.property(input, (i) => {
        const { target } = computeNutritionTarget(i, ctx);
        expect(NutritionTargetSchema.safeParse(target).success).toBe(true);
        expect(target.plannedLossPercentPerWeek).toBeLessThanOrEqual(1);
        if (target.goalWeightKg !== null) expect(target.goalWeightKg).toBeGreaterThanOrEqual(18.5 * (i.heightCm! / 100) ** 2);
        if (target.energy === null) return;
        const age = ageInYears(i.birthDate, today);
        const bmr = 10 * i.weightKg! + 6.25 * i.heightCm! - 5 * age + SEX[i.sexForEstimate];
        expect(target.energy.targetKcal).toBeGreaterThanOrEqual(bmr);
        expect(target.energy.floorKcal).toBeGreaterThanOrEqual(bmr);
        const maintenance = target.energyModel!.expenditureKcal;
        const deficit = Math.max(0, maintenance - target.energy.targetKcal);
        // The implied weekly loss, with ±0.5 kcal of the rounded expenditure.
        expect(((Math.max(0, deficit - 0.5) * 7) / density / i.weightKg!) * 100).toBeLessThanOrEqual(1 + 1e-9);
        expect(((target.energy.deficitKcal * 7) / density / i.weightKg!) * 100).toBeLessThanOrEqual(1 + 1e-9);
        expect(nutritionTargetViolations({ targetKcal: target.energy.targetKcal, deficitKcal: target.energy.deficitKcal, plannedLossPercentPerWeek: target.plannedLossPercentPerWeek, goalWeightKg: target.goalWeightKg }, { safetyProfile: i.safetyProfile, birthDate: i.birthDate, today, weightKg: i.weightKg!, heightCm: i.heightCm!, bmrKcal: bmr, maintenanceKcal: maintenance - 0.5 })).toEqual([]);
      }),
      RUNS,
    );
  });

  it('deficit features disabled under 18 and for "advised against calorie restriction": no calorie number at all', () => {
    const minors = input.map((i) => ({ ...i, birthDate: { year: 2009, month: i.birthDate.month, day: i.birthDate.day } })).map((i) => ({ ...i, safetyProfile: evaluateScreening({ answers: allNo, clearanceAttested: false, birthDate: i.birthDate, answeredOn: today, limitations: [], excludedExerciseIds: [] }) }));
    const advised = input.map((i) => ({ ...i, safetyProfile: evaluateScreening({ answers: { ...allNo, advised_against_calorie_restriction: 'yes' }, clearanceAttested: false, birthDate: i.birthDate, answeredOn: today, limitations: [], excludedExerciseIds: [] }) }));
    fc.assert(
      fc.property(fc.oneof(minors, advised), (i) => {
        const { target } = computeNutritionTarget(i, ctx);
        expect(target).toMatchObject({ mode: 'supportive', deficitAllowed: false, energy: null, protein: null, plannedLossPercentPerWeek: 0 });
      }),
      RUNS,
    );
  });

  it('a planned deficit exists only for an adult, screened, not advised against it, above the BMI floor, with a fat-loss goal', () => {
    fc.assert(
      fc.property(input, (i) => {
        const { target } = computeNutritionTarget(i, ctx);
        if (!target.energy || target.energy.deficitKcal === 0) return;
        expect(i.goal).toBe('fat_loss');
        expect(ageInYears(i.birthDate, today)).toBeGreaterThanOrEqual(18);
        expect(i.safetyProfile.deficitNutritionAllowed).toBe(true);
        expect(i.safetyProfile.specialPopulation).toBe('none');
        expect(i.weightKg!).toBeGreaterThan(18.5 * (i.heightCm! / 100) ** 2);
      }),
      RUNS,
    );
  });
});
