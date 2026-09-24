import type { ReadinessCheck, SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FULL_GYM, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY, RECOVERY_LIBRARY } from '../__fixtures__/recovery.js';
import { GYM_ID, GYM_LOADS, programContext } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import type { GenerateSessionInput } from '../session/types.js';
import { readinessCheckOn, readinessFromCheck, readinessLevelOn } from './readiness.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const check = (a: Partial<ReadinessCheck> = {}): ReadinessCheck => ({ schemaVersion: 1, date: '2026-09-28', at: '2026-09-28T07:00:00.000Z', sleep: 4, soreness: 2, stress: 2, energy: 4, wearable: null, ...a });
const gym = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: [...FULL_GYM, 'cable_station'],
  equipmentLoads: GYM_LOADS,
  equipmentProfileId: GYM_ID,
  minutesAvailable: 240,
  programSession: programContext(),
  capacity: GYM_CAPACITY,
  experience: 'intermediate',
  ...over,
});
const run = (input: GenerateSessionInput): SessionPlan => {
  const r = generateSession(input, RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: 9 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan;
};

describe('M05 readiness (goal condition 5)', () => {
  it('scores the four answers 0–100: sleep and energy up is good, soreness and stress up is not', () => {
    expect(readinessFromCheck(check({ sleep: 5, soreness: 1, stress: 1, energy: 5 }))).toMatchObject({ score: 100, level: 'normal', used: ['check'], reasonCodes: ['readiness.ok', 'readiness.check_only'] });
    expect(readinessFromCheck(check({ sleep: 1, soreness: 5, stress: 5, energy: 1 }))).toMatchObject({ score: 0, level: 'reduced', reasonCodes: ['readiness.low', 'readiness.check_only'] });
    expect(readinessFromCheck(check({ sleep: 3, soreness: 3, stress: 3, energy: 3 })).score).toBe(50);
    expect(readinessFromCheck(check({ sleep: 3, soreness: 3, stress: 3, energy: 3 })).level).toBe('normal');
    expect(readinessFromCheck(check({ sleep: 2, soreness: 3, stress: 3, energy: 3 })).level).toBe('reduced');
    expect(() => readinessFromCheck(check({ sleep: 6 }))).toThrow();
  });

  it('HRV well below baseline or resting HR well above lowers the score; missing wearable data never blocks and never changes it', () => {
    const base = check({ sleep: 3, soreness: 3, stress: 2, energy: 3 }); // 56
    expect(readinessFromCheck(base).score).toBe(56);
    const withWatch = (w: Partial<NonNullable<ReadinessCheck['wearable']>>) => check({ ...base, wearable: { hrvMs: null, hrvBaselineMs: null, restingHr: null, restingHrBaseline: null, ...w } });
    expect(readinessFromCheck(withWatch({ hrvMs: 40, hrvBaselineMs: 60 }))).toMatchObject({ score: 46, level: 'reduced', used: ['check', 'hrv'], reasonCodes: ['readiness.low', 'readiness.hrv_below_baseline'] });
    expect(readinessFromCheck(withWatch({ restingHr: 70, restingHrBaseline: 60 }))).toMatchObject({ score: 46, used: ['check', 'resting_hr'], reasonCodes: ['readiness.low', 'readiness.resting_hr_above_baseline'] });
    expect(readinessFromCheck(withWatch({ hrvMs: 58, hrvBaselineMs: 60, restingHr: 62, restingHrBaseline: 60 }))).toMatchObject({ score: 56, level: 'normal', used: ['check', 'hrv', 'resting_hr'], reasonCodes: ['readiness.ok'] });
    // Readings without their baseline (or all null) are simply not used.
    for (const w of [{ hrvMs: 20 }, { hrvBaselineMs: 60 }, { restingHr: 100 }, {}]) {
      expect(readinessFromCheck(withWatch(w))).toMatchObject({ score: 56, level: 'normal', used: ['check'] });
    }
    expect(readinessFromCheck(withWatch({ hrvMs: 10, hrvBaselineMs: 100, restingHr: 120, restingHrBaseline: 50 })).score).toBe(36);
    expect(readinessFromCheck(check({ sleep: 1, soreness: 5, stress: 5, energy: 1, wearable: { hrvMs: 10, hrvBaselineMs: 100, restingHr: 120, restingHrBaseline: 50 } })).score).toBe(0);
  });

  it('no check → no adjustment; the latest check of the day counts', () => {
    expect(readinessLevelOn([], '2026-09-28')).toBeUndefined();
    expect(readinessCheckOn([check({ date: '2026-09-27' })], '2026-09-28')).toBeNull();
    expect(readinessLevelOn([check({ sleep: 1, soreness: 5, stress: 5, energy: 1 }), check()], '2026-09-28')).toBe('normal');
    expect(readinessLevelOn([check(), check({ sleep: 1, soreness: 5, stress: 5, energy: 1 })], '2026-09-28')).toBe('reduced');
  });

  it('a low score trims volume by one set per exercise (min 1), leaves out the extras and adds a rep in reserve', () => {
    const normal = run(gym());
    const low = run(gym({ readiness: readinessLevelOn([check({ sleep: 1, soreness: 4, stress: 4, energy: 2 })], '2026-09-28')! }));
    expect(low.reasonCodes).toEqual(expect.arrayContaining(['session.readiness.reduced']));
    expect(low.targetRir).toBe(normal.targetRir + 1);
    for (const e of low.exercises) {
      const before = normal.exercises.find((x) => x.slot === e.slot && x.role === e.role)!;
      expect(e.sets.length).toBe(Math.max(1, before.sets.length - 1));
    }
    // Every non-accessory exercise is still there; the extras are left out (M02 rule, explained).
    expect(low.exercises.map((e) => e.slot)).toEqual(normal.exercises.filter((e) => e.role !== 'accessory').map((e) => e.slot));
    if (normal.exercises.some((e) => e.role === 'accessory')) expect(low.reasonCodes).toContain('session.readiness.accessory_dropped');
  });

  it('missing wearable data never blocks: a check without it, or no check at all, always gives a session', () => {
    const noCheck = generateSession(gym({ readiness: readinessLevelOn([], '2026-09-28') }), RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: 9 }));
    expect(noCheck.status).toBe('ok');
    const noWatch = generateSession(gym({ readiness: readinessLevelOn([check({ wearable: null })], '2026-09-28') }), RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: 9 }));
    expect(noWatch.status).toBe('ok');
  });

  it('property: whatever the answers and readings, readiness never makes a session harder (sets, loads, reserve)', () => {
    const normal = run(gym());
    const answer = fc.integer({ min: 1, max: 5 });
    const reading = (min: number, max: number) => fc.option(fc.integer({ min, max }), { nil: null });
    fc.assert(
      fc.property(answer, answer, answer, answer, fc.option(fc.record({ hrvMs: reading(5, 300), hrvBaselineMs: reading(5, 300), restingHr: reading(25, 220), restingHrBaseline: reading(25, 220) }), { nil: null }), (sleep, soreness, stress, energy, wearable) => {
        const c = check({ sleep, soreness, stress, energy, wearable });
        const r = readinessFromCheck(c);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        const p = run(gym({ readiness: r.level }));
        expect(p.targetRir).toBeGreaterThanOrEqual(normal.targetRir);
        for (const e of p.exercises) {
          const before = normal.exercises.find((x) => x.slot === e.slot && x.role === e.role)!;
          expect(e.sets.length).toBeLessThanOrEqual(before.sets.length);
          for (const s of e.sets) expect(s.loadKg ?? 0).toBeLessThanOrEqual(before.sets[0]!.loadKg ?? 0);
        }
      }),
      { numRuns: 300 },
    );
  });
});
