import { describe, expect, it } from 'vitest';
import { FoodItemSchema, HabitCheckSchema, IntakeLogSchema, NUTRITION_COLLECTIONS, NUTRITION_INPUT_BOUNDS, NutritionPlanRecordSchema, NutritionTargetSchema, unvalidatedKeys, type FoodItem, type NutritionTarget } from './index.js';

/**
 * M10 contracts: the schema carries the S4 shape (a numeric target is never
 * below its floor; no deficit when deficit features are off; numbers only in
 * the numeric mode) and every food item records its source and licence.
 */
const target: NutritionTarget = {
  targetId: '8f0c6c64-3a2b-4f5e-9d6a-1b2c3d4e5f60',
  engineVersion: '0.4.0',
  rulesVersion: '0.1.0',
  computedOn: '2026-09-24',
  mode: 'numeric',
  goal: 'fat_loss',
  energyModel: { bmrKcal: 2127.5, activityFactor: 1.375, formulaExpenditureKcal: 2925, expenditureKcal: 2925, method: 'formula', reasonCodes: ['nutrition.energy.bmr_mifflin'] },
  energy: { targetKcal: 2270, floorKcal: 2128, deficitKcal: 655, surplusKcal: 0 },
  protein: { minG: 125, maxG: 175 },
  plannedLossPercentPerWeek: 0.496,
  goalWeightKg: null,
  deficitAllowed: true,
  habits: ['protein_each_meal', 'vegetables', 'hydration'],
  reasonCodes: ['nutrition.goal.fat_loss'],
};
const supportive: NutritionTarget = { ...target, mode: 'supportive', energyModel: null, energy: null, protein: null, plannedLossPercentPerWeek: 0, deficitAllowed: false, reasonCodes: ['nutrition.supportive.minor'] };
const food: FoodItem = {
  id: 'thieboudienne',
  category: 'dishes',
  regions: ['senegal'],
  hasLocalName: true,
  energyKcalPer100g: 160,
  proteinGPer100g: 8,
  portions: [{ id: 'plate', grams: 400 }],
  defaultPortion: 'plate',
  source: { kind: 'estimate', note: 'estimated by the engineer; to be verified by seat A4' },
  licence: 'Owned',
  validated: false,
};

describe('NutritionTarget', () => {
  it('accepts a numeric and a supportive target', () => {
    expect(NutritionTargetSchema.safeParse(target).success).toBe(true);
    expect(NutritionTargetSchema.safeParse(supportive).success).toBe(true);
  });

  it('refuses a target below its floor, a deficit with deficit features off, numbers outside the numeric mode, and a pace above 1 %', () => {
    expect(NutritionTargetSchema.safeParse({ ...target, energy: { ...target.energy!, targetKcal: 2000 } }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...target, deficitAllowed: false }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...target, deficitAllowed: false, plannedLossPercentPerWeek: 0 }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...supportive, energy: target.energy }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...target, protein: null }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...target, plannedLossPercentPerWeek: 1.5 }).success).toBe(false);
    expect(NutritionTargetSchema.safeParse({ ...target, reasonCodes: [] }).success).toBe(false);
  });
});

describe('FoodItem', () => {
  it('records its source and licence; refuses share-alike, validated without sign-off, a default portion it does not have, duplicate portions', () => {
    expect(FoodItemSchema.safeParse(food).success).toBe(true);
    expect(FoodItemSchema.safeParse({ ...food, source: { kind: 'public', citation: 'A public composition table, 2020 edition', url: 'https://example.org/table' } }).success).toBe(true);
    expect(FoodItemSchema.safeParse({ ...food, validated: true, validatedBy: 'A4', signOff: 'docs/governance/signoffs/x.md' }).success).toBe(true);
    for (const bad of [
      { ...food, licence: 'ODbL-1.0' },
      { ...food, source: { kind: 'estimate', note: 'x' } },
      { ...food, validated: true },
      { ...food, defaultPortion: 'bowl' },
      { ...food, portions: [{ id: 'plate', grams: 400 }, { id: 'plate', grams: 300 }] },
    ]) expect(FoodItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe('logs and records', () => {
  it('intake logs, habit checks and plan records', () => {
    const log = { schemaVersion: 1, loggedOn: '2026-09-24', at: '2026-09-24T12:00:00.000Z', meal: 'lunch', entry: { kind: 'hand_portion', portion: 'protein_palm', count: 1 }, estimate: { energyKcal: 150, proteinG: 25 }, correctionOf: null, removed: false };
    expect(IntakeLogSchema.safeParse(log).success).toBe(true);
    expect(IntakeLogSchema.safeParse({ ...log, entry: { kind: 'hand_portion', portion: 'protein_palm', count: 11 } }).success).toBe(false);
    expect(IntakeLogSchema.safeParse({ ...log, entry: { kind: 'food', foodId: 'rice_white_cooked', portionId: 'cup', count: 0.5 } }).success).toBe(true);
    expect(HabitCheckSchema.safeParse({ schemaVersion: 1, habit: 'hydration', checkedOn: '2026-09-24', done: true, at: '2026-09-24T12:00:00.000Z' }).success).toBe(true);
    expect(NutritionPlanRecordSchema.safeParse({ input: {}, target, reason: 'setup', createdAt: '2026-09-24T12:00:00.000Z', supersedes: null }).success).toBe(false);
    expect(NUTRITION_COLLECTIONS).toEqual({ plans: 'nutrition_plans', intakeLogs: 'intake_logs', habitChecks: 'habit_checks' });
    expect(unvalidatedKeys(NUTRITION_INPUT_BOUNDS)).toEqual(Object.keys(NUTRITION_INPUT_BOUNDS).sort());
  });
});
