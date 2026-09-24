import { defineConfig } from '@fitadapt/shared';
import type { SafetyCheck } from './evaluate.js';

/**
 * S7 age gate: users under 16 are excluded from the product in v1
 * (docs/specs/00-product-vision.md, S7; M17 scope "age gate at 16").
 * This is a safety invariant, not a coefficient: it is a constant, never a
 * config value, and there is no option to lower it. A jurisdiction may only
 * raise it (see `minimumAgeFor`).
 */
export const AGE_GATE_MINIMUM_YEARS = 16 as const;

/**
 * FIX-B (review/mobile.md MOB-13): an input plausibility bound, not a safety threshold — a date of birth
 * more than this many years ago is a typing error (year 0001 used to pass as "allowed", age 2025).
 */
export const AGE_GATE_CONFIG = defineConfig({
  maxPlausibleAgeYears: {
    value: 120,
    unit: 'years',
    source: 'engineering default: input plausibility bound for a date of birth (MOB-13, docs review), no external source',
    validated: false,
  },
});

/** A calendar date as the user entered it (no time zone, no clock). */
export interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number; // 1–31
}

export type AgeGateOutcome =
  | { readonly status: 'allowed'; readonly age: number }
  | { readonly status: 'blocked'; readonly reasonCode: 'safety.s7.under_minimum_age' }
  | { readonly status: 'invalid'; readonly reasonCode: 'age_gate.not_a_date' | 'age_gate.in_future' };

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidCalendarDate(date: CalendarDate): boolean {
  const { year, month, day } = date;
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function compare(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Completed years between `birth` and `today`. Someone born on 29 February
 * turns a year older on 1 March in common years (the conservative reading:
 * they are never treated as older than they are).
 */
export function ageInYears(birth: CalendarDate, today: CalendarDate): number {
  let age = today.year - birth.year;
  const birthdayThisYear: CalendarDate =
    birth.month === 2 && birth.day === 29 && !isLeap(today.year)
      ? { year: today.year, month: 3, day: 1 }
      : { year: today.year, month: birth.month, day: birth.day };
  if (compare(today, birthdayThisYear) < 0) age -= 1;
  return age;
}

/**
 * Minimum age for a jurisdiction. Never below 16. No launch jurisdiction is
 * known to require more yet (open question for counsel, seat B1): when one is
 * confirmed, it is added here as a higher value, never a lower one.
 */
export function minimumAgeFor(_jurisdiction: string): number {
  return AGE_GATE_MINIMUM_YEARS;
}

/**
 * Fails closed: anything that is not a real, plausible past date never passes.
 * FIX-B (MOB-13): `localMinimumAge` is the jurisdiction's own minimum (packages/legal effectiveMinimumAge),
 * which can only raise the S7 floor; a date of birth older than the plausibility bound is not a date.
 */
export function evaluateAgeGate(birth: CalendarDate, today: CalendarDate, jurisdiction = 'ZZ', localMinimumAge = 0): AgeGateOutcome {
  if (!isValidCalendarDate(birth) || !isValidCalendarDate(today)) {
    return { status: 'invalid', reasonCode: 'age_gate.not_a_date' };
  }
  if (compare(birth, today) > 0) return { status: 'invalid', reasonCode: 'age_gate.in_future' };
  const age = ageInYears(birth, today);
  if (age > AGE_GATE_CONFIG.maxPlausibleAgeYears.value) return { status: 'invalid', reasonCode: 'age_gate.not_a_date' };
  const minimum = Math.max(AGE_GATE_MINIMUM_YEARS, minimumAgeFor(jurisdiction), Number.isFinite(localMinimumAge) ? localMinimumAge : 0);
  if (age < minimum) return { status: 'blocked', reasonCode: 'safety.s7.under_minimum_age' };
  return { status: 'allowed', age };
}

/** The age gate as an S7 safety check, for use with `evaluateSafety`. */
export const ageGateCheck: SafetyCheck<{ birth: CalendarDate; today: CalendarDate; jurisdiction?: string }> = (input) => {
  const outcome = evaluateAgeGate(input.birth, input.today, input.jurisdiction);
  if (outcome.status === 'allowed') return null;
  return { invariant: 'S7', reasonCode: outcome.reasonCode };
};
