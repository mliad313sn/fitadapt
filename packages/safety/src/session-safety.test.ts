import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PAIN_CONFIG,
  S2_RED_PAIN_SCORE,
  S5_MAX_INCREASE_FRACTION,
  S5_WINDOW_DAYS,
  evaluateSafety,
  intensityLockCheck,
  intensityLockStatus,
  jointFlagsFromPain,
  loadCeilingCheck,
  s5LoadCeiling,
} from './index.js';

const NOW = Date.parse('2026-10-01T08:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();

describe('S5 load ceiling', () => {
  it('is 10 % above the lowest load in the 7 days before now; constants, not configuration', () => {
    expect(S5_MAX_INCREASE_FRACTION).toBe(0.1);
    expect(S5_WINDOW_DAYS).toBe(7);
    expect(s5LoadCeiling([], NOW)).toBeNull();
    expect(s5LoadCeiling([{ loadKg: 100, at: at(NOW - 3 * DAY) }], NOW)).toBeCloseTo(110);
    expect(s5LoadCeiling([{ loadKg: 100, at: at(NOW - 3 * DAY) }, { loadKg: 105, at: at(NOW - DAY) }], NOW)).toBeCloseTo(110);
    // Exactly 7 days is inside; older is outside.
    expect(s5LoadCeiling([{ loadKg: 100, at: at(NOW - 7 * DAY) }], NOW)).toBeCloseTo(110);
    expect(s5LoadCeiling([{ loadKg: 100, at: at(NOW - 7 * DAY - 1) }], NOW)).toBeNull();
  });

  it('counts loads dated after now (clock moved back), unparseable dates, and ignores zero loads', () => {
    expect(s5LoadCeiling([{ loadKg: 100, at: at(NOW + 5 * DAY) }], NOW)).toBeCloseTo(110);
    expect(s5LoadCeiling([{ loadKg: 100, at: 'not a date' }], NOW)).toBeCloseTo(110);
    expect(s5LoadCeiling([{ loadKg: 0, at: at(NOW) }], NOW)).toBeNull();
  });

  it('as a check: refuses anything above the ceiling', () => {
    const references = [{ loadKg: 50, at: at(NOW - DAY) }];
    expect(loadCeilingCheck({ loadKg: 55, references, nowMs: NOW })).toBeNull();
    expect(loadCeilingCheck({ loadKg: 55.5, references, nowMs: NOW })).toEqual({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling' });
    expect(loadCeilingCheck({ loadKg: 500, references: [], nowMs: NOW })).toBeNull();
  });

  it('SAF-8: fails closed on loads and references that are not finite numbers', () => {
    const references = [{ loadKg: 50, at: at(NOW - DAY) }];
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(loadCeilingCheck({ loadKg: bad, references, nowMs: NOW })).toEqual({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling' });
      expect(loadCeilingCheck({ loadKg: bad, references: [], nowMs: NOW })).toEqual({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling' });
      // An unreadable reference in the window caps at 0 (never dropped); outside the window it is not a reference.
      expect(s5LoadCeiling([...references, { loadKg: bad, at: at(NOW - DAY) }], NOW)).toBe(0);
      expect(s5LoadCeiling([...references, { loadKg: bad, at: at(NOW - 8 * DAY) }], NOW)).toBeCloseTo(55);
    }
    expect(loadCeilingCheck({ loadKg: 1, references: [{ loadKg: Number.NaN, at: at(NOW) }], nowMs: NOW })).toEqual({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling' });
    expect(loadCeilingCheck({ loadKg: 0, references: [{ loadKg: Number.NaN, at: at(NOW) }], nowMs: NOW })).toBeNull();
  });

  it('property: a load at or below the ceiling never exceeds +10 % of any reference in the window', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ loadKg: fc.double({ min: 0.5, max: 400, noNaN: true }), offsetDays: fc.double({ min: -30, max: 30, noNaN: true }) }), { minLength: 1, maxLength: 12 }), (refs) => {
        const references = refs.map((r) => ({ loadKg: r.loadKg, at: at(NOW + r.offsetDays * DAY) }));
        const ceiling = s5LoadCeiling(references, NOW);
        const inWindow = refs.filter((r) => r.offsetDays >= -7);
        if (inWindow.length === 0) return ceiling === null;
        return inWindow.every((r) => ceiling! <= r.loadKg * 1.1 + 1e-9);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('S2 joint flags from pain reports', () => {
  it('the latest report of a joint decides: ≥ 6 red, ≥ amber score amber', () => {
    expect(S2_RED_PAIN_SCORE).toBe(6);
    expect(PAIN_CONFIG.amberPainScore.validated).toBe(false);
    expect(jointFlagsFromPain([])).toEqual({});
    expect(jointFlagsFromPain([{ joint: 'knee', score: 6, at: at(NOW) }])).toEqual({ knee: 'red' });
    expect(jointFlagsFromPain([{ joint: 'knee', score: 5, at: at(NOW) }, { joint: 'shoulder', score: 2, at: at(NOW) }])).toEqual({ knee: 'amber' });
    expect(jointFlagsFromPain([{ joint: 'knee', score: 8, at: at(NOW) }, { joint: 'knee', score: 1, at: at(NOW + DAY) }])).toEqual({});
    expect(jointFlagsFromPain([{ joint: 'knee', score: 1, at: at(NOW) }, { joint: 'knee', score: 9, at: at(NOW + DAY) }])).toEqual({ knee: 'red' });
  });
  it('property: any latest score ≥ 6 is red', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ joint: fc.constantFrom('knee', 'shoulder', 'lumbar' as const), score: fc.integer({ min: 0, max: 10 }) })), (reports) => {
        const flags = jointFlagsFromPain(reports.map((r) => ({ ...r, at: at(NOW) })));
        for (const joint of ['knee', 'shoulder', 'lumbar'] as const) {
          const last = reports.filter((r) => r.joint === joint).at(-1);
          if (last && last.score >= 6) expect(flags[joint]).toBe('red');
          if (!last || last.score < 6) expect(flags[joint]).not.toBe('red');
        }
      }),
    );
  });
});

describe('S3 intensity lock', () => {
  const flag = (ms: number) => ({ kind: 'red_flag', at: at(ms) });
  const attest = (ms: number) => ({ kind: 'medical_review_attested', at: at(ms) });
  it('locks after a red flag until a later medical-review attestation', () => {
    expect(intensityLockStatus([])).toEqual({ locked: false, since: null });
    expect(intensityLockStatus([flag(NOW)])).toEqual({ locked: true, since: at(NOW) });
    expect(intensityLockStatus([flag(NOW), attest(NOW + DAY)])).toEqual({ locked: false, since: null });
    expect(intensityLockStatus([flag(NOW), attest(NOW + DAY), flag(NOW + 2 * DAY)])).toEqual({ locked: true, since: at(NOW + 2 * DAY) });
    expect(intensityLockStatus([{ kind: 'pain', at: at(NOW) }])).toEqual({ locked: false, since: null });
  });
  it('fails closed on clock tricks: an attestation dated before the flag, or recorded before it, does not unlock', () => {
    expect(intensityLockStatus([flag(NOW), attest(NOW - DAY)]).locked).toBe(true);
    expect(intensityLockStatus([attest(NOW + 10 * DAY), flag(NOW)]).locked).toBe(true);
    expect(intensityLockStatus([flag(NOW), { kind: 'medical_review_attested', at: 'garbage' }]).locked).toBe(true);
    expect(intensityLockStatus([{ kind: 'red_flag', at: 'garbage' }, attest(NOW)]).locked).toBe(true);
  });
  it('as a check with evaluateSafety', () => {
    expect(evaluateSafety([{ invariant: 'S3', check: intensityLockCheck }], { lock: intensityLockStatus([flag(NOW)]) })).toMatchObject({ allowed: false, violations: [{ invariant: 'S3', reasonCode: 'safety.s3.intensity_locked' }] });
    expect(evaluateSafety([{ invariant: 'S3', check: intensityLockCheck }], { lock: intensityLockStatus([]) }).allowed).toBe(true);
  });
  it('property: whatever the order and dates, the lock is off only when an attestation follows every flag in order and in time', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ kind: fc.constantFrom('red_flag', 'medical_review_attested'), offset: fc.integer({ min: -20, max: 20 }) }), { maxLength: 8 }), (raw) => {
        const events = raw.map((e) => ({ kind: e.kind, at: at(NOW + e.offset * DAY) }));
        const status = intensityLockStatus(events);
        const flags = raw.map((e, i) => ({ ...e, i })).filter((e) => e.kind === 'red_flag');
        const attests = raw.map((e, i) => ({ ...e, i })).filter((e) => e.kind !== 'red_flag');
        if (flags.length === 0) return !status.locked;
        const lastAttest = attests.at(-1);
        const unlocked = lastAttest !== undefined && flags.every((f) => f.i < lastAttest.i && f.offset < Math.max(...attests.map((a) => a.offset)));
        return status.locked === !unlocked;
      }),
      { numRuns: 2000 },
    );
  });
});
