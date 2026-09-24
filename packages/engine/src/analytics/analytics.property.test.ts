import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../program/dates.js';
import { analyticsValue, ewmaTrend, forecastMilestone, sustainedLossEvent, weeklyRates, type DatedValue } from './index.js';

/**
 * M04 properties (fast-check): the trend never leaves the range of the
 * weigh-ins; a forecast is always an estimate and, when it gives a window,
 * a range of at least `forecast.minRangeDays` starting after today; the
 * guardrail fires only when every one of the last weeks lost more than the
 * threshold.
 */
const START = '2026-01-05';

const series = fc
  .array(fc.record({ gap: fc.integer({ min: 1, max: 10 }), value: fc.double({ min: 35, max: 180, noNaN: true }) }), { minLength: 1, maxLength: 120 })
  .map((steps) => {
    let date = START;
    return steps.map(({ gap, value }, i): DatedValue => {
      if (i > 0) date = addDays(date, gap);
      return { date, value: Math.round(value * 10) / 10 };
    });
  });

describe('M04 analytics properties', () => {
  it('the EWMA trend stays within the lowest and highest weigh-in, one point per weigh-in', () => {
    fc.assert(
      fc.property(series, (s) => {
        const trend = ewmaTrend(s);
        const lo = Math.min(...s.map((p) => p.value));
        const hi = Math.max(...s.map((p) => p.value));
        expect(trend).toHaveLength(s.length);
        for (const p of trend) {
          expect(p.trend).toBeGreaterThanOrEqual(lo - 1e-3);
          expect(p.trend).toBeLessThanOrEqual(hi + 1e-3);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('the guardrail event exists only when every week of the window lost more than the threshold', () => {
    fc.assert(
      fc.property(series, (s) => {
        const trend = ewmaTrend(s);
        const today = s[s.length - 1]!.date;
        const event = sustainedLossEvent(trend, today);
        const rates = weeklyRates(trend, today, analyticsValue('guardrail.consecutiveWeeks'));
        const all = rates.every((r) => r !== null && r.percentPerWeek < -analyticsValue('guardrail.lossPercentPerWeek'));
        expect(event !== null).toBe(all);
        if (event) {
          expect(event.weeks).toHaveLength(analyticsValue('guardrail.consecutiveWeeks'));
          expect(event.reasonCodes).toContain('progress.guardrail.sustained_loss');
        }
      }),
      { numRuns: 400 },
    );
  });

  it('a forecast is always an estimate; a window is a range of at least minRangeDays, after today, within the horizon', () => {
    const points = fc.array(fc.record({ day: fc.integer({ min: 0, max: 120 }), value: fc.double({ min: 0, max: 10, noNaN: true }) }), { minLength: 0, maxLength: 40 });
    fc.assert(
      fc.property(points, fc.double({ min: 0.5, max: 12, noNaN: true }), fc.boolean(), (pts, target, achieved) => {
        const today = addDays(START, 120);
        const f = forecastMilestone({ milestoneId: 'm', points: pts.map((p) => ({ date: addDays(START, p.day), value: p.value })), target, today, achieved });
        expect(f.estimate).toBe(true);
        expect(f.reasonCodes).toContain('progress.forecast.estimate_only');
        if (achieved) expect(f.status).toBe('achieved');
        if (f.status === 'forecast') {
          expect(f.earliest! > today).toBe(true);
          expect(f.earliest! < f.latest!).toBe(true);
          expect(addDays(f.earliest!, analyticsValue('forecast.minRangeDays')) <= f.latest!).toBe(true);
          expect(f.latest! <= addDays(today, analyticsValue('forecast.horizonDays') + analyticsValue('forecast.minRangeDays') + 1)).toBe(true);
          expect(f.confidence).not.toBeNull();
        } else {
          expect([f.earliest, f.latest, f.confidence]).toEqual([null, null, null]);
        }
      }),
      { numRuns: 600 },
    );
  });
});
