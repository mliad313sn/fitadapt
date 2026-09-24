import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AGE_GATE_CONFIG,
  AGE_GATE_MINIMUM_YEARS,
  ageGateCheck,
  ageInYears,
  evaluateAgeGate,
  evaluateSafety,
  isValidCalendarDate,
  minimumAgeFor,
  type CalendarDate,
} from './index.js';

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

describe('S7 age gate', () => {
  it('the minimum age is 16 and cannot be lowered by jurisdiction', () => {
    expect(AGE_GATE_MINIMUM_YEARS).toBe(16);
    for (const j of ['FR', 'GB', 'US', 'SN', 'CI', 'ZZ']) expect(minimumAgeFor(j)).toBeGreaterThanOrEqual(16);
  });

  it('blocks the day before the 16th birthday and allows on the birthday', () => {
    expect(evaluateAgeGate(d(2010, 9, 24), d(2026, 9, 23))).toEqual({ status: 'blocked', reasonCode: 'safety.s7.under_minimum_age' });
    expect(evaluateAgeGate(d(2010, 9, 23), d(2026, 9, 23))).toEqual({ status: 'allowed', age: 16 });
    expect(evaluateAgeGate(d(1964, 1, 1), d(2026, 9, 23))).toEqual({ status: 'allowed', age: 62 });
  });

  it('treats a 29 February birthday conservatively in common years', () => {
    expect(ageInYears(d(2008, 2, 29), d(2024, 2, 28))).toBe(15);
    expect(ageInYears(d(2008, 2, 29), d(2024, 2, 29))).toBe(16);
    expect(ageInYears(d(2008, 2, 29), d(2025, 2, 28))).toBe(16);
    expect(ageInYears(d(2009, 2, 28), d(2025, 2, 28))).toBe(16);
    expect(evaluateAgeGate(d(2010, 2, 29), d(2026, 9, 23)).status).toBe('invalid');
  });

  it('rejects impossible and future dates (fails closed)', () => {
    expect(isValidCalendarDate(d(2023, 2, 29))).toBe(false);
    expect(isValidCalendarDate(d(2024, 2, 29))).toBe(true);
    expect(isValidCalendarDate(d(1900, 2, 29))).toBe(false);
    expect(isValidCalendarDate(d(2000, 2, 29))).toBe(true);
    expect(isValidCalendarDate(d(2020, 4, 31))).toBe(false);
    expect(isValidCalendarDate(d(2020, 13, 1))).toBe(false);
    expect(isValidCalendarDate(d(2020, 1, 0))).toBe(false);
    expect(isValidCalendarDate(d(0, 1, 1))).toBe(false);
    expect(isValidCalendarDate(d(2020.5, 1, 1))).toBe(false);
    expect(isValidCalendarDate(d(Number.NaN, 1, 1))).toBe(false);
    expect(evaluateAgeGate(d(2030, 1, 1), d(2026, 9, 23))).toEqual({ status: 'invalid', reasonCode: 'age_gate.in_future' });
    expect(evaluateAgeGate(d(2000, 1, 1), d(2026, 2, 30))).toEqual({ status: 'invalid', reasonCode: 'age_gate.not_a_date' });
  });

  it('FIX-B (MOB-13): an absurd birth year is not a date; a jurisdiction minimum can only raise the floor', () => {
    const today = d(2026, 9, 23);
    expect(evaluateAgeGate(d(1, 1, 1), today)).toEqual({ status: 'invalid', reasonCode: 'age_gate.not_a_date' });
    expect(evaluateAgeGate(d(1905, 9, 23), today)).toEqual({ status: 'invalid', reasonCode: 'age_gate.not_a_date' });
    expect(evaluateAgeGate(d(1906, 9, 23), today)).toEqual({ status: 'allowed', age: 120 });
    expect(AGE_GATE_CONFIG.maxPlausibleAgeYears).toMatchObject({ value: 120, validated: false });
    // A local minimum of 18 blocks a 17-year-old; a lower (or broken) one never lowers 16.
    expect(evaluateAgeGate(d(2009, 1, 1), today, 'XX', 18)).toEqual({ status: 'blocked', reasonCode: 'safety.s7.under_minimum_age' });
    expect(evaluateAgeGate(d(2011, 1, 1), today, 'XX', 13).status).toBe('blocked');
    expect(evaluateAgeGate(d(2011, 1, 1), today, 'XX', Number.NaN).status).toBe('blocked');
    expect(evaluateAgeGate(d(2009, 1, 1), today, 'XX', 16)).toEqual({ status: 'allowed', age: 17 });
  });

  it('works as an S7 safety check', () => {
    const today = d(2026, 9, 23);
    expect(evaluateSafety([{ invariant: 'S7', check: ageGateCheck }], { birth: d(2000, 1, 1), today }).allowed).toBe(true);
    const young = evaluateSafety([{ invariant: 'S7', check: ageGateCheck }], { birth: d(2012, 1, 1), today, jurisdiction: 'FR' });
    expect(young).toEqual({ allowed: false, violations: [{ invariant: 'S7', reasonCode: 'safety.s7.under_minimum_age' }] });
  });

  const date = fc
    .record({ year: fc.integer({ min: 1900, max: 2100 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 31 }) })
    .filter(isValidCalendarDate);

  it('property: nobody under 16 is ever allowed, everybody 16 or over is', () => {
    fc.assert(
      fc.property(date, date, (birth, today) => {
        const outcome = evaluateAgeGate(birth, today);
        const naive = new Date(Date.UTC(birth.year, birth.month - 1, birth.day));
        const sixteenth = new Date(Date.UTC(birth.year + 16, birth.month - 1, birth.day));
        // A 29 Feb birthday rolls to 1 Mar in common years, matching Date.UTC overflow.
        const t = new Date(Date.UTC(today.year, today.month - 1, today.day));
        if (t < naive) return outcome.status === 'invalid';
        // FIX-B (MOB-13): older than the plausibility bound is a typing error, never "allowed" (fails closed).
        if (ageInYears(birth, today) > AGE_GATE_CONFIG.maxPlausibleAgeYears.value) return outcome.status === 'invalid';
        return t >= sixteenth ? outcome.status === 'allowed' : outcome.status === 'blocked';
      }),
      { numRuns: 5000 },
    );
  });

  it('property: age never decreases as time passes', () => {
    fc.assert(
      fc.property(date, date, date, (birth, a, b) => {
        const [early, late] = [a, b].sort((x, y) => x.year - y.year || x.month - y.month || x.day - y.day) as [CalendarDate, CalendarDate];
        return ageInYears(birth, early) <= ageInYears(birth, late);
      }),
    );
  });
});
