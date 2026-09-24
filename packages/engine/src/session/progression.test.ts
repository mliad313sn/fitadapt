import { ProgressionDecisionSchema, type PerformedSet, type ProgressionInput, type SlotTarget } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { SESSION_CONFIG } from '../config/session.js';
import { evaluateProgression } from './progression.js';

const NOW = '2026-10-12T08:00:00.000Z';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY).toISOString();
const range = (min: number, max: number): SlotTarget => ({ kind: 'reps', min, max });
const sets = (n: number, reps: number, rir: number | null, loadKg: number | null = null, status: 'done' | 'skipped' = 'done'): PerformedSet[] =>
  Array.from({ length: n }, (_, i) => ({ index: i + 1, status, reps: status === 'done' ? reps : null, seconds: null, loadKg: status === 'done' ? loadKg : null, rir: status === 'done' ? rir : null }));
const session = (performed: PerformedSet[], over: Partial<ProgressionInput['sessions'][number]> = {}, ago = 3) => ({ at: daysAgo(ago), target: range(8, 12), targetRir: 2, prescribedLoadKg: null, performed, ...over });
const loaded = (sessions: ProgressionInput['sessions'], over: Partial<ProgressionInput> = {}): ProgressionInput => ({
  exerciseId: 'dumbbell_bench_press',
  pattern: 'horizontal_push',
  loading: 'load',
  target: range(8, 12),
  targetRir: 2,
  sessions,
  implement: { kind: 'barbell', barKg: 20, stepKg: 2.5 },
  loadReferences: [],
  asOf: NOW,
  ...over,
});

describe('double progression with RIR autoregulation (Rules)', () => {
  it('all working sets at the top of the range at or below the target RPE → the smallest step ≥ 2.5 % (upper body), back to the bottom of the range', () => {
    const d = evaluateProgression(loaded([session(sets(3, 12, 2, 60), { prescribedLoadKg: 60 })]));
    expect(ProgressionDecisionSchema.parse(d)).toEqual(d);
    // 60 × 1.025 = 61.5 → the smallest barbell step at or above it: 62.5.
    expect(d).toMatchObject({ action: 'increase_load', loadKg: 62.5, target: range(8, 12), s5Capped: false, reasonCodes: ['session.progression.load_increased'] });
    expect(d.reasonParams).toEqual({ deltaKg: 2.5, sets: 3, reps: 12, rir: 2, sessions: 1 });
  });

  it('lower body: the smallest step ≥ 5 %', () => {
    const d = evaluateProgression(loaded([session(sets(3, 12, 2, 100), { prescribedLoadKg: 100 })], { pattern: 'squat', exerciseId: 'barbell_back_squat' }));
    expect(d).toMatchObject({ action: 'increase_load', loadKg: 105 });
    // With microplates the step still has to reach 5 %: 100 → 105, never 100.5.
    const micro = evaluateProgression(loaded([session(sets(3, 12, 2, 100), { prescribedLoadKg: 100 })], { pattern: 'squat', implement: { kind: 'barbell', barKg: 20, stepKg: 0.5 } }));
    expect(micro.loadKg).toBe(105);
    const upperMicro = evaluateProgression(loaded([session(sets(3, 12, 2, 100), { prescribedLoadKg: 100 })], { implement: { kind: 'barbell', barKg: 20, stepKg: 0.5 } }));
    expect(upperMicro.loadKg).toBe(102.5);
  });

  it('the smallest increment the equipment allows: dumbbell pairs jump to the next pair, a stack to its next step', () => {
    const dumbbells = evaluateProgression(loaded([session(sets(3, 12, 3, 12), { prescribedLoadKg: 12 })], { implement: { kind: 'dumbbell', loadsKg: [10, 12, 14, 16] } }));
    expect(dumbbells).toMatchObject({ action: 'increase_load', loadKg: 14, reasonParams: { deltaKg: 2 } });
    const stack = evaluateProgression(loaded([session(sets(3, 12, 2, 40), { prescribedLoadKg: 40 })], { exerciseId: 'lat_pulldown', pattern: 'vertical_pull', implement: { kind: 'stack', minKg: 5, stepKg: 5, maxKg: 100 } }));
    expect(stack.loadKg).toBe(45);
  });

  it('not every set at the top, a skipped set, or a reserve below target (RPE above target) → same load, add reps', () => {
    expect(evaluateProgression(loaded([session([...sets(2, 12, 2, 60), ...sets(1, 10, 2, 60).map((s) => ({ ...s, index: 3 }))], { prescribedLoadKg: 60 })]))).toMatchObject({ action: 'hold', loadKg: 60, reasonCodes: ['session.progression.load_held'], reasonParams: { max: 12 } });
    expect(evaluateProgression(loaded([session([...sets(2, 12, 2, 60), { index: 3, status: 'skipped', reps: null, seconds: null, loadKg: null, rir: null }], { prescribedLoadKg: 60 })]))).toMatchObject({ action: 'hold', reasonCodes: ['session.progression.incomplete'] });
    expect(evaluateProgression(loaded([session(sets(3, 12, 1, 60), { prescribedLoadKg: 60 })]))).toMatchObject({ action: 'hold', loadKg: 60 });
    // An unreported reserve never counts as "at or below the target RPE".
    expect(evaluateProgression(loaded([session(sets(3, 12, null, 60), { prescribedLoadKg: 60 })]))).toMatchObject({ action: 'hold' });
  });

  it('works from what the user did: a lighter load than prescribed is the base; a heavier one is not trusted', () => {
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 55), { prescribedLoadKg: 60 })])).loadKg).toBe(57.5);
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 80), { prescribedLoadKg: 60 })])).loadKg).toBe(62.5);
    // A load the user chose (none prescribed) becomes the base.
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 40))])).loadKg).toBe(42.5);
    // Nothing known yet: the user chooses.
    expect(evaluateProgression(loaded([]))).toMatchObject({ action: 'start', loadKg: null, reasonCodes: ['session.progression.start'] });
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, null))]))).toMatchObject({ action: 'start', loadKg: null });
  });

  it('equipment at its top: a variant change is asked for (the generator moves up the ladder)', () => {
    const d = evaluateProgression(loaded([session(sets(3, 12, 2, 10), { prescribedLoadKg: 10 })], { pattern: 'squat', implement: { kind: 'dumbbell', loadsKg: [10] } }));
    expect(d).toMatchObject({ action: 'variant_up', loadKg: 10, reasonCodes: ['session.progression.equipment_max'], reasonParams: { loadKg: 10 } });
  });

  it('steps unknown: the load the user used last time, never a made-up step', () => {
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 18))], { implement: null, loading: 'self_select' }))).toMatchObject({ action: 'hold', loadKg: 18, reasonCodes: ['session.progression.load_held_steps_unknown'] });
  });
});

describe('regression (Rules: two sessions below the range, or RPE ≥ 9.5 → reduce load 5–10 %)', () => {
  it('two consecutive sessions below the bottom of the range → −10 %, rounded down to the equipment', () => {
    const below = session(sets(3, 6, 2, 60), { prescribedLoadKg: 60 });
    const d = evaluateProgression(loaded([below, { ...below, at: daysAgo(1) }]));
    expect(d).toMatchObject({ action: 'decrease_load', loadKg: 52.5, reasonCodes: ['session.progression.load_reduced'], reasonParams: { deltaKg: 7.5, min: 8, sessions: 2 } });
    // One session below is not enough.
    expect(evaluateProgression(loaded([below])).action).toBe('hold');
    // Not consecutive: a good session in between.
    expect(evaluateProgression(loaded([below, session(sets(3, 10, 2, 60), { prescribedLoadKg: 60 }, 2), { ...below, at: daysAgo(1) }])).action).toBe('hold');
    expect(SESSION_CONFIG['regression.loadReductionFraction'].value).toBe(0.1);
  });

  it('a set at RPE ≥ 9.5 (no reps left) → lighter next time', () => {
    const d = evaluateProgression(loaded([session([...sets(2, 12, 2, 60), { index: 3, status: 'done', reps: 12, seconds: null, loadKg: 60, rir: 0 }], { prescribedLoadKg: 60 })]));
    expect(d).toMatchObject({ action: 'decrease_load', loadKg: 52.5, reasonCodes: ['session.progression.load_reduced_effort'] });
  });

  it('no lighter load on this equipment → an easier variant is asked for', () => {
    const below = session(sets(3, 5, 2, 10), { prescribedLoadKg: 10 });
    expect(evaluateProgression(loaded([below, { ...below, at: daysAgo(1) }], { implement: { kind: 'dumbbell', loadsKg: [10] } }))).toMatchObject({ action: 'variant_down', loadKg: null, reasonCodes: ['session.progression.variant_down'] });
    expect(evaluateProgression(loaded([session([{ index: 1, status: 'done', reps: 8, seconds: null, loadKg: 10, rir: 0 }], { prescribedLoadKg: 10 })], { implement: { kind: 'dumbbell', loadsKg: [10] } })).action).toBe('variant_down');
  });

  it('a changed rep range (new block) re-derives the load from the RIR-adjusted e1RM', () => {
    // 60 kg × 10 @ RIR 2 → e1RM 60 × (1 + 12/30) = 84; 4–6 reps @ RIR 2 → 84 / (1 + 8/30) = 66.3 → 65 on 2.5 kg steps.
    const d = evaluateProgression(loaded([session(sets(3, 10, 2, 60), { prescribedLoadKg: 60 }, 10)], { target: range(4, 6) }));
    expect(d).toMatchObject({ action: 'rebase', loadKg: 65, target: range(4, 6), reasonCodes: ['session.progression.range_changed'] });
    // A3/A5 pre-review #2: 12 reps @ RIR 2 is 14 effective reps, outside Epley's range: no estimate, the load stays (was 67.5).
    const high = evaluateProgression(loaded([session(sets(3, 12, 2, 60), { prescribedLoadKg: 60 }, 10)], { target: range(4, 6) }));
    expect(high).toMatchObject({ action: 'rebase', loadKg: 60, target: range(4, 6) });
  });
});

describe('S5 inside the progression: never more than +10 % over any load of the last 7 days', () => {
  it('caps an increase and says so', () => {
    const d = evaluateProgression(loaded([session(sets(3, 12, 2, 10), { prescribedLoadKg: 10 })], { implement: { kind: 'dumbbell', loadsKg: [10, 12] }, loadReferences: [{ loadKg: 10, at: daysAgo(3) }] }));
    // 12 kg is +20 %: S5 keeps 10 kg.
    expect(d).toMatchObject({ action: 'hold', loadKg: 10, s5Capped: true, reasonCodes: ['session.progression.load_increased', 'session.load.s5_capped'] });
  });
  it('a reference dated after the clock (time travel) still counts; when no safe load exists, an easier variant is asked for', () => {
    const d = evaluateProgression(loaded([session(sets(3, 12, 2, 60), { prescribedLoadKg: 60 })], { loadReferences: [{ loadKg: 50, at: '2027-01-01T00:00:00.000Z' }] }));
    expect(d).toMatchObject({ loadKg: 55, s5Capped: true });
    const none = evaluateProgression(loaded([session(sets(3, 12, 2, 12), { prescribedLoadKg: 12 })], { implement: { kind: 'dumbbell', loadsKg: [12, 14] }, loadReferences: [{ loadKg: 8, at: daysAgo(1) }] }));
    expect(none).toMatchObject({ action: 'variant_down', loadKg: null, s5Capped: true, reasonCodes: ['session.progression.variant_down', 'session.load.s5_capped'] });
  });
});

describe('bodyweight variants (Rules: two sessions at the top → next variant; regression → one variant down)', () => {
  const bw = (s: ProgressionInput['sessions'], over: Partial<ProgressionInput> = {}) => loaded(s, { exerciseId: 'knee_push_up', loading: 'bodyweight', implement: null, target: range(6, 10), ...over });
  const top = (ago: number) => session(sets(3, 10, 2), { target: range(6, 10) }, ago);
  it('top of the range on all sets for two sessions → next variant', () => {
    expect(evaluateProgression(bw([top(4), top(2)]))).toMatchObject({ action: 'variant_up', loadKg: null, reasonCodes: ['session.progression.variant_up'], reasonParams: { reps: 10, sessions: 2 } });
    expect(evaluateProgression(bw([top(2)]))).toMatchObject({ action: 'hold', reasonCodes: ['session.progression.variant_held'] });
    expect(evaluateProgression(bw([session(sets(3, 9, 2), { target: range(6, 10) }, 4), top(2)])).action).toBe('hold');
    expect(SESSION_CONFIG['progression.variantSessions'].value).toBe(2);
  });
  it('two sessions below the bottom, or a set at RPE ≥ 9.5 → one variant down', () => {
    const below = (ago: number) => session(sets(3, 4, 2), { target: range(6, 10) }, ago);
    expect(evaluateProgression(bw([below(4), below(2)]))).toMatchObject({ action: 'variant_down', reasonCodes: ['session.progression.variant_down'] });
    expect(evaluateProgression(bw([session([{ index: 1, status: 'done', reps: 10, seconds: null, loadKg: null, rir: 0 }], { target: range(6, 10) })]))).toMatchObject({ action: 'variant_down', reasonCodes: ['session.progression.variant_down_effort'] });
  });
  it('a different range last time: keep the variant with the new range', () => {
    expect(evaluateProgression(bw([session(sets(3, 12, 2), { target: range(8, 12) })]))).toMatchObject({ action: 'hold', reasonCodes: ['session.progression.range_changed'] });
  });
});

describe('holds (isometric): a few seconds more, then the next variant', () => {
  const hold = (seconds: number): SlotTarget => ({ kind: 'hold', seconds });
  const held = (secs: number, target: number, rir = 2, ago = 2) => session([{ index: 1, status: 'done', reps: null, seconds: secs, loadKg: null, rir }, { index: 2, status: 'done', reps: null, seconds: secs, loadKg: null, rir }], { target: hold(target) }, ago);
  const h = (s: ProgressionInput['sessions'], target = 30) => loaded(s, { exerciseId: 'front_plank', pattern: 'core', loading: 'bodyweight', implement: null, target: hold(target) });
  it('reached twice → +5 s; at the ceiling → next variant at the minimum hold', () => {
    expect(evaluateProgression(h([held(30, 30, 2, 4), held(30, 30)]))).toMatchObject({ action: 'increase_hold', target: hold(35), reasonParams: { seconds: 35, sessions: 2 } });
    expect(evaluateProgression(h([held(60, 60, 2, 4), held(60, 60)], 60))).toMatchObject({ action: 'variant_up', target: hold(10), reasonParams: { heldSeconds: 60, sessions: 2 } });
    expect(evaluateProgression(h([held(30, 30)]))).toMatchObject({ action: 'hold', reasonCodes: ['session.progression.hold_held'] });
  });
  it('below twice, or at RPE ≥ 9.5 → −5 s, then an easier variant at the minimum', () => {
    expect(evaluateProgression(h([held(20, 30, 2, 4), held(20, 30)]))).toMatchObject({ action: 'decrease_hold', target: hold(25) });
    expect(evaluateProgression(h([held(30, 30, 0)]))).toMatchObject({ action: 'decrease_hold', target: hold(25), reasonCodes: ['session.progression.hold_shorter_effort'] });
    expect(evaluateProgression(h([held(5, 10, 2, 4), held(5, 10)], 10))).toMatchObject({ action: 'variant_down' });
    expect(evaluateProgression(h([held(10, 10, 0)], 10))).toMatchObject({ action: 'variant_down', reasonCodes: ['session.progression.variant_down_effort'] });
  });
});

describe('deload and transition weeks: nothing gets harder, regressions still apply', () => {
  it('holds the load and the variant', () => {
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 60), { prescribedLoadKg: 60 })], { allowProgression: false }))).toMatchObject({ action: 'hold', loadKg: 60, reasonCodes: ['session.deload.no_progression'] });
    const top = (ago: number) => session(sets(3, 10, 2), { target: range(6, 10) }, ago);
    expect(evaluateProgression(loaded([top(4), top(2)], { loading: 'bodyweight', implement: null, target: range(6, 10), allowProgression: false }))).toMatchObject({ action: 'hold', reasonCodes: ['session.deload.no_progression'] });
    const below = session(sets(3, 6, 2, 60), { prescribedLoadKg: 60 });
    expect(evaluateProgression(loaded([below, { ...below, at: daysAgo(1) }], { allowProgression: false })).action).toBe('decrease_load');
    expect(evaluateProgression(loaded([session(sets(3, 12, 2, 40))], { implement: null, loading: 'self_select', allowProgression: false })).loadKg).toBe(40);
  });
});

describe('zod-typed boundary', () => {
  it('refuses malformed input', () => {
    expect(() => evaluateProgression({ ...loaded([]), targetRir: -1 })).toThrow();
    expect(() => evaluateProgression({ ...loaded([]), asOf: 'yesterday' })).toThrow();
  });
});
