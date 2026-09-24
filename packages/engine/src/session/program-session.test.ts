import { SafetyProfileSchema, SessionPlanSchema, type SessionPlan } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { FULL_GYM, P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { GYM_ID, GYM_LOADS, HOME_ID, HOME_LOADS, SESSION_LIBRARY, programContext, slot } from '../__fixtures__/session.js';
import { Diary, atTop, belowRange } from '../__fixtures__/simulate.js';
import { trainedHistory } from '../__fixtures__/cardio.js';
import { fixedClock } from '../clock.js';
import { SESSION_RULES_VERSION } from '../config/session.js';
import { createEngineContext } from '../context.js';
import { hasEquipment, redJointsLoaded } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { generateSession } from './generate.js';
import { planSeconds } from './timebox.js';
import type { GenerateSessionInput } from './types.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const DAY = 86_400_000;
const GYM = [...FULL_GYM, 'cable_station'] as const;
const ctxAt = (ms: number, seed = 5) => createEngineContext({ clock: fixedClock(ms), seed });
const gymInput = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: GYM,
  equipmentLoads: GYM_LOADS,
  equipmentProfileId: GYM_ID,
  minutesAvailable: 60,
  programSession: programContext(),
  experience: 'intermediate',
  ...over,
});
/** A distinct seed per generation time (as the app does), so plan ids differ between sessions. */
const plan = (input: GenerateSessionInput, at = MON, seed = Math.floor(at / 1000) % 2_147_483_647): SessionPlan => {
  const r = generateSession(input, SESSION_LIBRARY, ctxAt(at, seed));
  if (r.status !== 'ok') throw new Error(`expected a plan: ${r.reasonCodes.join(', ')}`);
  return r.plan;
};
const byExercise = (p: SessionPlan, id: string) => p.exercises.find((e) => e.exerciseId === id);

describe('program session from the M08 session of the day (ADR-015 API)', () => {
  it('fills every slot with an allowed exercise of its pattern, exactly the program hard sets, each set explained, stamped with engine and rules versions', () => {
    const input = gymInput();
    const p = plan(input, MON, 5);
    expect(SessionPlanSchema.parse(p)).toEqual(p);
    expect(p).toMatchObject({ kind: 'program_session', engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION, generatedAt: '2026-09-28T08:00:00.000Z', seed: 5, equipmentProfileId: GYM_ID, targetRir: 2, program: { sessionId: 'w01.s1', microcycleKind: 'accumulation', mesocycleIntent: 'hypertrophy' } });
    expect(p.exercises.map((e) => [e.slot, e.role, e.sets.length])).toEqual(input.programSession!.session.slots.map((s) => [s.pattern, s.role, s.hardSets]));
    for (const e of p.exercises) {
      const ex = SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!;
      expect(ex.pattern).toBe(e.slot);
      expect(hasEquipment(ex, new Set(GYM))).toBe(true);
      for (const s of e.sets) expect(s.reasonCodes.length).toBeGreaterThan(0);
    }
    expect(p.reasonCodes).toContain('session.program.from_program');
    expect(planSeconds(p)).toBeLessThanOrEqual(60 * 60);
    // Rep ranges by intent: hypertrophy primaries 6–10, others 8–15.
    expect(p.exercises[0]!.sets[0]!.target).toEqual({ kind: 'reps', min: 6, max: 10 });
    expect(p.exercises.find((e) => e.role === 'secondary')!.sets[0]!.target).toEqual({ kind: 'reps', min: 8, max: 15 });
    expect(p.exercises[0]!.sets[0]!.reasonCodes).toContain('session.rep_range.hypertrophy_primary');
  });

  it('the reserve follows the session target RPE (RPE 8 → RIR 2, 7 → 3, deload 6 → 4) and a strength block uses 4–6 reps', () => {
    expect(plan(gymInput({ programSession: programContext({ targetRpe: 7 }) })).targetRir).toBe(3);
    const deload = plan(gymInput({ programSession: programContext({ targetRpe: 6, kind: 'deload' }) }));
    expect(deload.targetRir).toBe(4);
    expect(deload.reasonCodes).toContain('session.program.deload_week');
    expect(deload.exercises[0]!.sets[0]!.reasonCodes).toContain('session.rir.deload');
    const strength = plan(gymInput({ programSession: programContext({ intent: 'strength' }) }));
    expect(strength.exercises[0]!.sets[0]).toMatchObject({ target: { kind: 'reps', min: 4, max: 6 }, restSeconds: 120 });
    expect(plan(gymInput({ programSession: programContext({ kind: 'transition', targetRpe: 6.5 }) })).reasonCodes).toContain('session.program.transition_week');
  });

  it('S1 overrides the program: an unresolved flag stops every set at RIR ≥ 3 (RPE ≤ 7), a tampered cap is still applied, and intervals become steady', () => {
    const flagged = profileFrom(['chest_discomfort']);
    const r = generateSession(gymInput({ safetyProfile: flagged, programSession: programContext({ conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } }) }), SESSION_LIBRARY, ctxAt(MON));
    if (r.status !== 'ok') throw new Error('expected a plan');
    expect(r.plan.targetRir).toBe(3);
    expect(r.plan.exercises.every((e) => e.sets.every((s) => s.targetRir >= 3 && s.reasonCodes.includes('session.rir.s1_capped')))).toBe(true);
    expect(r.plan.conditioning).toMatchObject({ kind: 'steady' });
    expect(r.plan.reasonCodes).toEqual(expect.arrayContaining(['session.rir.s1_capped', 'session.conditioning.intervals_not_allowed']));
    expect(r.safetyEvents).toEqual([
      { invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION },
      { invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed', action: 'capped', engineVersion: ENGINE_VERSION },
    ]);
    const tampered = SafetyProfileSchema.parse({ ...profileFrom(), maxRPE: 6 });
    expect(plan(gymInput({ safetyProfile: tampered })).targetRir).toBe(4);
    const impossible = SafetyProfileSchema.parse({ ...profileFrom(), maxRPE: 4.5 });
    expect(generateSession(gymInput({ safetyProfile: impossible }), SESSION_LIBRARY, ctxAt(MON))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.effort_cap'] });
    // Cleared (and, since M03, with ≥ 2 weeks of consistent logged training): intervals stay intervals.
    expect(plan(gymInput({ history: trainedHistory(MON), programSession: programContext({ conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } }) })).conditioning).toMatchObject({ kind: 'intervals' });
    // M03: cleared but without two weeks of logged training, the intervals become steady and the plan says why.
    const untrained = plan(gymInput({ programSession: programContext({ conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } }) }));
    expect(untrained.conditioning).toMatchObject({ kind: 'steady' });
    expect(untrained.reasonCodes).toContain('cardio.hiit.needs_consistent_training');
  });

  it('S2: a red joint substitutes every exercise that loads it at medium or high level, and the plan says why', () => {
    const r = generateSession(gymInput({ jointFlags: { knee: 'red' } }), SESSION_LIBRARY, ctxAt(MON));
    if (r.status !== 'ok') throw new Error('expected a plan');
    for (const e of r.plan.exercises) expect(redJointsLoaded(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, { knee: 'red' })).toEqual([]);
    const squat = r.plan.exercises.find((e) => e.slot === 'squat')!;
    expect(squat.exerciseId).toBe('goblet_squat');
    expect(squat.reasonCodes[0]).toBe('session.exercise.s2_substituted.knee');
    expect(r.safetyEvents).toContainEqual({ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted', engineVersion: ENGINE_VERSION });
  });

  it('S7 and S3 gates: under 16 on the engine clock, or intensity locked after a red flag → no session; no program and no assessment → none either', () => {
    expect(generateSession(gymInput({ birthDate: { year: 2011, month: 1, day: 1 } }), SESSION_LIBRARY, ctxAt(MON))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s7_age'] });
    expect(generateSession(gymInput({ birthDate: { year: 2010, month: 9, day: 28 } }), SESSION_LIBRARY, ctxAt(MON)).status).toBe('ok');
    expect(generateSession(gymInput({ birthDate: { year: 2010, month: 9, day: 29 } }), SESSION_LIBRARY, ctxAt(MON)).status).toBe('unavailable');
    expect(generateSession(gymInput({ intensityLock: { locked: true, since: '2026-09-27T10:00:00.000Z' } }), SESSION_LIBRARY, ctxAt(MON))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s3_intensity_locked'] });
    expect(generateSession(gymInput({ intensityLock: { locked: false, since: null } }), SESSION_LIBRARY, ctxAt(MON)).status).toBe('ok');
    expect(generateSession(gymInput({ programSession: null }), SESSION_LIBRARY, ctxAt(MON))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.no_program'] });
    expect(generateSession(gymInput({ safetyProfile: profileFrom(['pregnancy_or_recent_birth']) }), SESSION_LIBRARY, ctxAt(MON))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.professional_guidance'] });
  });

  it('is deterministic and zod-typed: same input, clock and seed → same plan; malformed input is refused', () => {
    expect(plan(gymInput())).toEqual(plan(gymInput()));
    expect(plan(gymInput(), MON, 6).planId).not.toBe(plan(gymInput(), MON, 5).planId);
    expect(() => generateSession({ ...gymInput(), minutesAvailable: -1 }, SESSION_LIBRARY, ctxAt(MON))).toThrow();
    expect(() => generateSession({ ...gymInput(), equipment: ['teleporter' as never] }, SESSION_LIBRARY, ctxAt(MON))).toThrow();
  });
});

describe('double progression across sessions (history → next load)', () => {
  it('reaching the top of the range at the target reserve adds the smallest step; the next session explains it', () => {
    const diary = new Diary();
    const capInput = gymInput({ capacity: null });
    // Session 1: loads unknown → the user chooses (logs 40 kg on every loaded exercise).
    const first = plan(capInput);
    expect(first.exercises[0]!.sets[0]).toMatchObject({ loadKg: null });
    expect(first.exercises[0]!.sets[0]!.reasonCodes).toContain('session.load.self_select_light');
    diary.add(capInput, first, atTop(40));
    // Session 2 (8 days later): the load the user used, +1 barbell step (bench, upper body: 40 × 1.025 = 41 → 42.5).
    const secondInput = gymInput({ history: diary.history() });
    const second = plan(secondInput, MON + 8 * DAY);
    const bench = byExercise(second, 'barbell_bench_press')!;
    expect(bench.sets[0]!.loadKg).toBe(42.5);
    expect(bench.sets[0]!.reasonCodes).toEqual(expect.arrayContaining(['session.exercise.continued', 'session.progression.load_increased']));
    expect(bench.sets[0]!.reasonParams).toMatchObject({ deltaKg: 2.5, sets: 3, reps: 10, rir: 2 });
    // Squat (lower body): 40 × 1.05 = 42 → 42.5.
    expect(byExercise(second, 'barbell_back_squat')!.sets[0]!.loadKg).toBe(42.5);
    // Two sessions below the range → −10 % next time.
    diary.add(secondInput, second, belowRange, new Date(MON + 8 * DAY).toISOString());
    const third = plan(gymInput({ history: diary.history() }), MON + 10 * DAY);
    diary.add(gymInput({ history: diary.history() }), third, belowRange, new Date(MON + 10 * DAY).toISOString());
    const fourth = plan(gymInput({ history: diary.history() }), MON + 12 * DAY);
    const benchAfter = byExercise(fourth, 'barbell_bench_press')!;
    expect(benchAfter.sets[0]!.loadKg).toBe(37.5);
    expect(benchAfter.sets[0]!.reasonCodes).toContain('session.progression.load_reduced');
  });

  it('S5 caps the load whatever the history claims (a huge logged e1RM, a clock moved back)', () => {
    const diary = new Diary();
    const input = gymInput({ programSession: programContext({ intent: 'strength' }) });
    const first = plan(input);
    diary.add(input, first, atTop(100));
    // The user then logs a very heavy set two days later (e1RM jump) and asks for a new block (range change → e1RM rebase).
    diary.setLogs.push({ id: '99999999-9999-4999-8999-999999999999', data: { schemaVersion: 1, planId: first.planId, exerciseIndex: 0, exerciseId: first.exercises[0]!.exerciseId, set: { index: 1, status: 'done', reps: 12, seconds: null, loadKg: 200, rir: 3 }, loggedAt: new Date(MON + DAY).toISOString(), correctionOf: diary.setLogs[0]!.id } });
    const next = plan(gymInput({ history: diary.history(), programSession: programContext({ intent: 'hypertrophy' }) }), MON + 2 * DAY);
    for (const e of next.exercises) for (const s of e.sets) if (s.loadKg !== null) expect(s.loadKg).toBeLessThanOrEqual(110 + 1e-9);
    // Clock moved back 3 days: the session from "the future" still counts.
    const back = plan(gymInput({ history: diary.history() }), MON - 3 * DAY);
    for (const e of back.exercises) for (const s of e.sets) if (s.loadKg !== null) expect(s.loadKg).toBeLessThanOrEqual(110 + 1e-9);
  });

  it('bodyweight ladder: two sessions at the top → next variant at its bottom; two below → one variant down', () => {
    const home = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
      safetyProfile: profileFrom(),
      equipment: ['sturdy_chair'],
      equipmentLoads: HOME_LOADS,
      equipmentProfileId: HOME_ID,
      minutesAvailable: 40,
      experience: 'beginner',
      programSession: programContext({ intent: 'general', equipmentProfileId: HOME_ID, location: 'home', slots: [slot('horizontal_push', 'primary', 'general', 3), slot('core', 'accessory', 'general', 2)] }),
      ...over,
    });
    const diary = new Diary();
    const start = plan(home());
    const pushId = start.exercises[0]!.exerciseId;
    expect(pushId).toBe('wall_push_up');
    diary.add(home(), start, atTop());
    const second = plan(home({ history: diary.history() }), MON + 2 * DAY);
    expect(second.exercises[0]).toMatchObject({ exerciseId: 'wall_push_up' });
    expect(second.exercises[0]!.sets[0]!.reasonCodes).toContain('session.progression.variant_held');
    diary.add(home({ history: diary.history() }), second, atTop(), new Date(MON + 2 * DAY).toISOString());
    const third = plan(home({ history: diary.history() }), MON + 4 * DAY);
    expect(third.exercises[0]).toMatchObject({ exerciseId: 'incline_push_up_high', ladderId: 'push' });
    expect(third.exercises[0]!.sets[0]!.reasonCodes).toEqual(expect.arrayContaining(['session.exercise.next_variant', 'session.progression.variant_up']));
    expect(third.exercises[0]!.sets[0]!.reasonParams).toMatchObject({ reps: 12, sessions: 2 });
    expect(third.exercises[0]!.sets[0]!.reasonCodes).toContain('session.load.bodyweight_share');
    expect(third.exercises[0]!.sets[0]!.reasonParams.percent).toBe(30);
    // Plank hold at the top twice → +5 s.
    expect(third.exercises[1]!.sets[0]!.target).toEqual({ kind: 'hold', seconds: 25 });
    // Two sessions below the range on the new variant → back down one variant.
    diary.add(home({ history: diary.history() }), third, belowRange, new Date(MON + 4 * DAY).toISOString());
    const fourth = plan(home({ history: diary.history() }), MON + 6 * DAY);
    diary.add(home({ history: diary.history() }), fourth, belowRange, new Date(MON + 6 * DAY).toISOString());
    const fifth = plan(home({ history: diary.history() }), MON + 8 * DAY);
    expect(fifth.exercises[0]).toMatchObject({ exerciseId: 'wall_push_up' });
    expect(fifth.exercises[0]!.sets[0]!.reasonCodes).toEqual(expect.arrayContaining(['session.exercise.easier_variant', 'session.progression.variant_down']));
  });

  it('a fixed dumbbell at the top of the range: the next variant of the ladder instead of a heavier weight', () => {
    const input = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
      safetyProfile: profileFrom(),
      equipment: P1_HOME,
      equipmentLoads: HOME_LOADS,
      minutesAvailable: 40,
      experience: 'beginner',
      programSession: programContext({ intent: 'general', slots: [slot('squat', 'primary', 'general', 3)] }),
      ...over,
    });
    const diary = new Diary();
    const first = plan(input());
    expect(first.exercises[0]!.exerciseId).toBe('goblet_squat');
    diary.add(input(), first, atTop(10));
    const next = plan(input({ history: diary.history() }), MON + 2 * DAY);
    expect(next.exercises[0]).toMatchObject({ exerciseId: 'split_squat' });
    expect(next.exercises[0]!.sets[0]!.reasonCodes).toEqual(expect.arrayContaining(['session.exercise.next_variant', 'session.progression.equipment_max']));
  });

  it('deload weeks hold the load; a slow eccentric appears only on negatives', () => {
    const diary = new Diary();
    const first = plan(gymInput());
    diary.add(gymInput(), first, atTop(40));
    const deload = plan(gymInput({ history: diary.history(), programSession: programContext({ kind: 'deload', targetRpe: 6 }) }), MON + 7 * DAY);
    expect(byExercise(deload, 'barbell_bench_press')!.sets[0]).toMatchObject({ loadKg: 40 });
    expect(byExercise(deload, 'barbell_bench_press')!.sets[0]!.reasonCodes).toContain('session.deload.no_progression');
    // Negatives: slow eccentric; nothing else gets a tempo.
    const pull = plan(gymInput({ equipment: ['pull_up_bar', 'box'], equipmentLoads: null, programSession: programContext({ slots: [slot('vertical_pull', 'primary', 'hypertrophy', 3), slot('squat', 'primary', 'hypertrophy', 2)] }), capacity: null }));
    const withTempo = pull.exercises.filter((e) => e.sets.some((s) => s.tempo !== null));
    for (const e of withTempo) {
      expect(SESSION_LIBRARY.tags!(e.exerciseId)).toContain('eccentric_focus');
      expect(e.sets[0]!.tempo).toEqual({ eccentricSeconds: 4 });
      expect(e.sets[0]!.reasonCodes).toContain('session.tempo.eccentric');
    }
    for (const p of [first, deload]) for (const e of p.exercises) expect(e.sets.every((s) => s.tempo === null)).toBe(true);
  });

  it('readiness reduced: one set fewer, one more rep in reserve, no accessories', () => {
    const p = plan(gymInput({ readiness: 'reduced' }));
    expect(p.targetRir).toBe(3);
    expect(p.exercises.every((e) => e.role !== 'accessory')).toBe(true);
    expect(p.exercises[0]!.sets.length).toBe(2);
    expect(p.reasonCodes).toEqual(expect.arrayContaining(['session.readiness.reduced', 'session.readiness.accessory_dropped']));
    expect(p.exercises[0]!.sets[0]!.reasonCodes).toContain('session.rir.readiness_reduced');
  });
});

describe('Anywhere Switcher: a new place maps each slot to the nearest-stimulus exercise there', () => {
  it('gym history, home today: every slot is filled from the home equipment, and the switch is explained', () => {
    const diary = new Diary();
    const gym = plan(gymInput());
    diary.add(gymInput(), gym, atTop(30));
    const home = plan(gymInput({ equipment: P1_HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID, history: diary.history() }), MON + 2 * DAY);
    expect(home.reasonCodes).toContain('session.switcher.place_changed');
    for (const e of home.exercises) expect(hasEquipment(SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!, new Set(P1_HOME))).toBe(true);
    // The row keeps its slot: barbell row → an easier step of the same movement the home allows.
    const row = home.exercises.find((e) => e.slot === 'horizontal_pull')!;
    expect(row.exerciseId).not.toBe('barbell_row');
    expect(row.reasonCodes[0]).toBe('session.exercise.stepped_down');
    // An exercise with no easier step here maps to the nearest stimulus (the switcher).
    const pull = programContext({ slots: [slot('vertical_pull', 'primary', 'hypertrophy', 3)] });
    const gymPull = plan(gymInput({ programSession: pull }));
    expect(gymPull.exercises[0]!.exerciseId).toBe('lat_pulldown');
    const pullDiary = new Diary();
    pullDiary.add(gymInput({ programSession: pull }), gymPull, atTop(40));
    const homePull = plan(gymInput({ equipment: P1_HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID, programSession: pull, history: pullDiary.history() }), MON + 2 * DAY);
    expect(homePull.exercises[0]!.reasonCodes[0]).toBe('session.switcher.mapped');
    expect(hasEquipment(SESSION_LIBRARY.graph.exercises.get(homePull.exercises[0]!.exerciseId)!, new Set(P1_HOME))).toBe(true);
  });

  it('when a place allows nothing for a slot, the slot is dropped and said so; never an exercise needing missing equipment', () => {
    const p = plan(gymInput({ equipment: [], equipmentLoads: null, programSession: programContext({ slots: [slot('vertical_pull', 'primary', 'general', 2), slot('squat', 'primary', 'general', 2)] }) }));
    expect(p.reasonCodes).toContain('session.slot_dropped.vertical_pull');
    expect(p.exercises.map((e) => e.slot)).toEqual(['squat']);
  });
});

describe('the first session still comes from the capacity model (M07 path of the same generator)', () => {
  it('program sessions start from the assessed rung and e1RM, rounded to the equipment, and say so', async () => {
    const { buildCapacityModel } = await import('../assessment/index.js');
    const { FIXTURE_LIBRARY } = await import('../__fixtures__/library.js');
    const capacity = buildCapacityModel(
      {
        protocolId: 'gym',
        protocolVersion: 1,
        stopRir: 2,
        startedAt: '2026-09-23T17:00:00.000Z',
        completedAt: '2026-09-23T17:30:00.000Z',
        tests: [
          { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 101, reps: 8, rir: 2, seconds: null },
          ...(['press_load', 'pulldown_load', 'row_load', 'hinge_load', 'plank_hold'] as const).map((testId) => ({ status: 'skipped' as const, testId, reason: 'user_choice' as const })),
        ],
      },
      FIXTURE_LIBRARY,
    );
    const p = plan(gymInput({ capacity }));
    const squat = p.exercises.find((e) => e.slot === 'squat')!;
    expect(squat.exerciseId).toBe('barbell_back_squat');
    expect(squat.reasonCodes[0]).toBe('session.exercise.from_assessment');
    // e1RM 101 × (1 + 10/30) = 134.7; load for 10 reps at RIR 2 × 0.9 = 134.7 / (1 + 12/30) × 0.9 = 86.6 → 85 on 2.5 kg barbell steps.
    expect(squat.sets[0]).toMatchObject({ loadKg: 85 });
    expect(squat.sets[0]!.reasonCodes).toEqual(expect.arrayContaining(['session.load.from_e1rm', 'session.load.rounded']));
    expect(squat.sets[0]!.reasonParams.stepKg).toBe(2.5);
  });
});
