import { JOINTS, SCREENING_QUESTION_IDS, SharedTimelineSchema, type EquipmentId, type JointFlags, type PlannedExercise, type SessionPlan, type SharedTimeline } from '@fitadapt/shared';
import { screeningGateCheck } from '@fitadapt/safety';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FULL_GYM, P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { GYM_ID, GYM_LOADS, HOME_ID, HOME_LOADS, SESSION_LIBRARY, programContext, slot } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import type { GenerateSessionInput } from '../session/types.js';
import { hasEquipment, redJointsLoaded } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { PAIR_CONFIG, PAIR_RULES_VERSION } from './config.js';
import { generatePairSession, partnerSeed } from './generate.js';
import { implementsOf, mergePlans, PairEquipmentError, remainingTimeline, setKey, workSeconds, type SharedEquipment } from './merge.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const ctx = (seed = 11) => createEngineContext({ clock: fixedClock(MON), seed });
const GYM = [...FULL_GYM, 'cable_station'] as EquipmentId[];
const HOME: EquipmentId[] = [...P1_HOME];

/** P1-like (Ibrahima, 120 kg, beginner, amber knees history) and P2-like (Awa, 60 kg, beginner) inputs — fictional. */
const p1 = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: HOME,
  equipmentLoads: HOME_LOADS,
  equipmentProfileId: HOME_ID,
  minutesAvailable: 40,
  programSession: programContext({ location: 'home', equipmentProfileId: HOME_ID }),
  experience: 'beginner',
  bodyweightKg: 120,
  ...over,
});
const p2 = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: HOME,
  equipmentLoads: HOME_LOADS,
  equipmentProfileId: HOME_ID,
  minutesAvailable: 45,
  programSession: programContext({ location: 'home', equipmentProfileId: HOME_ID, id: 'w01.s2' }),
  experience: 'beginner',
  bodyweightKg: 60,
  ...over,
});
const home: SharedEquipment = { items: HOME, graph: SESSION_LIBRARY.graph };
const pairAtHome = (a = p1(), b = p2(), seed = 11) => {
  const r = generatePairSession(a, b, { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, ctx(seed));
  if (r.status !== 'ok') throw new Error('expected a pair session');
  return r;
};

/** Every set of a plan appears exactly once in the timeline, for its own partner, in its own order. */
function stepsOf(timeline: SharedTimeline, who: 'a' | 'b') {
  return timeline.steps.filter((s) => s.kind === 'set' && s.participant === who);
}
function expectRestWindows(timeline: SharedTimeline) {
  for (const who of ['a', 'b'] as const) {
    const own = stepsOf(timeline, who);
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1]!;
      expect(own[i]!.startSecond, `${who} step ${own[i]!.index}`).toBeGreaterThanOrEqual(prev.startSecond + prev.durationSeconds + prev.restAfterSeconds);
    }
  }
}
function expectEveryPlanSetOnce(timeline: SharedTimeline, plan: SessionPlan, who: 'a' | 'b') {
  const own = stepsOf(timeline, who).map((s) => [s.exerciseIndex, s.setIndex]);
  const all = plan.exercises.flatMap((e, i) => e.sets.map((_, s) => [i, s]));
  expect(own).toEqual(all);
}

describe('mergePlans (goal condition 1): one shared timeline from two individual plans', () => {
  it('P1 + P2 at home: same pattern per block, each partner their own variant and load, rest windows honoured for both', () => {
    const { a, b, timeline } = pairAtHome();
    expect(SharedTimelineSchema.parse(timeline)).toEqual(timeline);
    expect(timeline).toMatchObject({ engineVersion: ENGINE_VERSION, rulesVersion: PAIR_RULES_VERSION, planA: a.plan.planId, planB: b.plan.planId });
    const shared = timeline.blocks.filter((k) => k.kind === 'shared');
    expect(shared.length).toBeGreaterThanOrEqual(4);
    for (const block of shared) {
      // Same pattern for both partners in the block…
      expect(a.plan.exercises[block.a!]!.slot).toBe(block.pattern);
      expect(b.plan.exercises[block.b!]!.slot).toBe(block.pattern);
      // …each with their own exercise from their own plan.
      expect(block.exerciseA).toBe(a.plan.exercises[block.a!]!.exerciseId);
      expect(block.exerciseB).toBe(b.plan.exercises[block.b!]!.exerciseId);
    }
    expectEveryPlanSetOnce(timeline, a.plan, 'a');
    expectEveryPlanSetOnce(timeline, b.plan, 'b');
    expectRestWindows(timeline);
    // Turns alternate inside a shared block (I go / you go).
    for (const block of shared) {
      const order = timeline.steps.filter((s) => s.block === block.index).map((s) => s.participant);
      const na = a.plan.exercises[block.a!]!.sets.length;
      const nb = b.plan.exercises[block.b!]!.sets.length;
      const interleaved = Array.from({ length: Math.max(na, nb) }, (_, k) => [...(k < na ? ['a'] : []), ...(k < nb ? ['b'] : [])]).flat();
      expect(order).toEqual(interleaved);
      expect(order.slice(0, 2)).toEqual(['a', 'b']);
    }
    // One partner's set is the other's rest: the timeline is shorter than the two sessions one after the other.
    const solo = (plan: SessionPlan) => plan.exercises.flatMap((e) => e.sets).reduce((t, s) => t + workSeconds(s) + s.restSeconds, 0);
    expect(timeline.totalSeconds).toBeLessThan(solo(a.plan) + solo(b.plan));
    expect(timeline.reasonCodes).toEqual(expect.arrayContaining(['pair.timeline.turns', 'pair.timeline.rest_kept', 'pair.timeline.own_prescriptions']));
  });

  it('never changes a prescription: the plans are the ones generateSession gives each partner alone at the shared place', () => {
    const { a, b } = pairAtHome();
    const alone = (input: GenerateSessionInput, who: 'a' | 'b') => generateSession(input, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: partnerSeed(11, who) }));
    expect(alone(p1(), 'a')).toEqual({ status: 'ok', plan: a.plan, safetyEvents: a.safetyEvents });
    expect(alone(p2(), 'b')).toEqual({ status: 'ok', plan: b.plan, safetyEvents: b.safetyEvents });
  });

  it('a pattern only one partner has becomes a solo block; the other partner has no step in it', () => {
    const { a, b } = pairAtHome();
    const extra: PlannedExercise = { ...b.plan.exercises[0]!, slot: 'carry', exerciseId: 'farmer_carry' };
    const planB: SessionPlan = { ...b.plan, exercises: [...b.plan.exercises, extra] };
    const timeline = mergePlans(a.plan, planB, home);
    const solo = timeline.blocks.filter((k) => k.kind === 'solo');
    expect(solo.map((k) => [k.pattern, k.a, k.b !== null])).toContainEqual(['carry', null, true]);
    for (const k of solo) expect(new Set(timeline.steps.filter((s) => s.block === k.index).map((s) => s.participant)).size).toBe(1);
    expectEveryPlanSetOnce(timeline, planB, 'b');
    expectRestWindows(timeline);
  });

  it('keeps each partner’s own exercise order (alignment on patterns, longest common subsequence)', () => {
    const { a, b } = pairAtHome();
    const reversed: SessionPlan = { ...b.plan, exercises: [...b.plan.exercises].reverse() };
    const timeline = mergePlans(a.plan, reversed, home);
    for (const [who, plan] of [['a', a.plan], ['b', reversed]] as const) {
      const order = stepsOf(timeline, who).map((s) => s.exerciseIndex);
      expect(order).toEqual([...order].sort((x, y) => x! - y!));
      expectEveryPlanSetOnce(timeline, plan, who);
    }
    expectRestWindows(timeline);
  });

  it('one pair of dumbbells: staggered turns, with time to change the load between partners', () => {
    const { a, b } = pairAtHome();
    const dumbbell = (plan: SessionPlan, load: number): SessionPlan => ({
      ...plan,
      exercises: [{ ...plan.exercises[0]!, slot: 'horizontal_push', exerciseId: 'dumbbell_bench_press_fixture', sets: plan.exercises[0]!.sets.map((s) => ({ ...s, loadKg: load })) }],
    });
    const graph = { exercises: new Map([...SESSION_LIBRARY.graph.exercises, ['dumbbell_bench_press_fixture', { ...SESSION_LIBRARY.graph.exercises.get('push_up')!, id: 'dumbbell_bench_press_fixture', equipment: [{ anyOf: ['dumbbell' as const] }] }]]) };
    const one = mergePlans(dumbbell(a.plan, 10), dumbbell(b.plan, 6), { items: ['dumbbell'], graph });
    expect(one.blocks[1]!.conflict).toEqual({ equipment: 'dumbbell', resolution: 'staggered', changeoverSeconds: PAIR_CONFIG['equipment.changeoverSeconds'].value });
    expect(one.reasonCodes).toContain('pair.equipment.staggered');
    const sets = one.steps.filter((s) => s.kind === 'set');
    for (let i = 1; i < sets.length; i++) {
      // Never at the same time on one implement, and a changeover before a partner's turn.
      expect(sets[i]!.startSecond).toBeGreaterThanOrEqual(sets[i - 1]!.startSecond + sets[i - 1]!.durationSeconds + PAIR_CONFIG['equipment.changeoverSeconds'].value);
    }
    expectRestWindows(one);
    // Two pairs of dumbbells: no conflict, no changeover.
    const two = mergePlans(dumbbell(a.plan, 10), dumbbell(b.plan, 6), { items: ['dumbbell', 'dumbbell'], graph });
    expect(two.blocks[1]!.conflict).toBeNull();
    expect(two.totalSeconds).toBeLessThan(one.totalSeconds);
    // Same load on the shared implement: no changeover needed.
    const same = mergePlans(dumbbell(a.plan, 10), dumbbell(b.plan, 10), { items: ['dumbbell'], graph });
    expect(same.reasonCodes).not.toContain('pair.equipment.staggered');
  });

  it('refuses a plan made for another place: every exercise must be doable with the shared equipment', () => {
    const { a, b } = pairAtHome();
    const gymOnly: SessionPlan = { ...b.plan, exercises: [{ ...b.plan.exercises[0]!, exerciseId: 'barbell_back_squat' }] };
    expect(() => mergePlans(a.plan, gymOnly, home)).toThrow(PairEquipmentError);
    expect(() => implementsOf('no_such_exercise', home)).toThrow(PairEquipmentError);
  });

  it('warm-up, conditioning and cool-down are done together, each following their own content', () => {
    const { a, b } = pairAtHome();
    const withCardio = (plan: SessionPlan, minutes: number): SessionPlan => ({ ...plan, conditioning: { kind: 'steady', placement: 'finisher', minutes }, cardio: null, coolDown: { minutes: 3, drills: [{ exerciseId: 'hip_circles', seconds: 60 }] as never, reasonCodes: ['cooldown.after_session'] } });
    const timeline = mergePlans(withCardio(a.plan, 10), withCardio(b.plan, 12), home);
    const kinds = timeline.blocks.map((k) => k.kind);
    expect(kinds[0]).toBe('warm_up');
    expect(kinds.slice(-2)).toEqual(['conditioning', 'cool_down']);
    const cond = timeline.steps.find((s) => timeline.blocks[s.block]!.kind === 'conditioning')!;
    expect(cond).toMatchObject({ kind: 'together', participant: null, durationSeconds: 12 * 60 });
    // Together blocks wait for both partners' last rests.
    const lastSets = (['a', 'b'] as const).map((w) => stepsOf(timeline, w).at(-1)!);
    for (const s of lastSets) expect(cond.startSecond).toBeGreaterThanOrEqual(s.startSecond + s.durationSeconds + s.restAfterSeconds);
  });

  it('remainingTimeline: after sets are done, and when a partner leaves, the other goes on alone with full-plan indexes', () => {
    const { a, b, timeline } = pairAtHome();
    const firstFour = timeline.steps.filter((s) => s.kind === 'set').slice(0, 4);
    const done = (who: 'a' | 'b') => new Set(firstFour.filter((s) => s.participant === who).map((s) => setKey(s.exerciseIndex!, s.setIndex!)));
    const rest = remainingTimeline({ plan: a.plan, done: done('a'), active: true }, { plan: b.plan, done: done('b'), active: true }, home);
    const next = rest.steps.find((s) => s.kind === 'set')!;
    const expectedNext = timeline.steps.filter((s) => s.kind === 'set')[4]!;
    expect([next.participant, next.exerciseIndex, next.setIndex]).toEqual([expectedNext.participant, expectedNext.exerciseIndex, expectedNext.setIndex]);
    expect(rest.blocks[0]!.kind).not.toBe('warm_up');
    // B leaves (a stop or a safety stop): A's remaining sets stay, B has none.
    const alone = remainingTimeline({ plan: a.plan, done: done('a'), active: true }, { plan: b.plan, done: done('b'), active: false }, home);
    expect(stepsOf(alone, 'b')).toEqual([]);
    expect(stepsOf(alone, 'a').length).toBe(stepsOf(timeline, 'a').length - done('a').size);
    expect(alone.reasonCodes).toContain('pair.timeline.partner_ended');
    expect(alone.blocks.every((k) => k.b === null)).toBe(true);
    expectRestWindows(alone);
  });

  it('property: for random pairs of plans, every block keeps one pattern, every set appears once for its partner, rest windows hold', () => {
    const patterns = ['squat', 'horizontal_push', 'horizontal_pull', 'hinge', 'vertical_push', 'core'] as const;
    const exFor: Record<(typeof patterns)[number], string> = { squat: 'air_squat', horizontal_push: 'push_up', horizontal_pull: 'seated_band_row', hinge: 'glute_bridge', vertical_push: 'pike_push_up', core: 'dead_bug' };
    const { a } = pairAtHome();
    const template = a.plan.exercises[0]!;
    const planArb = fc.array(
      fc.record({
        pattern: fc.constantFrom(...patterns),
        sets: fc.array(fc.record({ reps: fc.integer({ min: 1, max: 15 }), rest: fc.integer({ min: 0, max: 240 }), hold: fc.boolean(), load: fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }) }), { minLength: 1, maxLength: 5 }),
      }),
      { minLength: 0, maxLength: 7 },
    );
    type Spec = { pattern: (typeof patterns)[number]; sets: { reps: number; rest: number; hold: boolean; load: number | null }[] }[];
    const toPlan = (spec: Spec, id: string): SessionPlan => ({
      ...a.plan,
      planId: id,
      exercises: spec.map((e) => ({
        ...template,
        slot: e.pattern,
        exerciseId: exFor[e.pattern],
        sets: e.sets.map((s, i) => ({ ...template.sets[0]!, index: i + 1, target: s.hold ? { kind: 'hold' as const, seconds: s.reps * 3 } : { kind: 'reps' as const, min: s.reps, max: s.reps + 2 }, restSeconds: s.rest, loadKg: s.load })),
      })),
    });
    fc.assert(
      fc.property(planArb, planArb, fc.integer({ min: 0, max: 30 }), (sa, sb, warm) => {
        const pa = { ...toPlan(sa, '00000000-0000-4000-8000-00000000000a'), warmUp: { ...a.plan.warmUp, minutes: warm / 3 } };
        const pb = toPlan(sb, '00000000-0000-4000-8000-00000000000b');
        const items: EquipmentId[] = [...HOME, 'box', 'exercise_mat'];
        const timeline = mergePlans(pa, pb, { items, graph: SESSION_LIBRARY.graph });
        for (const block of timeline.blocks) {
          if (block.kind === 'shared') {
            expect(pa.exercises[block.a!]!.slot).toBe(block.pattern);
            expect(pb.exercises[block.b!]!.slot).toBe(block.pattern);
          }
        }
        // As many shared blocks as the longest common pattern subsequence allows (never fewer).
        const lcs = (x: string[], y: string[]): number => {
          const d = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
          for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i]![j] = x[i - 1] === y[j - 1] ? d[i - 1]![j - 1]! + 1 : Math.max(d[i - 1]![j]!, d[i]![j - 1]!);
          return d[x.length]![y.length]!;
        };
        expect(timeline.blocks.filter((k) => k.kind === 'shared').length).toBe(lcs(sa.map((e) => e.pattern), sb.map((e) => e.pattern)));
        expectEveryPlanSetOnce(timeline, pa, 'a');
        expectEveryPlanSetOnce(timeline, pb, 'b');
        expectRestWindows(timeline);
        // One person at a time (turns): set steps never overlap.
        const sets = timeline.steps.filter((s) => s.kind === 'set');
        for (let i = 1; i < sets.length; i++) expect(sets[i]!.startSecond).toBeGreaterThanOrEqual(sets[i - 1]!.startSecond + sets[i - 1]!.durationSeconds);
        const last = timeline.steps.at(-1);
        expect(timeline.totalSeconds).toBe(last ? last.startSecond + last.durationSeconds : 0);
      }),
      { numRuns: 400 },
    );
  });
});

describe('safety (goal condition 3): each partner’s SafetyProfile and red joints apply independently in the shared timeline', () => {
  it('P1 with a red knee and an unresolved screening flag; P2 cleared: only P1’s plan is capped and substituted', () => {
    const flagged = profileFrom(['heart_or_blood_pressure']);
    const redKnee: JointFlags = { knee: 'red' };
    const { a, b, timeline } = pairAtHome(p1({ safetyProfile: flagged, jointFlags: redKnee }), p2());
    // S1 for P1 only: RPE ≤ 7 → at least 3 reps in reserve on every set.
    expect(screeningGateCheck({ profile: flagged, request: { rpe: 8, hiit: false, maximalTest: false } })?.invariant).toBe('S1');
    for (const e of a.plan.exercises) for (const s of e.sets) expect(s.targetRir).toBeGreaterThanOrEqual(3);
    // S2 for P1 only: no exercise loads the red knee at medium or high.
    for (const e of a.plan.exercises) expect(redJointsLoaded(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, redKnee)).toEqual([]);
    // P2 is not capped by P1's profile: her plan is what she gets alone (reserve 2, knee exercises allowed).
    const bAlone = generateSession({ ...p2() }, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: partnerSeed(11, 'b') }));
    expect(bAlone).toEqual({ status: 'ok', plan: b.plan, safetyEvents: b.safetyEvents });
    expect(b.plan.targetRir).toBe(2);
    expect(b.plan.exercises.some((e) => redJointsLoaded(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, { knee: 'red' }).length > 0)).toBe(true);
    // The safety events stay with their own person.
    expect(a.safetyEvents.map((e) => e.invariant)).toEqual(expect.arrayContaining(['S1', 'S2']));
    expect(b.safetyEvents).toEqual([]);
    // The timeline carries each person's own sets, never the other's.
    expectEveryPlanSetOnce(timeline, a.plan, 'a');
    expectEveryPlanSetOnce(timeline, b.plan, 'b');
  });

  it('S3, S7 and "not screened" for one partner: no pair session, and each reason stays with its own person', () => {
    const locked = generatePairSession(p1(), p2({ intensityLock: { locked: true, since: '2026-09-27T08:00:00.000Z' } }), { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, ctx());
    expect(locked.status).toBe('unavailable');
    expect(locked.a.status).toBe('ok');
    expect(locked.b).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s3_intensity_locked'] });
    const minor = generatePairSession(p1({ birthDate: { year: 2011, month: 1, day: 1 } }), p2(), { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, ctx());
    expect(minor.status).toBe('unavailable');
    expect(minor.a).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s7_age'] });
    expect(minor.b.status).toBe('ok');
    const unscreened = { ...profileFrom(), screeningOutcome: 'not_screened' as const };
    expect(generatePairSession(p1(), p2({ safetyProfile: unscreened }), { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, ctx()).b).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.not_screened'] });
  });

  it('the shared place is each partner’s Anywhere Switcher: everything else in each input stays their own', () => {
    // P2 planned at the gym; training at P1's home today: her plan uses only home equipment, and her own profile.
    const gymP2 = p2({ equipment: GYM, equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, programSession: programContext() });
    const { b, timeline } = pairAtHome(p1(), gymP2);
    for (const e of b.plan.exercises) expect(hasEquipment(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, new Set(HOME))).toBe(true);
    expect(b.plan.equipmentProfileId).toBe(HOME_ID);
    expect(timeline.planB).toBe(b.plan.planId);
  });

  it('property: over random profiles and joint flags for each partner, each plan equals that partner’s solo plan and keeps only their own caps', () => {
    const flagsArb = fc.dictionary(fc.constantFrom(...JOINTS), fc.constantFrom('green', 'amber', 'red'), { maxKeys: 3 }) as fc.Arbitrary<JointFlags>;
    const yesArb = fc.subarray([...SCREENING_QUESTION_IDS].filter((q) => q !== 'pregnancy_or_recent_birth'), { maxLength: 2 });
    fc.assert(
      fc.property(flagsArb, flagsArb, yesArb, yesArb, fc.integer({ min: 1, max: 1_000_000 }), (fa, fb, ya, yb, seed) => {
        const ia = p1({ safetyProfile: profileFrom(ya), jointFlags: fa });
        const ib = p2({ safetyProfile: profileFrom(yb), jointFlags: fb });
        const r = generatePairSession(ia, ib, { equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID }, SESSION_LIBRARY, ctx(seed));
        for (const [who, input, res] of [['a', ia, r.a], ['b', ib, r.b]] as const) {
          const solo = generateSession(input, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: partnerSeed(seed, who) }));
          expect(res.status).toBe(solo.status);
          if (res.status !== 'ok' || solo.status !== 'ok') continue;
          expect(res.plan).toEqual(solo.plan);
          for (const e of res.plan.exercises) {
            expect(redJointsLoaded(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, input.jointFlags ?? {})).toEqual([]);
            for (const s of e.sets) expect(screeningGateCheck({ profile: input.safetyProfile, request: { rpe: 10 - s.targetRir, hiit: false, maximalTest: false } })).toBeNull();
          }
        }
        if (r.status === 'ok') {
          expectEveryPlanSetOnce(r.timeline, r.a.plan, 'a');
          expectEveryPlanSetOnce(r.timeline, r.b.plan, 'b');
          expectRestWindows(r.timeline);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('pair reason codes', () => {
  it('slot helper still builds program slots for the fixtures (sanity)', () => {
    expect(slot('squat', 'primary', 'general', 2)).toEqual({ pattern: 'squat', role: 'primary', intent: 'general', hardSets: 2 });
  });
});
