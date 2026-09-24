import type { FoodItem, HandPortion, IntakeEntry } from '@fitadapt/shared';
import { nutritionValue } from './config.js';

/**
 * Estimates of what a logged entry holds (M10 logging modes: hand-portion
 * quick log, food database search). Always estimates: the seed foods and the
 * hand portions are unvalidated (validated: false; seat A4).
 */
export interface IntakeEstimate {
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly reasonCode: 'nutrition.portion.hand_estimate' | 'nutrition.portion.food_estimate';
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function handPortionEstimate(portion: HandPortion, count: number): IntakeEstimate {
  return {
    energyKcal: Math.round(nutritionValue(`handPortion.${portion}.kcal`) * count),
    proteinG: round1(nutritionValue(`handPortion.${portion}.proteinG`) * count),
    reasonCode: 'nutrition.portion.hand_estimate',
  };
}

export function foodPortionEstimate(food: FoodItem, portionId: string, count: number): IntakeEstimate {
  const portion = food.portions.find((p) => p.id === portionId);
  if (!portion) throw new RangeError(`unknown portion ${portionId} for ${food.id}`);
  const grams = portion.grams * count;
  return { energyKcal: Math.round((food.energyKcalPer100g * grams) / 100), proteinG: round1((food.proteinGPer100g * grams) / 100), reasonCode: 'nutrition.portion.food_estimate' };
}

/** The estimate of an intake entry; foods are looked up by id (the seed binds this, packages/food-library). */
export function intakeEstimate(entry: IntakeEntry, foodById: (id: string) => FoodItem | undefined): IntakeEstimate {
  if (entry.kind === 'hand_portion') return handPortionEstimate(entry.portion, entry.count);
  const food = foodById(entry.foodId);
  if (!food) throw new RangeError(`unknown food ${entry.foodId}`);
  return foodPortionEstimate(food, entry.portionId, entry.count);
}
