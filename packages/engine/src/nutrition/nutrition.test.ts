import { NUTRITION_SAFETY_CONFIG, evaluateScreening, notScreenedSafetyProfile } from '@fitadapt/safety';
import { NutritionTargetSchema, SCREENING_QUESTION_IDS, type CalendarDateValue, type FoodItem, type IntakeLog, type NutritionInput, type SafetyProfile, type ScreeningQuestionId, type TrendPoint } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { addDays } from '../program/dates.js';
import { ENGINE_VERSION } from '../version.js';
import {
  M10_REASON_CODES,
  NUTRITION_CONFIG,
  NUTRITION_RULES_VERSION,
  activityFactor,
  adaptiveExpenditure,
  adaptiveObservation,
  ageOnIsoDate,
  computeNutritionTarget,
  dailyIntake,
  foodPortionEstimate,
  guardrailStatus,
  handPortionEstimate,
  intakeEstimate,
  mifflinStJeorBmr,
  targetDue,
} from './index.js';

/**
 * M10 goal condition 1: BMR (Mifflin-St Jeor), activity factor, adaptive
 * expenditure from the weight trend and intake, and goal targets. Reference
 * values are computed by hand from the published equation
 * (10·kg + 6.25·cm − 5·years + 5 / −161) for the vision personas.
 */
const TODAY = '2026-09-24';
const allNo = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])) as Record<ScreeningQuestionId, 'no'>;
const screened = (yes: ScreeningQuestionId[] = [], birthDate: CalendarDateValue = { year: 1988, month: 3, day: 14 }): SafetyProfile =>
  evaluateScreening({ answers: { ...allNo, ...Object.fromEntries(yes.map((q) => [q, 'yes'])) }, clearanceAttested: false, birthDate, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });
const ctx = () => createEngineContext({ clock: fixedClock(Date.parse(`${TODAY}T08:00:00Z`)), seed: 10 });
const density = NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;

/** P1 Ibrahima (fictional): 38, M, 120 kg, 178 cm, goal fat loss, 3 sessions a week. */
const P1_BIRTH = { year: 1988, month: 3, day: 14 };
const p1 = (over: Partial<NutritionInput> = {}): NutritionInput => ({
  schemaVersion: 1,
  goal: 'fat_loss',
  trackingStyle: 'numbers',
  activityLevel: 'light',
  sexForEstimate: 'male',
  weightKg: 120,
  heightCm: 178,
  birthDate: P1_BIRTH,
  today: TODAY,
  plannedLossPercentPerWeek: 0.5,
  goalWeightKg: null,
  safetyProfile: screened(),
  guardrailEvents: [],
  adaptive: null,
  previousExpenditureKcal: null,
  ...over,
});
/** P2 Awa (fictional): 32, F, 60 kg, 165 cm. */
const P2_BIRTH = { year: 1994, month: 5, day: 2 };
const p2 = (over: Partial<NutritionInput> = {}): NutritionInput => p1({ goal: 'maintain', sexForEstimate: 'female', weightKg: 60, heightCm: 165, birthDate: P2_BIRTH, safetyProfile: screened([], P2_BIRTH), plannedLossPercentPerWeek: null, ...over });

describe('Mifflin-St Jeor BMR and activity factor (reference values)', () => {
  it.each([
    ['P1 Ibrahima: 38 y, M, 120 kg, 178 cm', { weightKg: 120, heightCm: 178, ageYears: 38, sex: 'male' }, 2127.5],
    ['P2 Awa: 32 y, F, 60 kg, 165 cm', { weightKg: 60, heightCm: 165, ageYears: 32, sex: 'female' }, 1310.25],
    ['P3 David: 44 y, M, 82 kg, 180 cm', { weightKg: 82, heightCm: 180, ageYears: 44, sex: 'male' }, 1730],
    ['P4 Mariam: 62 y, F, 70 kg, 160 cm', { weightKg: 70, heightCm: 160, ageYears: 62, sex: 'female' }, 1229],
    ['unspecified: the midpoint constant (−78)', { weightKg: 70, heightCm: 170, ageYears: 30, sex: 'unspecified' }, 1534.5],
  ] as const)('%s → %s kcal/day', (_name, input, expected) => {
    expect(mifflinStJeorBmr(input)).toBeCloseTo(expected, 6);
  });

  it('is NaN (never a number to act on) for unusable input', () => {
    expect(mifflinStJeorBmr({ weightKg: 0, heightCm: 170, ageYears: 30, sex: 'male' })).toBeNaN();
    expect(mifflinStJeorBmr({ weightKg: 70, heightCm: Number.NaN, ageYears: 30, sex: 'male' })).toBeNaN();
    expect(mifflinStJeorBmr({ weightKg: 70, heightCm: 170, ageYears: -1, sex: 'male' })).toBeNaN();
    expect(mifflinStJeorBmr({ weightKg: 25, heightCm: 100, ageYears: 200, sex: 'female' })).toBeNaN();
  });

  it('activity factors 1.4 → 1.9 (A4/A6: sedentary at the EFSA low PAL, was 1.2; light kept above it, was 1.375) and the age on a date', () => {
    expect(['sedentary', 'light', 'moderate', 'very_active', 'extra_active'].map((l) => activityFactor(l as never))).toEqual([1.4, 1.5, 1.55, 1.725, 1.9]);
    expect(ageOnIsoDate(P1_BIRTH, TODAY)).toBe(38);
    expect(ageOnIsoDate({ year: 2008, month: 9, day: 25 }, TODAY)).toBe(17);
  });
});

describe('goal targets', () => {
  it('P1 fat loss at 0.5 %/week: expenditure − the deficit for 0.6 kg a week, above BMR, protein on a reference weight', () => {
    const { target, safetyEvents } = computeNutritionTarget(p1(), ctx());
    const expenditure = 2127.5 * 1.5; // 3191.25 (light, A4/A6: was 1.375)
    const deficit = (0.005 * 120 * density) / 7; // 660
    expect(target).toMatchObject({ mode: 'numeric', goal: 'fat_loss', deficitAllowed: true, engineVersion: ENGINE_VERSION, rulesVersion: NUTRITION_RULES_VERSION, computedOn: TODAY });
    expect(target.energyModel).toMatchObject({ bmrKcal: 2127.5, activityFactor: 1.5, formulaExpenditureKcal: 3191, expenditureKcal: 3191, method: 'formula' });
    expect(target.energy).toEqual({ targetKcal: Math.ceil((expenditure - deficit) / 10) * 10, floorKcal: 2128, deficitKcal: Math.floor(expenditure) - Math.ceil((expenditure - deficit) / 10) * 10, surplusKcal: 0 });
    expect(target.energy!.targetKcal).toBe(2540);
    expect(target.plannedLossPercentPerWeek).toBeLessThanOrEqual(0.5);
    expect(target.plannedLossPercentPerWeek).toBeGreaterThan(0.49);
    // 25 × 1.78² = 79.2 kg reference weight → 1.6–2.2 g/kg = 127–174 g, rounded to 5 g.
    expect(target.protein).toEqual({ minG: 125, maxG: 175 });
    expect(target.reasonCodes).toEqual(expect.arrayContaining(['nutrition.energy.bmr_mifflin', 'nutrition.energy.activity_factor', 'nutrition.goal.fat_loss', 'nutrition.protein.reference_weight', 'nutrition.protein.range', 'nutrition.protein.kidney_notice', 'nutrition.rounding.up']));
    expect(safetyEvents).toEqual([]);
    expect(NutritionTargetSchema.safeParse(target).success).toBe(true);
  });

  it('asking 1 %/week of a sedentary P1 hits the BMR floor: the target is the BMR, never below', () => {
    const { target, safetyEvents } = computeNutritionTarget(p1({ activityLevel: 'sedentary', plannedLossPercentPerWeek: 1 }), ctx());
    // 2127.5 × 1.4 = 2978.5 − 1320 = 1658.5 < BMR 2127.5 → 2128, rounded up to 2130.
    expect(target.energy).toMatchObject({ targetKcal: 2130, floorKcal: 2128 });
    expect(target.reasonCodes).toContain('nutrition.s4.bmr_floor');
    expect(safetyEvents).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.bmr_floor', action: 'capped' }]);
    // The loss the floor leaves: (floor(2978.5) − 2130) kcal/day ≈ 0.64 %/week (below the 1 % asked; 0.47 with the old 1.2 factor).
    expect(target.plannedLossPercentPerWeek).toBeCloseTo((((Math.floor(2127.5 * 1.4) - 2130) * 7) / density / 120) * 100, 2);
    expect(target.plannedLossPercentPerWeek).toBeLessThan(1);
  });

  it('P2 maintain: the target is the expenditure; muscle gain adds a small surplus (≤ 5 %, ≤ 300 kcal)', () => {
    const maintain = computeNutritionTarget(p2(), ctx()).target;
    expect(maintain.energy).toMatchObject({ targetKcal: Math.ceil((1310.25 * 1.5) / 10) * 10, deficitKcal: 0 });
    expect(maintain.reasonCodes).toContain('nutrition.goal.maintain');
    expect(maintain.protein).toEqual({ minG: 95, maxG: 130 }); // 60 kg × 1.6 = 96, × 2.2 = 132
    const gain = computeNutritionTarget(p2({ goal: 'muscle_gain' }), ctx()).target;
    expect(gain.energy!.surplusKcal).toBeGreaterThan(0);
    expect(gain.energy!.targetKcal).toBe(Math.ceil((1310.25 * 1.5 * 1.05) / 10) * 10);
    const big = computeNutritionTarget(p1({ goal: 'muscle_gain', activityLevel: 'extra_active' }), ctx()).target;
    expect(big.energy!.surplusKcal).toBeLessThanOrEqual(300 + 10);
  });

  it('a goal weight below BMI 18.5 is refused; a goal weight reached stops the deficit', () => {
    const low = computeNutritionTarget(p1({ goalWeightKg: 55 }), ctx());
    expect(low.target.goalWeightKg).toBeNull();
    expect(low.target.reasonCodes).toContain('nutrition.s4.goal_weight_below_floor');
    expect(low.safetyEvents).toContainEqual({ invariant: 'S4', reasonCode: 'safety.s4.goal_weight_below_floor', action: 'capped' });
    expect(computeNutritionTarget(p1({ goalWeightKg: 90 }), ctx()).target.goalWeightKg).toBe(90);
    const reached = computeNutritionTarget(p1({ goalWeightKg: 125 }), ctx()).target;
    expect(reached.energy!.deficitKcal).toBe(0);
    expect(reached.plannedLossPercentPerWeek).toBe(0);
    expect(reached.reasonCodes).toContain('nutrition.goal.goal_weight_reached');
  });

  it('at the BMI floor there is no deficit (and it is not mentioned for maintenance)', () => {
    const lean = p2({ goal: 'fat_loss', weightKg: 50, plannedLossPercentPerWeek: 0.5 });
    const { target } = computeNutritionTarget(lean, ctx());
    expect(target).toMatchObject({ deficitAllowed: false, plannedLossPercentPerWeek: 0 });
    expect(target.reasonCodes).toContain('nutrition.s4.at_bmi_floor');
    expect(computeNutritionTarget({ ...lean, goal: 'maintain' }, ctx()).target.reasonCodes).not.toContain('nutrition.s4.at_bmi_floor');
  });

  it('asks for measurements when height or weight is missing, and says so when no estimate is possible', () => {
    // SAF-5: a device date more than a day from the engine clock gives no numbers (never an S4 check at an unbounded date).
    for (const today of ['2026-09-22', '2026-09-26', '2027-09-24']) {
      expect(computeNutritionTarget(p1({ today }), ctx())).toMatchObject({ target: { mode: 'supportive', energy: null, deficitAllowed: false, reasonCodes: ['nutrition.unavailable.clock_mismatch'] }, safetyEvents: [] });
    }
    for (const today of ['2026-09-23', '2026-09-25']) expect(computeNutritionTarget(p1({ today }), ctx()).target.mode).toBe('numeric');
    expect(computeNutritionTarget(p1({ weightKg: null }), ctx()).target).toMatchObject({ mode: 'needs_measurements', energy: null, protein: null, reasonCodes: ['nutrition.needs_measurements'] });
    expect(computeNutritionTarget(p1({ heightCm: null }), ctx()).target.mode).toBe('needs_measurements');
    // FIX-B (MOB-13): a screening now refuses a date of birth over 120 years ago (not screened, fail closed), so the
    // screening in this fixture is a valid one; the nutrition input keeps the ancient date that makes BMR impossible.
    const ancient = computeNutritionTarget(p1({ weightKg: 25, heightCm: 100, birthDate: { year: 1826, month: 1, day: 1 }, sexForEstimate: 'female', safetyProfile: screened() }), ctx()).target;
    expect(ancient).toMatchObject({ mode: 'needs_measurements', reasonCodes: ['nutrition.energy.unavailable'] });
  });
});

describe('S4: deficit features disabled → supportive mode without numbers', () => {
  it.each([
    ['17 years old', p1({ birthDate: { year: 2009, month: 1, day: 1 }, safetyProfile: screened([], { year: 2009, month: 1, day: 1 }) }), 'nutrition.supportive.minor'],
    ['advised against calorie restriction', p1({ safetyProfile: screened(['advised_against_calorie_restriction']) }), 'nutrition.supportive.advised_against'],
    // FIX-B (A4 M10-20): a self-reported current or past eating disorder → supportive mode with its own signposting copy.
    ['self-reported eating disorder', p1({ safetyProfile: screened(['eating_disorder']) }), 'nutrition.supportive.eating_disorder'],
    ['not screened', p1({ safetyProfile: notScreenedSafetyProfile() }), 'nutrition.supportive.not_screened'],
    ['pregnancy or recent birth', p1({ safetyProfile: screened(['pregnancy_or_recent_birth']) }), 'nutrition.supportive.special_population'],
  ])('%s: no energy number, no protein number, no planned loss; habits shown', (_n, input, reason) => {
    for (const goal of ['fat_loss', 'maintain', 'muscle_gain'] as const) {
      const { target, safetyEvents } = computeNutritionTarget({ ...input, goal }, ctx());
      expect(target).toMatchObject({ mode: 'supportive', energy: null, protein: null, energyModel: null, plannedLossPercentPerWeek: 0, deficitAllowed: false, habits: ['protein_each_meal', 'vegetables', 'hydration'] });
      expect(target.reasonCodes).toContain(reason);
      // A refused deficit is an S4 event; a maintenance or gain goal refuses nothing.
      expect(safetyEvents.every((e) => e.invariant === 'S4' && e.action === 'blocked')).toBe(true);
      expect(safetyEvents.length > 0).toBe(goal === 'fat_loss');
    }
  });

  it('anyone may choose habits without numbers', () => {
    expect(computeNutritionTarget(p1({ trackingStyle: 'habits' }), ctx()).target).toMatchObject({ mode: 'supportive', energy: null, deficitAllowed: true, reasonCodes: ['nutrition.supportive.chosen'] });
  });
});

describe('M04 sustained-loss guardrail: supportive pause, then a smaller deficit (goal condition 6)', () => {
  it('guardrailStatus: paused for 14 days, then capped at 0.5 %/week until day 56', () => {
    expect(guardrailStatus([], TODAY)).toEqual({ kind: 'none' });
    expect(guardrailStatus(['2026-09-20'], TODAY)).toEqual({ kind: 'paused', until: '2026-10-04' });
    expect(guardrailStatus(['2026-09-10'], TODAY)).toEqual({ kind: 'reduced', maxPercentPerWeek: 0.5 });
    expect(guardrailStatus(['2026-07-01'], TODAY)).toEqual({ kind: 'none' });
    expect(guardrailStatus(['2026-10-01'], TODAY)).toEqual({ kind: 'none' }); // a future date is ignored
  });

  it('during the pause the deficit is removed; afterwards 1 %/week is reduced to 0.5 %', () => {
    const before = computeNutritionTarget(p1({ plannedLossPercentPerWeek: 1, activityLevel: 'very_active' }), ctx()).target;
    const paused = computeNutritionTarget(p1({ plannedLossPercentPerWeek: 1, activityLevel: 'very_active', guardrailEvents: ['2026-09-24'] }), ctx());
    expect(before.energy!.deficitKcal).toBeGreaterThan(1000);
    expect(paused.target.energy!.deficitKcal).toBe(0);
    expect(paused.target.plannedLossPercentPerWeek).toBe(0);
    expect(paused.target.reasonCodes).toContain('nutrition.guardrail.paused');
    expect(paused.safetyEvents).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_pause', action: 'deficit_reduced' }]);
    const later = computeNutritionTarget(p1({ plannedLossPercentPerWeek: 1, activityLevel: 'very_active', guardrailEvents: ['2026-09-01'] }), ctx());
    expect(later.target.energy!.deficitKcal).toBeLessThan(before.energy!.deficitKcal);
    expect(later.target.plannedLossPercentPerWeek).toBeLessThanOrEqual(0.5);
    expect(later.target.reasonCodes).toContain('nutrition.guardrail.rate_reduced');
    expect(later.safetyEvents).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_reduced', action: 'deficit_reduced' }]);
    // Already at or below the reduced pace: nothing to reduce.
    expect(computeNutritionTarget(p1({ plannedLossPercentPerWeek: 0.25, guardrailEvents: ['2026-09-01'] }), ctx()).safetyEvents).toEqual([]);
  });

  it('a new target is due weekly and when the guardrail pace changes', () => {
    const t = computeNutritionTarget(p1(), ctx()).target;
    expect(targetDue(null, [], TODAY)).toBe(true);
    expect(targetDue(t, [], TODAY)).toBe(false);
    expect(targetDue(t, [], addDays(TODAY, 6))).toBe(false);
    expect(targetDue(t, [], addDays(TODAY, 7))).toBe(true);
    expect(targetDue(t, ['2026-09-25'], '2026-09-25')).toBe(true);
  });
});

// ---------------------------------------------------------------- adaptive

const trendLine = (from: string, days: number, start: number, perDay: number): TrendPoint[] => Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), value: start + perDay * i, trend: start + perDay * i }));
const log = (id: string, loggedOn: string, energyKcal: number, over: Partial<IntakeLog> = {}) => ({
  id,
  data: { schemaVersion: 1 as const, loggedOn, at: `${loggedOn}T12:00:00.000Z`, meal: null, entry: { kind: 'hand_portion' as const, portion: 'protein_palm' as const, count: 1 }, estimate: { energyKcal, proteinG: 20 }, correctionOf: null, removed: false, ...over },
});

describe('adaptive expenditure from the weight trend and logged intake', () => {
  it('dailyIntake sums the entries in force (corrections replace, removals remove)', () => {
    const days = dailyIntake([log('a', TODAY, 500), log('b', TODAY, 700), log('c', TODAY, 300, { correctionOf: 'b' }), log('d', TODAY, 900, { correctionOf: 'a', removed: true })]);
    expect(days.get(TODAY)).toEqual({ energyKcal: 300, proteinG: 20 });
  });

  it('observation: mean intake of the logged days and the trend change over the 14 complete days before today', () => {
    const trend = trendLine('2026-09-01', 24, 100, -0.1);
    const intake = new Map(Array.from({ length: 12 }, (_, i) => [addDays('2026-09-10', i), { energyKcal: 2400, proteinG: 120 }]));
    const obs = adaptiveObservation(intake, trend, TODAY);
    expect(obs).toEqual({ from: '2026-09-10', to: '2026-09-23', windowDays: 14, loggedDays: 12, meanIntakeKcal: 2400, trendChangeKg: -1.3 });
    expect(adaptiveObservation(intake, [], TODAY)).toBeNull();
    expect(adaptiveObservation(new Map(), trend, TODAY)).toMatchObject({ loggedDays: 0, meanIntakeKcal: 0 });
  });

  it('A4/A6: only complete days count — days marked complete when known, never a day logged below the plausible minimum', () => {
    const trend = trendLine('2026-09-01', 24, 100, -0.1);
    const intake = new Map(Array.from({ length: 12 }, (_, i) => [addDays('2026-09-10', i), { energyKcal: i < 4 ? 600 : 2400, proteinG: 120 }]));
    // Four days logged at 600 kcal (partly logged) are left out: the mean is not dragged down.
    expect(adaptiveObservation(intake, trend, TODAY)).toMatchObject({ loggedDays: 8, meanIntakeKcal: 2400 });
    const complete = new Set(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(adaptiveObservation(intake, trend, TODAY, complete)).toMatchObject({ loggedDays: 3, meanIntakeKcal: 2400 });
  });

  it('update: half-way from the previous estimate towards intake − Δmass × density, within −10 % / +25 % of the formula, down at most 5 % per update', () => {
    const obs = { from: '2026-09-10', to: '2026-09-23', windowDays: 14, loggedDays: 12, meanIntakeKcal: 2400, trendChangeKg: -1.4 };
    // observed = 2400 + (1.4 / 14) × 7700 = 3170; prior (formula) 2900 → 2900 + 0.5 × 270 = 3035.
    expect(adaptiveExpenditure(2900, null, obs)).toEqual({ expenditureKcal: 3035, method: 'adaptive', reasonCodes: ['nutrition.energy.adaptive'] });
    expect(adaptiveExpenditure(2900, 3000, obs).expenditureKcal).toBeCloseTo(3085, 6);
    // Not enough logged days: keep the previous estimate (or the formula).
    expect(adaptiveExpenditure(2900, null, { ...obs, loggedDays: 9 })).toEqual({ expenditureKcal: 2900, method: 'formula', reasonCodes: ['nutrition.energy.adaptive_insufficient_data'] });
    expect(adaptiveExpenditure(2900, 3100, null)).toEqual({ expenditureKcal: 3100, method: 'adaptive', reasonCodes: ['nutrition.energy.adaptive_insufficient_data'] });
    // Implausible logs cannot drag it outside the band; A4/A6: the band is −10 % below the formula (was −25 %) and one
    // update lowers the estimate by at most 5 %, and says it went down.
    expect(adaptiveExpenditure(2900, null, { ...obs, meanIntakeKcal: 200, trendChangeKg: 3 })).toEqual({ expenditureKcal: 2900 * 0.95, method: 'adaptive', reasonCodes: ['nutrition.energy.adaptive', 'nutrition.energy.adaptive_lowered'] });
    expect(adaptiveExpenditure(2900, 2700, { ...obs, meanIntakeKcal: 200, trendChangeKg: 3 }).expenditureKcal).toBeCloseTo(2900 * 0.9, 6);
    for (let prev = 2610; prev <= 3625; prev += 101) {
      const next = adaptiveExpenditure(2900, prev, { ...obs, meanIntakeKcal: 0, trendChangeKg: 5 }).expenditureKcal;
      expect(next).toBeGreaterThanOrEqual(Math.max(2900 * 0.9, Math.min(prev, 2900 * 1.25) * 0.95) - 1e-9);
    }
    expect(adaptiveExpenditure(2900, 99_000, { ...obs, meanIntakeKcal: 9000 }).expenditureKcal).toBeCloseTo(2900 * 1.25, 6);
  });

  it('the target uses the adaptive expenditure and says so', () => {
    const adaptive = { from: '2026-09-10', to: '2026-09-23', windowDays: 14, loggedDays: 12, meanIntakeKcal: 2400, trendChangeKg: -1.4 };
    const { target } = computeNutritionTarget(p1({ adaptive, previousExpenditureKcal: 2925 }), ctx());
    // Formula 2127.5 × 1.5 = 3191; the previous 2925 is inside the band (≥ 3191 × 0.9) → 2925 + 0.5 × (3170 − 2925).
    expect(target.energyModel).toMatchObject({ method: 'adaptive', formulaExpenditureKcal: 3191, expenditureKcal: Math.round(2925 + 0.5 * (3170 - 2925)) });
    expect(target.reasonCodes).toContain('nutrition.energy.adaptive');
  });
});

// ---------------------------------------------------------------- portions

const FOOD: FoodItem = {
  id: 'rice_cooked',
  category: 'grains',
  regions: ['generic'],
  hasLocalName: false,
  energyKcalPer100g: 130,
  proteinGPer100g: 2.7,
  portions: [{ id: 'cup', grams: 160 }, { id: 'g100', grams: 100 }],
  defaultPortion: 'cup',
  source: { kind: 'estimate', note: 'test fixture: estimated by the engineer' },
  licence: 'Owned',
  validated: false,
};

describe('portion estimates', () => {
  it('hand portions and seed foods', () => {
    expect(handPortionEstimate('protein_palm', 2)).toEqual({ energyKcal: 300, proteinG: 50, reasonCode: 'nutrition.portion.hand_estimate' });
    expect(handPortionEstimate('fats_thumb', 1)).toEqual({ energyKcal: 90, proteinG: 1, reasonCode: 'nutrition.portion.hand_estimate' });
    expect(foodPortionEstimate(FOOD, 'cup', 1.5)).toEqual({ energyKcal: 312, proteinG: 6.5, reasonCode: 'nutrition.portion.food_estimate' });
    expect(() => foodPortionEstimate(FOOD, 'bowl', 1)).toThrow(RangeError);
    const byId = (id: string) => (id === FOOD.id ? FOOD : undefined);
    expect(intakeEstimate({ kind: 'food', foodId: 'rice_cooked', portionId: 'g100', count: 1 }, byId).energyKcal).toBe(130);
    expect(intakeEstimate({ kind: 'hand_portion', portion: 'vegetables_fist', count: 2 }, byId).energyKcal).toBe(60);
    expect(() => intakeEstimate({ kind: 'food', foodId: 'nope', portionId: 'g100', count: 1 }, byId)).toThrow(RangeError);
  });
});

describe('config and reason codes', () => {
  it('every value is validated:false with a source; no S4 limit is configuration', () => {
    for (const [key, v] of Object.entries(NUTRITION_CONFIG)) {
      expect(v.validated, key).toBe(false);
      expect(v.source.length, key).toBeGreaterThan(20);
      expect(key).not.toMatch(/(^|\.)s4|minimumAge|maxLoss|goalBmi|minBmi|floor/i);
    }
    for (const k of ['bmr.weightKcalPerKg', 'bmr.heightKcalPerCm', 'bmr.ageKcalPerYear', 'bmr.maleConstantKcal', 'bmr.femaleConstantKcal'] as const) expect(NUTRITION_CONFIG[k].source).toMatch(/Mifflin.*not checked against the source/);
    expect(NUTRITION_CONFIG['protein.minGPerKg'].source).toMatch(/Morton/);
  });

  it('every emitted reason code is declared', () => {
    expect(new Set(M10_REASON_CODES).size).toBe(M10_REASON_CODES.length);
    for (const c of M10_REASON_CODES) expect(c).toMatch(/^nutrition\.[a-z0-9_.]+$/);
    const inputs = [p1(), p1({ activityLevel: 'sedentary', plannedLossPercentPerWeek: 1 }), p1({ goalWeightKg: 55 }), p1({ goalWeightKg: 125 }), p2(), p2({ goal: 'muscle_gain' }), p1({ trackingStyle: 'habits' }), p1({ weightKg: null }), p1({ guardrailEvents: ['2026-09-24'] }), p1({ plannedLossPercentPerWeek: 1, guardrailEvents: ['2026-09-01'] })];
    for (const input of inputs) for (const c of computeNutritionTarget(input, ctx()).target.reasonCodes) expect(M10_REASON_CODES).toContain(c);
  });

  it('is deterministic for the same input and seed', () => {
    expect(computeNutritionTarget(p1(), ctx())).toEqual(computeNutritionTarget(p1(), ctx()));
    expect(computeNutritionTarget(p1(), createEngineContext({ clock: fixedClock(0), seed: 11 })).target.targetId).not.toBe(computeNutritionTarget(p1(), ctx()).target.targetId);
  });
});
