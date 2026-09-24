import { FairScoreSchema, type ExecutionLog, type ScoredSet, type SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { HOME_ID, HOME_LOADS, SESSION_LIBRARY, programContext } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import type { GenerateSessionInput } from '../session/types.js';
import { M09_REASON_CODES } from './reason-codes.js';
import { generatePairSession } from './generate.js';
import { challengeComparable, expectedUnits, fairScore } from './score.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const HOME = [...P1_HOME];
const at = (s: number) => new Date(MON + s * 1000).toISOString();
const input = (bodyweightKg: number, minutes: number, id: string): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: HOME,
  equipmentLoads: HOME_LOADS,
  equipmentProfileId: HOME_ID,
  minutesAvailable: minutes,
  programSession: programContext({ location: 'home', equipmentProfileId: HOME_ID, id }),
  experience: 'beginner',
  bodyweightKg,
});
/** P1 (Ibrahima, 120 kg) and P2 (Awa, 60 kg) — fictional — training the same pair session at home. */
function pair() {
  const r = generatePairSession(input(120, 40, 'w01.s1'), input(60, 45, 'w01.s2'), { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: 3 }));
  if (r.status !== 'ok') throw new Error('expected a pair session');
  return { a: r.a.plan, b: r.b.plan };
}
const total = (plan: SessionPlan) => plan.exercises.flatMap((e) => e.sets).reduce((t, s) => t + expectedUnits(s), 0);

/**
 * "Equal relative effort": each person does the same share f of their OWN
 * expected volume (to the nearest rep or second over the session), at the
 * same share g of their own prescribed load. Filled set by set in plan order.
 */
function effort(plan: SessionPlan, f: number, g = 1, offset = 0): ScoredSet[] {
  let left = Math.round(f * total(plan));
  const out: ScoredSet[] = [];
  plan.exercises.forEach((e, i) => {
    for (const s of e.sets) {
      const units = Math.min(expectedUnits(s), left);
      left -= units;
      if (units === 0) continue;
      out.push({
        exerciseIndex: i,
        exerciseId: e.exerciseId,
        loggedAt: at(offset + out.length * 60),
        set: { index: s.index, status: 'done', reps: s.target.kind === 'reps' ? units : null, seconds: s.target.kind === 'hold' ? units : null, loadKg: s.loadKg === null ? null : s.loadKg * g, rir: s.targetRir },
      });
    }
  });
  return out;
}
const ended = (plan: SessionPlan, reason: 'completed' | 'user_stop' = 'completed', s = 5000): ExecutionLog => ({ kind: 'ended', planId: plan.planId, reason, at: at(s) });
/** Absolute volume: what the score must NOT compare (external load, or the share of body weight moved). */
function absoluteVolume(plan: SessionPlan, sets: readonly ScoredSet[], bodyweightKg: number) {
  return sets.reduce((t, s) => {
    const reps = s.set.reps ?? s.set.seconds ?? 0;
    const load = s.set.loadKg ?? (SESSION_LIBRARY.bodyweightLoad?.(s.exerciseId) ?? 0.5) * bodyweightKg;
    return t + reps * load;
  }, 0);
}
const relDiff = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y);

describe('Fair Challenge Score (goal condition 2): equal relative effort gives equal scores within 5 %', () => {
  it('P1 (120 kg) and P2 (60 kg) each completing their own plan both score 100, though their absolute volumes differ widely', () => {
    const { a, b } = pair();
    const sa = fairScore({ participant: 'a', plan: a, sets: effort(a, 1), events: [ended(a)] });
    const sb = fairScore({ participant: 'b', plan: b, sets: effort(b, 1), events: [ended(b)] });
    expect(FairScoreSchema.parse(sa)).toEqual(sa);
    expect([sa.points, sb.points]).toEqual([100, 100]);
    expect([sa.status, sb.status]).toEqual(['complete', 'complete']);
    expect(challengeComparable(sa, sb)).toBe(true);
    const va = absoluteVolume(a, effort(a, 1), 120);
    const vb = absoluteVolume(b, effort(b, 1), 60);
    expect(va / vb > 1.3 || vb / va > 1.3).toBe(true);
    expect(sa.reasonCodes).toEqual(['pair.score.relative', 'pair.score.complete']);
  });

  it.each([0.5, 0.6, 0.75, 0.9])('P1 and P2 each doing %s of their own plan: scores differ by ≤ 5 %%', (f) => {
    const { a, b } = pair();
    const sa = fairScore({ participant: 'a', plan: a, sets: effort(a, f), events: [] });
    const sb = fairScore({ participant: 'b', plan: b, sets: effort(b, f), events: [] });
    expect(relDiff(sa.points, sb.points)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(sa.points - 100 * f)).toBeLessThanOrEqual(2.5);
    expect(sa.status).toBe('scoring');
  });

  const planArbitrary = (loaded: 'mixed' | 'all') => {
    const { a: base } = pair();
    const template = base.exercises[0]!;
    const load = loaded === 'all' ? fc.double({ min: 1, max: 200, noNaN: true }) : fc.option(fc.double({ min: 1, max: 200, noNaN: true }), { nil: null });
    return fc
      .array(
        fc.record({
          sets: fc.array(fc.record({ min: fc.integer({ min: 3, max: 15 }), hold: fc.boolean(), load }), { minLength: 1, maxLength: 5 }),
          exerciseId: fc.constantFrom('push_up', 'knee_push_up', 'air_squat', 'dumbbell_floor_press', 'pull_up', 'front_plank'),
        }),
        { minLength: 1, maxLength: 7 },
      )
      .map((spec) => ({
        ...base,
        planId: '00000000-0000-4000-8000-000000000abc',
        exercises: spec.map((e) => ({ ...template, exerciseId: e.exerciseId, sets: e.sets.map((s, i) => ({ ...template.sets[0]!, index: i + 1, target: s.hold ? { kind: 'hold' as const, seconds: s.min * 4 } : { kind: 'reps' as const, min: s.min, max: s.min + 4 }, loadKg: s.load })) })),
      }))
      // A session worth comparing: at least 40 reps or seconds of expected volume.
      .filter((p) => total(p) >= 40);
  };

  it('property: across random pairs of plans (any mix of bodyweight, loaded and held sets), the same share of each own plan scores within 5 %', () => {
    const plans = planArbitrary('mixed');
    fc.assert(
      fc.property(plans, plans, fc.double({ min: 0.5, max: 1, noNaN: true }), (pa, pb, f) => {
        const sa = fairScore({ participant: 'a', plan: pa, sets: effort(pa, f), events: [], bodyweightLoad: SESSION_LIBRARY.bodyweightLoad });
        const sb = fairScore({ participant: 'b', plan: pb, sets: effort(pb, f), events: [], bodyweightLoad: SESSION_LIBRARY.bodyweightLoad });
        expect(relDiff(sa.points, sb.points)).toBeLessThanOrEqual(0.05);
      }),
      { numRuns: 2000 },
    );
  });

  it('property: loaded plans of any absolute loads (a 120 kg and a 60 kg lifter), the same share of volume at the same share of each own prescribed load scores within 5 %', () => {
    const plans = planArbitrary('all');
    fc.assert(
      fc.property(plans, plans, fc.double({ min: 0.5, max: 1, noNaN: true }), fc.double({ min: 0.5, max: 1, noNaN: true }), fc.double({ min: 0.2, max: 5, noNaN: true }), (pa, pb, f, g, scale) => {
        // B's prescribed loads are A's world scaled by any factor: absolute load never enters the score.
        const scaled: SessionPlan = { ...pb, exercises: pb.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, loadKg: s.loadKg === null ? null : s.loadKg * scale })) })) };
        const sa = fairScore({ participant: 'a', plan: pa, sets: effort(pa, f, g), events: [] });
        const sb = fairScore({ participant: 'b', plan: scaled, sets: effort(scaled, f, g), events: [] });
        expect(relDiff(sa.points, sb.points)).toBeLessThanOrEqual(0.05);
      }),
      { numRuns: 2000 },
    );
  });

  it('never rewards going past the prescription: extra reps or a heavier load score the same as the plan', () => {
    const { a } = pair();
    const plan = effort(a, 1);
    const more = plan.map((s) => ({ ...s, set: { ...s.set, reps: s.set.reps === null ? null : s.set.reps + 10, seconds: s.set.seconds === null ? null : s.set.seconds + 30, loadKg: s.set.loadKg === null ? null : s.set.loadKg * 1.5 } }));
    const base = fairScore({ participant: 'a', plan: a, sets: plan, events: [] });
    const over = fairScore({ participant: 'a', plan: a, sets: more, events: [] });
    expect(over.points).toBe(base.points);
    expect(over.reasonCodes).toContain('pair.score.capped_at_plan');
  });

  it('a lighter load or an easier variant counts by its coefficient (relative intensity, not absolute load)', () => {
    const { a } = pair();
    const loaded = a.exercises.findIndex((e) => e.sets[0]!.loadKg !== null);
    const sets = effort(a, 1);
    if (loaded >= 0) {
      const lighter = sets.map((s) => (s.exerciseIndex === loaded ? { ...s, set: { ...s.set, loadKg: s.set.loadKg! / 2 } } : s));
      const r = fairScore({ participant: 'a', plan: a, sets: lighter, events: [] });
      expect(r.points).toBeLessThan(100);
      expect(r.reasonCodes).toContain('pair.score.load_coefficient');
    }
    // A push-up prescribed, a knee push-up done (the M06 %-bodyweight ratio 0.49 / 0.64).
    const push: SessionPlan = { ...a, exercises: [{ ...a.exercises[0]!, exerciseId: 'push_up', sets: [{ ...a.exercises[0]!.sets[0]!, index: 1, loadKg: null, target: { kind: 'reps', min: 10, max: 12 } }] }] };
    const knee: ScoredSet[] = [{ exerciseIndex: 0, exerciseId: 'knee_push_up', loggedAt: at(10), set: { index: 1, status: 'done', reps: 10, seconds: null, loadKg: null, rir: 2 } }];
    const r = fairScore({ participant: 'a', plan: push, sets: knee, events: [], bodyweightLoad: SESSION_LIBRARY.bodyweightLoad });
    expect(r.points).toBeCloseTo((100 * 0.49) / 0.64, 0);
    expect(r.reasonCodes).toContain('pair.score.variant_coefficient');
    // Unknown %-bodyweight: counted like the prescribed variant (engine swaps keep the stimulus).
    expect(fairScore({ participant: 'a', plan: push, sets: knee, events: [] }).points).toBe(100);
  });

  it('never rewards training through pain: nothing counts from the first pain report; a red flag ends it', () => {
    const { a } = pair();
    const sets = effort(a, 1);
    const pain: ExecutionLog = { kind: 'pain', planId: a.planId, joint: 'knee', score: 4, at: sets[3]!.loggedAt };
    const paused = fairScore({ participant: 'a', plan: a, sets, events: [pain] });
    const firstThree = fairScore({ participant: 'a', plan: a, sets: sets.slice(0, 3), events: [] });
    expect(paused.points).toBe(firstThree.points);
    expect(paused.status).toBe('paused_pain');
    const red: ExecutionLog = { kind: 'red_flag', planId: a.planId, symptom: 'chest_pain_pressure', at: sets[2]!.loggedAt };
    const stop = fairScore({ participant: 'a', plan: a, sets, events: [red, ended(a, 'user_stop')] });
    expect(stop.status).toBe('safety_stop');
    expect(stop.points).toBe(fairScore({ participant: 'a', plan: a, sets: sets.slice(0, 2), events: [] }).points);
    // A pain report after the session (the post-session check) or for another plan does not pause it.
    const after: ExecutionLog = { kind: 'pain', planId: a.planId, joint: 'knee', score: 4, at: sets[3]!.loggedAt, phase: 'after_session' };
    expect(fairScore({ participant: 'a', plan: a, sets, events: [after] }).status).toBe('scoring');
    expect(fairScore({ participant: 'a', plan: a, sets, events: [{ ...pain, planId: '00000000-0000-4000-8000-0000000000ff' }] }).status).toBe('scoring');
  });

  it('property: sets logged after a pain report never change the score', () => {
    const { a } = pair();
    const all = effort(a, 1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: all.length - 1 }), fc.integer({ min: 0, max: 10 }), (k, score) => {
        const pain: ExecutionLog = { kind: 'pain', planId: a.planId, joint: 'shoulder', score, at: all[k]!.loggedAt };
        const withAll = fairScore({ participant: 'a', plan: a, sets: all, events: [pain] });
        const upToPain = fairScore({ participant: 'a', plan: a, sets: all.slice(0, k), events: [pain] });
        expect(withAll.points).toBe(upToPain.points);
      }),
      { numRuns: 300 },
    );
  });

  it('stopping early is allowed and shown as stopped; only two completed plans are compared (no winner, L4)', () => {
    const { a, b } = pair();
    const sa = fairScore({ participant: 'a', plan: a, sets: effort(a, 0.5), events: [ended(a, 'user_stop')] });
    const sb = fairScore({ participant: 'b', plan: b, sets: effort(b, 1), events: [ended(b)] });
    expect(sa.status).toBe('stopped');
    expect(challengeComparable(sa, sb)).toBe(false);
    expect(challengeComparable(sb, sb)).toBe(true);
    expect(Object.keys(sa)).not.toContain('winner');
    // A later log of the same set replaces the earlier one (append-only corrections), skipped sets count 0.
    const first = effort(a, 1).slice(0, 1);
    const corrected = [...first, { ...first[0]!, loggedAt: at(999), set: { ...first[0]!.set, status: 'skipped' as const, reps: null } }];
    expect(fairScore({ participant: 'a', plan: a, sets: corrected, events: [] }).points).toBe(0);
    // An empty plan has nothing expected: 0 points, never NaN.
    expect(fairScore({ participant: 'a', plan: { ...a, exercises: [] }, sets: [], events: [] }).points).toBe(0);
  });

  it('every score reason code is a listed M09 code', () => {
    const { a } = pair();
    for (const events of [[], [ended(a)], [ended(a, 'user_stop')]]) {
      for (const code of fairScore({ participant: 'a', plan: a, sets: effort(a, 1), events }).reasonCodes) expect(M09_REASON_CODES).toContain(code);
    }
  });
});
