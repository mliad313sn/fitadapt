import { SCREENING_QUESTION_IDS, SafetyProfileSchema, SessionPlanSchema, type AssessmentResult, type CapacityModel } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SAFE_FACTS, FIXTURE_LIBRARY, FULL_GYM, P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { buildCapacityModel, loadForReps, roundDownToIncrement } from '../assessment/index.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { hasEquipment } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { S5_MAX_INCREASE_FRACTION, firstSessionRir, generateSession, type GenerateSessionInput } from './first-session.js';
import { s5Violations } from './history.js';

const NOW = Date.parse('2026-09-24T08:00:00.000Z');
const ctx = () => createEngineContext({ clock: fixedClock(NOW), seed: 7 });
const cleared = profileFrom();
const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number; loadKg?: number; rir?: number }) => ({ status: 'done' as const, testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: m.loadKg ?? null, rir: m.rir ?? null });

const gymResult: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-23T17:00:00.000Z',
  completedAt: '2026-09-23T17:30:00.000Z',
  tests: [
    done('squat_load', 'barbell_back_squat', { loadKg: 140, reps: 8, rir: 2 }),
    done('press_load', 'barbell_bench_press', { loadKg: 100, reps: 8, rir: 2 }),
    done('pulldown_load', 'lat_pulldown', { loadKg: 70, reps: 10, rir: 2 }),
    done('row_load', 'barbell_row', { loadKg: 80, reps: 8, rir: 2 }),
    done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 110, reps: 8, rir: 2 }),
    done('plank_hold', 'front_plank', { seconds: 45 }),
  ],
};
const homeResult: AssessmentResult = {
  protocolId: 'home',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-23T17:00:00.000Z',
  completedAt: '2026-09-23T17:14:00.000Z',
  tests: [
    done('push_reps', 'knee_push_up', { reps: 4 }),
    done('dead_hang_hold', 'dead_hang', { seconds: 12 }),
    done('row_reps', 'pull_up', { reps: 0 }),
    done('squat_reps', 'air_squat', { reps: 15 }),
    done('plank_hold', 'knee_plank', { seconds: 25 }),
  ],
};
const gymCapacity = buildCapacityModel(gymResult, FIXTURE_LIBRARY);
const homeCapacity = buildCapacityModel(homeResult, FIXTURE_LIBRARY);
const input = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({ ...SAFE_FACTS, capacity: gymCapacity, safetyProfile: cleared, equipment: FULL_GYM, minutesAvailable: 75, ...over });
const ok = (over: Partial<GenerateSessionInput> = {}) => {
  const r = generateSession(input(over), FIXTURE_LIBRARY, ctx());
  if (r.status !== 'ok') throw new Error(`expected a plan: ${r.reasonCodes.join()}`);
  return r;
};

describe('generateSession uses the CapacityModel for the first session', () => {
  it('gym: the assessed exercises, with loads from the e1RM at the first-session reserve', () => {
    const { plan, safetyEvents } = ok();
    expect(SessionPlanSchema.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({ kind: 'first_session', engineVersion: ENGINE_VERSION, generatedAt: '2026-09-24T08:00:00.000Z', seed: 7, capacityAssessedAt: gymCapacity.assessedAt, targetRir: 3 });
    expect(plan.exercises.map((e) => e.exerciseId)).toEqual(['barbell_back_squat', 'barbell_bench_press', 'lat_pulldown', 'barbell_row', 'barbell_romanian_deadlift', 'front_plank']);
    const squat = plan.exercises[0]!;
    const e1rm = gymCapacity.slots.find((s) => s.slot === 'squat')!.e1rmKg!;
    expect(squat.sets[0]!.loadKg).toBe(roundDownToIncrement(loadForReps(e1rm, 10, 3) * 0.9));
    expect(squat.sets[0]!.loadKg).toBe(115);
    expect(squat.sets[0]!.reasonCodes).toEqual(['session.exercise.from_assessment', 'session.load.from_e1rm', 'session.rir.first_session']);
    expect(plan.exercises.at(-1)!.sets[0]).toMatchObject({ loadKg: null, target: { kind: 'hold', seconds: 27 } });
    expect(safetyEvents).toEqual([]);
    expect(plan.estimatedMinutes).toBeLessThanOrEqual(75);
  });

  it('home: the assessed rungs as bodyweight variants; a slot without equipment steps down its ladder', () => {
    const { plan } = ok({ capacity: homeCapacity, equipment: P1_HOME, minutesAvailable: 40 });
    expect(Object.fromEntries(plan.exercises.map((e) => [e.slot, e.exerciseId]))).toEqual({
      squat: 'air_squat',
      horizontal_push: 'incline_push_up_high',
      vertical_pull: 'dead_hang',
      horizontal_pull: 'seated_band_row',
      hinge: 'hip_hinge_drill',
      core: 'knee_plank',
    });
    const push = plan.exercises.find((e) => e.slot === 'horizontal_push')!;
    expect(push.sets[0]!.reasonCodes[0]).toBe('session.exercise.stepped_down');
    expect(push.sets[0]!.reasonCodes).toContain('session.load.bodyweight_variant');
    expect(plan.exercises.every((e) => e.sets.every((s) => s.loadKg === null))).toBe(true);
  });

  it('S1: an unresolved flag raises the reserve to RIR 3 or more (RPE ≤ 7) — and the plan says why', () => {
    expect(firstSessionRir(profileFrom(['heart_or_blood_pressure']))).toBe(3);
    const lowCap = SafetyProfileSchema.parse({ ...cleared, maxRPE: 6 });
    const { plan } = ok({ safetyProfile: lowCap });
    expect(plan.targetRir).toBe(4);
    expect(plan.exercises[0]!.sets[0]!.reasonCodes).toContain('session.rir.s1_capped');
  });

  it('substitutes through the graph when the ladder offers nothing allowed, and records S2 when a red joint forced it', () => {
    const noRack = FULL_GYM.filter((e) => e !== 'barbell' && e !== 'leg_press' && e !== 'box');
    const capacity: CapacityModel = { ...gymCapacity, slots: [{ ...gymCapacity.slots[0]!, stepIndex: 0, exerciseId: 'barbell_back_squat', ladderId: 'missing_ladder' }] };
    const { plan } = ok({ capacity, equipment: noRack });
    expect(plan.exercises[0]).toMatchObject({ exerciseId: 'goblet_squat' });
    expect(plan.exercises[0]!.sets[0]!.reasonCodes).toEqual(['session.exercise.substituted', 'session.load.self_select_light', 'session.rir.first_session']);
    const red = ok({ capacity, equipment: FULL_GYM, jointFlags: { knee: 'red' } });
    expect(red.plan.exercises[0]!.exerciseId).toBe('goblet_squat');
    expect(red.safetyEvents).toEqual([{ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted', engineVersion: ENGINE_VERSION }]);
    // Nothing valid (no hand weight, every other squat loads the red knee): the slot is dropped, never prescribed.
    const noWeights = FULL_GYM.filter((e) => e !== 'dumbbell' && e !== 'kettlebell');
    const dropped = generateSession(input({ capacity, equipment: noWeights, jointFlags: { knee: 'red' } }), FIXTURE_LIBRARY, ctx());
    expect(dropped).toEqual({ status: 'unavailable', reasonCodes: ['session.first.from_assessment', 'session.slot_dropped.squat', 'session.unavailable.no_exercise'] });
  });

  it('S5: a load never rises more than 10 % over a load prescribed in the last 7 days', () => {
    const recent = [{ exerciseId: 'barbell_back_squat', loadKg: 100, prescribedAt: '2026-09-20T08:00:00.000Z' }];
    const { plan, safetyEvents } = ok({ recentLoads: recent });
    expect(plan.exercises[0]!.sets[0]!.loadKg).toBe(110);
    expect(plan.exercises[0]!.sets[0]!.reasonCodes).toContain('session.load.s5_capped');
    expect(safetyEvents).toEqual([{ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling', action: 'capped', engineVersion: ENGINE_VERSION }]);
    // Older than 7 days: not in the window.
    expect(ok({ recentLoads: [{ ...recent[0]!, prescribedAt: '2026-09-16T07:59:59.000Z' }] }).plan.exercises[0]!.sets[0]!.loadKg).toBe(115);
    // M02 (docs/status/M02.md, deviation "S5 and time travel"): a load dated after the engine clock (a device clock moved
    // back) now counts as inside the window, so it caps the load too (was 115 under M07, which ignored it).
    expect(ok({ recentLoads: [{ ...recent[0]!, prescribedAt: '2026-09-25T08:00:00.000Z' }] }).plan.exercises[0]!.sets[0]!.loadKg).toBe(110);
  });

  it('SAF-4: a load capped at the S5 ceiling on the legacy step is at or below the ceiling (true round-down)', () => {
    // 45.45 kg × 1.1 = 49.995 kg: rounding to hundredths first gave 50 kg (above the ceiling, refused by the server).
    const recentLoads = [{ exerciseId: 'barbell_back_squat', loadKg: 45.45, prescribedAt: '2026-09-22T08:00:00.000Z' }];
    const { plan } = ok({ recentLoads, loadIncrementKg: 0.5 });
    expect(plan.exercises[0]!.sets[0]!.loadKg).toBe(49.5);
    expect(plan.exercises[0]!.sets[0]!.reasonCodes).toContain('session.load.s5_capped');
    expect(s5Violations(plan, [], recentLoads)).toEqual([]);
  });

  it('SAF-4 property: every legacy-step load is at or below the S5 ceiling, also for references just under a step boundary', () => {
    fc.assert(
      fc.property(fc.constantFrom(0.5, 1, 1.25, 2, 2.5), fc.integer({ min: 10, max: 200 }), fc.double({ min: -0.004, max: 0.004, noNaN: true }), (step, k, jitter) => {
        const ref = Math.max(0.01, (k * step) / 1.1 + jitter);
        const recentLoads = [{ exerciseId: 'barbell_back_squat', loadKg: ref, prescribedAt: '2026-09-22T08:00:00.000Z' }];
        const r = generateSession(input({ recentLoads, loadIncrementKg: step }), FIXTURE_LIBRARY, ctx());
        if (r.status !== 'ok') return;
        expect(s5Violations(r.plan, [], recentLoads)).toEqual([]);
        for (const e of r.plan.exercises) for (const set of e.sets) if (e.exerciseId === 'barbell_back_squat' && set.loadKg !== null) expect(set.loadKg).toBeLessThanOrEqual(ref * 1.1 + 1e-9);
      }),
      { numRuns: 500 },
    );
  });

  it('uses the tested load when there was no e1RM, and the equipment step given', () => {
    const noE1rm: CapacityModel = { ...gymCapacity, slots: gymCapacity.slots.map((s) => (s.slot === 'squat' ? { ...s, e1rmKg: null, loadKg: 90 } : s)) };
    const { plan } = ok({ capacity: noE1rm, loadIncrementKg: 1 });
    expect(plan.exercises[0]!.sets[0]).toMatchObject({ loadKg: 90 });
    expect(plan.exercises[0]!.sets[0]!.reasonCodes).toContain('session.load.from_test_load');
    expect(plan.exercises[1]!.sets[0]!.loadKg! % 1).toBe(0);
  });

  it('fits the minutes available: one set per exercise first, then fewer exercises', () => {
    const full = ok().plan;
    const short = ok({ minutesAvailable: 20 }).plan;
    expect(short.estimatedMinutes).toBeLessThanOrEqual(20);
    expect(short.reasonCodes).toContain('session.time.trimmed');
    expect(short.exercises.every((e) => e.sets.length === 1)).toBe(true);
    const tiny = ok({ minutesAvailable: 12 }).plan;
    expect(tiny.exercises.length).toBeLessThan(full.exercises.length);
    expect(generateSession(input({ minutesAvailable: 5 }), FIXTURE_LIBRARY, ctx())).toMatchObject({ status: 'unavailable', reasonCodes: expect.arrayContaining(['session.unavailable.no_exercise']) });
  });

  it('no plan for blocked, not screened, professional guidance or an impossible effort cap', () => {
    const run = (p: typeof cleared) => generateSession(input({ safetyProfile: p }), FIXTURE_LIBRARY, ctx());
    expect(run(profileFrom([], { birthYear: 2015 }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.blocked'] });
    expect(run(SafetyProfileSchema.parse({ ...cleared, screeningOutcome: 'not_screened' }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.not_screened'] });
    expect(run(profileFrom(['pregnancy_or_recent_birth']))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.professional_guidance'] });
    expect(run(SafetyProfileSchema.parse({ ...cleared, maxRPE: 4 }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.effort_cap'] });
  });

  it('is deterministic: same input, clock and seed give the same plan (and a valid v4 plan id)', () => {
    const a = ok().plan;
    expect(ok().plan).toEqual(a);
    expect(a.planId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const other = generateSession(input(), FIXTURE_LIBRARY, createEngineContext({ clock: fixedClock(NOW), seed: 8 }));
    expect(other.status === 'ok' && other.plan.planId).not.toBe(a.planId);
  });

  it('property: never above the S1 RPE cap, never missing equipment, never over the minutes, every set explained', () => {
    const exercises = FIXTURE_LIBRARY.graph.exercises;
    fc.assert(
      fc.property(
        fc.subarray([...SCREENING_QUESTION_IDS]),
        fc.boolean(),
        fc.subarray(FULL_GYM),
        fc.integer({ min: 5, max: 120 }),
        fc.constantFrom(gymCapacity, homeCapacity),
        (yes, clearance, equipment, minutes, capacity) => {
          const profile = profileFrom(yes, { clearanceAttested: clearance });
          const r = generateSession({ ...SAFE_FACTS, capacity, safetyProfile: profile, equipment, minutesAvailable: minutes }, FIXTURE_LIBRARY, ctx());
          if (r.status !== 'ok') return;
          const cap = profile.unresolvedFlags.length > 0 ? Math.min(profile.maxRPE, 7) : profile.maxRPE;
          expect(10 - r.plan.targetRir).toBeLessThanOrEqual(cap);
          expect(r.plan.estimatedMinutes).toBeLessThanOrEqual(minutes);
          for (const e of r.plan.exercises) {
            expect(hasEquipment(exercises.get(e.exerciseId)!, new Set(equipment))).toBe(true);
            for (const s of e.sets) expect(s.reasonCodes.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 1000 },
    );
    expect(S5_MAX_INCREASE_FRACTION).toBe(0.1);
  });
});
