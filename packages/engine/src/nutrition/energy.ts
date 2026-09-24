import { ageInYears } from '@fitadapt/safety';
import type { ActivityLevel, CalendarDateValue, EstimateSex, IsoDate } from '@fitadapt/shared';
import { nutritionValue } from './config.js';

/**
 * Energy estimate (M10 Scope): Mifflin-St Jeor resting energy × an activity
 * factor. Pure; every coefficient comes from NUTRITION_CONFIG
 * (validated: false). The adaptive weekly update lives in adaptive.ts.
 */
export interface BmrInput {
  readonly weightKg: number;
  readonly heightCm: number;
  readonly ageYears: number;
  readonly sex: EstimateSex;
}

const SEX_CONSTANT = { male: 'bmr.maleConstantKcal', female: 'bmr.femaleConstantKcal', unspecified: 'bmr.unspecifiedConstantKcal' } as const;

/** BMR (kcal/day) = 10·kg + 6.25·cm − 5·years + s (s = +5 male, −161 female, −78 unspecified). NaN for unusable input. */
export function mifflinStJeorBmr({ weightKg, heightCm, ageYears, sex }: BmrInput): number {
  if (![weightKg, heightCm, ageYears].every(Number.isFinite) || weightKg <= 0 || heightCm <= 0 || ageYears < 0) return Number.NaN;
  const bmr = nutritionValue('bmr.weightKcalPerKg') * weightKg + nutritionValue('bmr.heightKcalPerCm') * heightCm - nutritionValue('bmr.ageKcalPerYear') * ageYears + nutritionValue(SEX_CONSTANT[sex]);
  return bmr > 0 ? bmr : Number.NaN;
}

export function activityFactor(level: ActivityLevel): number {
  return nutritionValue(`activity.${level}`);
}

/** The calendar date of an ISO date (YYYY-MM-DD). */
export function calendarOf(date: IsoDate): CalendarDateValue {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** Completed years on `today` (the conservative 29 February reading of packages/safety). */
export function ageOnIsoDate(birthDate: CalendarDateValue, today: IsoDate): number {
  return ageInYears(birthDate, calendarOf(today));
}
