import type { ExecutionLog, SessionPlan } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { SAFE_FACTS, FULL_GYM, P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { GYM_ID, GYM_LOADS, HOME_LOADS, SESSION_LIBRARY, programContext, slot } from '../__fixtures__/session.js';
import { perform, record, atTop } from '../__fixtures__/simulate.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { autoregulateRemainingSets, painAdjustments } from './execution.js';
import { generateSession } from './generate.js';
import { buildSessionHistory, s5Violations } from './history.js';
import { replacementsFor } from './program-session.js';
import type { GenerateSessionInput } from './types.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const GYM = [...FULL_GYM, 'cable_station'] as const;
const input: GenerateSessionInput = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: GYM, equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, minutesAvailable: 60, programSession: programContext(), experience: 'intermediate' };
const make = (i: GenerateSessionInput, at = MON, seed = 11): SessionPlan => {
  const r = generateSession(i, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(at), seed }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan;
};

describe('history from the append-only records', () => {
  it('every prescribed set is done or skipped; corrections replace what they name; swaps add the engine’s replacement', () => {
    const plan = make(input);
    const logs = perform(plan, (s, i) => (i === 0 && s.index === 3 ? null : atTop(50)(s, i, '')));
    const corrected = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', data: { ...logs[0]!.data, set: { ...logs[0]!.data.set, reps: 7 }, correctionOf: logs[0]!.id } };
    const replacement = replacementsFor(input, SESSION_LIBRARY, plan, 1, MON, 'user')[0]!;
    const swapLog = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', data: { schemaVersion: 1 as const, planId: plan.planId, exerciseIndex: 1, exerciseId: replacement.exerciseId, set: { index: 1, status: 'done' as const, reps: 9, seconds: null, loadKg: 20, rir: 2 }, loggedAt: plan.generatedAt, correctionOf: null } };
    const events: ExecutionLog[] = [{ kind: 'swapped', planId: plan.planId, exerciseIndex: 1, fromExerciseId: plan.exercises[1]!.exerciseId, replacement, reason: 'user', at: plan.generatedAt }];
    const [entry] = buildSessionHistory([record(input, plan)], [...logs, corrected, swapLog], events);
    expect(entry).toMatchObject({ planId: plan.planId, prescribedAt: plan.generatedAt, startedAt: plan.generatedAt, countsForProgression: true });
    const first = entry!.exercises[0]!;
    expect(first.performed.map((p) => [p.index, p.status, p.reps])).toEqual([
      [1, 'done', 7],
      [2, 'done', 10],
      [3, 'skipped', null],
    ]);
    expect(first.prescribedLoadKg).toBe(plan.exercises[0]!.sets[0]!.loadKg);
    const swapped = entry!.exercises.find((e) => e.exerciseId === replacement.exerciseId)!;
    expect(swapped.performed[0]).toMatchObject({ status: 'done', reps: 9 });
    expect(swapped.performed.slice(1).every((p) => p.status === 'skipped')).toBe(true);
  });

  it('deload weeks and red-flag sessions do not count for progression; records sort by start time', () => {
    const deload = make({ ...input, programSession: programContext({ kind: 'deload', targetRpe: 6 }) }, MON, 12);
    const normal = make(input, MON + 86_400_000, 13);
    const flagged = make(input, MON + 2 * 86_400_000, 14);
    const events: ExecutionLog[] = [{ kind: 'red_flag', planId: flagged.planId, symptom: 'palpitations', at: flagged.generatedAt }];
    const h = buildSessionHistory([record(input, flagged), record(input, normal), record(input, deload)], [], events);
    expect(h.map((e) => [e.planId, e.countsForProgression])).toEqual([
      [deload.planId, false],
      [normal.planId, true],
      [flagged.planId, false],
    ]);
  });

  it('s5Violations finds any load above the ceiling (it never does for engine plans)', () => {
    const plan = make(input);
    const hist = buildSessionHistory([record(input, plan)], perform(plan, atTop(50)), []);
    const next = make({ ...input, history: hist }, MON + 2 * 86_400_000, 15);
    expect(s5Violations(next, hist)).toEqual([]);
    const forged: SessionPlan = { ...next, exercises: next.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((s) => ({ ...s, loadKg: 90 })) } : e)) };
    expect(s5Violations(forged, hist)).toContainEqual({ exerciseIndex: 0, exerciseId: next.exercises[0]!.exerciseId, loadKg: 90, ceilingKg: 55.00000000000001 });
    expect(s5Violations(forged, [], [{ exerciseId: next.exercises[0]!.exerciseId, loadKg: 80, prescribedAt: next.generatedAt }])).toHaveLength(3);
  });

  it('SAF-5: with the server time, a plan dated 8 days ahead (device clock moved forward) is checked at the earlier time', () => {
    const plan = make(input);
    const hist = buildSessionHistory([record(input, plan)], perform(plan, atTop(50)), []);
    const id = plan.exercises[0]!.exerciseId;
    const ahead = make({ ...input, history: hist }, MON + 8 * 86_400_000, 17);
    const forged: SessionPlan = { ...ahead, exercises: ahead.exercises.map((e) => (e.exerciseId === id ? { ...e, sets: e.sets.map((x) => ({ ...x, loadKg: 90 })) } : e)) };
    // At the device's time (8 days later), the real references are out of the window: nothing to check against.
    expect(s5Violations(forged, hist)).toEqual([]);
    // At the server's time (one day after the reference), the ceiling applies.
    expect(s5Violations(forged, hist, [], MON + 86_400_000).map((v) => v.exerciseId)).toContain(id);
    // A server time later than the plan's never loosens it.
    expect(s5Violations(forged, hist, [], MON + 30 * 86_400_000)).toEqual([]);
    expect(s5Violations({ ...forged, generatedAt: 'not a date' }, hist, [], MON + 86_400_000).length).toBeGreaterThan(0);
  });
});

describe('execution-time rules', () => {
  it('autoregulation: a set much harder than planned makes the remaining sets lighter, never heavier', () => {
    const history = buildSessionHistory([record(input, make(input))], perform(make(input), atTop(60)), []);
    const plan = make({ ...input, history }, MON + 2 * 86_400_000, 16);
    const bench = plan.exercises.find((e) => e.exerciseId === 'barbell_bench_press')!;
    const load = bench.sets[0]!.loadKg!;
    const hard = autoregulateRemainingSets(input, SESSION_LIBRARY, bench, { index: 1, status: 'done', reps: 7, seconds: null, loadKg: load, rir: 0 });
    expect(hard.sets[0]!.loadKg).toBe(load);
    expect(load).toBe(62.5);
    expect(hard.sets[1]!.loadKg).toBe(57.5); // 62.5 × 0.95 = 59.4 → the barbell step below: 57.5
    expect(hard.sets[1]!.reasonCodes).toContain('session.autoreg.load_reduced');
    expect(hard.sets[1]!.reasonParams.deltaKg).toBe(5);
    // Short of the range also counts; an easy set changes nothing; bodyweight sets are left alone.
    expect(autoregulateRemainingSets(input, SESSION_LIBRARY, bench, { index: 1, status: 'done', reps: 3, seconds: null, loadKg: load, rir: 2 }).sets[2]!.loadKg).toBe(57.5);
    expect(autoregulateRemainingSets(input, SESSION_LIBRARY, bench, { index: 1, status: 'done', reps: 10, seconds: null, loadKg: load, rir: 4 })).toBe(bench);
    expect(autoregulateRemainingSets(input, SESSION_LIBRARY, bench, { index: 1, status: 'skipped', reps: null, seconds: null, loadKg: null, rir: null })).toBe(bench);
    const home = make({ ...input, equipment: P1_HOME, equipmentLoads: HOME_LOADS, programSession: programContext({ intent: 'general', slots: [slot('horizontal_push', 'primary', 'general', 3)] }) });
    expect(autoregulateRemainingSets(input, SESSION_LIBRARY, home.exercises[0]!, { index: 1, status: 'done', reps: 2, seconds: null, loadKg: null, rir: 0 })).toBe(home.exercises[0]);
    // Nothing lighter on this equipment: unchanged.
    const one = make({ ...input, equipment: P1_HOME, equipmentLoads: HOME_LOADS, programSession: programContext({ intent: 'general', slots: [slot('squat', 'primary', 'general', 3)] }) });
    const goblet = { ...one.exercises[0]!, sets: one.exercises[0]!.sets.map((s) => ({ ...s, loadKg: 10 })) };
    expect(autoregulateRemainingSets({ ...input, equipment: P1_HOME, equipmentLoads: HOME_LOADS }, SESSION_LIBRARY, goblet, { index: 1, status: 'done', reps: 3, seconds: null, loadKg: 10, rir: 0 })).toBe(goblet);
  });

  it('pain ≥ 6 on a joint swaps every remaining exercise that loads it (S2 now), or asks to skip it when nothing fits', () => {
    const plan = make(input);
    const adj = painAdjustments(input, SESSION_LIBRARY, plan, 0, 'knee', 7, MON);
    expect(adj.length).toBeGreaterThan(0);
    for (const a of adj) {
      if (a.replacement) {
        expect(SESSION_LIBRARY.graph.exercises.get(a.replacement.exerciseId)!.jointLoad.knee).toBe('low');
        expect(a.replacement.reasonCodes[0]).toBe('session.exercise.swapped_pain');
      }
    }
    expect(painAdjustments(input, SESSION_LIBRARY, plan, 0, 'knee', 5, MON)).toEqual([]);
    expect(painAdjustments(input, SESSION_LIBRARY, plan, plan.exercises.length, 'knee', 9, MON)).toEqual([]);
    // Nowhere to go: skip.
    const bare = { ...input, equipment: [] as never[], equipmentLoads: null };
    const barePlan = make({ ...bare, programSession: programContext({ slots: [slot('squat', 'primary', 'general', 2)] }) });
    expect(painAdjustments(bare, SESSION_LIBRARY, barePlan, 0, 'knee', 8, MON)).toEqual([{ exerciseIndex: 0, replacement: null }]);
  });

  it('swap options are allowed here, prescribed with the same rules, and never an exercise already in the plan', () => {
    const plan = make(input);
    const options = replacementsFor(input, SESSION_LIBRARY, plan, 0, MON, 'user');
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(plan.exercises.map((e) => e.exerciseId)).not.toContain(o.exerciseId);
      expect(o.slot).toBe(plan.exercises[0]!.slot);
      expect(o.sets).toHaveLength(plan.exercises[0]!.sets.length);
      expect(o.reasonCodes[0]).toBe('session.exercise.swapped');
    }
    expect(replacementsFor(input, SESSION_LIBRARY, plan, 99, MON, 'user')).toEqual([]);
    expect(replacementsFor(input, SESSION_LIBRARY, plan, 0, MON, 'equipment', 1)[0]!.reasonCodes[0]).toBe('session.switcher.mapped');
  });
});
