import { s5LoadCeiling } from '@fitadapt/safety';
import { GenerateSessionInputSchema, SessionHistoryEntrySchema, type ExecutionLog, type HistoryExercise, type SessionHistoryEntry } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SAFE_FACTS, FULL_GYM, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY } from '../__fixtures__/recovery.js';
import { GYM_ID, GYM_LOADS, SESSION_LIBRARY, programContext } from '../__fixtures__/session.js';
import { record } from '../__fixtures__/simulate.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { boundSessionInput, foldLoads, s5WindowReferences } from './bounds.js';
import { generateSession } from './generate.js';
import { buildSessionHistory } from './history.js';
import { loadReferencesFor } from './program-session.js';
import type { GenerateSessionInput } from './types.js';

const NOW = Date.parse('2026-09-28T08:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();
const ctx = () => createEngineContext({ clock: fixedClock(NOW), seed: 3 });
const GYM = [...FULL_GYM, 'cable_station'] as const;

function exercise(exerciseId: string, loadKg: number | null, sets = 3, slot: HistoryExercise['slot'] = 'squat', role: HistoryExercise['role'] = 'primary'): HistoryExercise {
  return {
    slot,
    role,
    exerciseId,
    ladderId: null,
    target: { kind: 'reps', min: 6, max: 10 },
    targetRir: 2,
    prescribedLoadKg: loadKg,
    performed: Array.from({ length: sets }, (_, i) => ({ index: i + 1, status: 'done' as const, reps: 8, seconds: null, loadKg, rir: 2 })),
  };
}
const entry = (n: number, ms: number, exercises: HistoryExercise[]): SessionHistoryEntry => ({
  planId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  prescribedAt: at(ms),
  startedAt: at(ms + 60_000),
  countsForProgression: true,
  exercises,
});

const firstInput = (history: SessionHistoryEntry[]): GenerateSessionInput => ({ ...SAFE_FACTS, capacity: GYM_CAPACITY, safetyProfile: profileFrom(), equipment: FULL_GYM, minutesAvailable: 75, history });
const squatLoad = (input: GenerateSessionInput) => {
  const r = generateSession(input, SESSION_LIBRARY, ctx());
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan.exercises.find((e) => e.exerciseId === 'barbell_back_squat')!.sets[0]!.loadKg;
};

describe('SAF-1: a history longer than the boundary cap never breaks generation and keeps every S5 reference', () => {
  it('61 sessions in the last 6 days: ok, and the dropped oldest one (squat 50 kg, 6 days ago) still caps the squat at 55 kg', () => {
    const oldest = entry(0, NOW - 6 * DAY, [exercise('barbell_back_squat', 50)]);
    const others = Array.from({ length: 60 }, (_, i) => entry(i + 1, NOW - 6 * DAY + (i + 1) * 2 * HOUR, [exercise('goblet_squat', 20)]));
    const history = [oldest, ...others];
    expect(history).toHaveLength(61);
    expect(GenerateSessionInputSchema.safeParse(firstInput(history)).success).toBe(false);
    expect(squatLoad(firstInput(history))).toBe(55);
    // Without the oldest session the squat is not capped at all (the cap came from the dropped session).
    expect(squatLoad(firstInput(others))).toBeGreaterThan(55);
  });

  it('500 sessions (one a day): ok, the 6-days-ago squat still caps it, and the bounded input fits the boundary', () => {
    const history = Array.from({ length: 500 }, (_, i) => entry(i, NOW - (500 - i) * DAY, [exercise(i === 494 ? 'barbell_back_squat' : 'goblet_squat', i === 494 ? 50 : 20)]));
    expect(squatLoad(firstInput(history))).toBe(55);
    const bounded = boundSessionInput(firstInput(history), NOW);
    expect(bounded.history).toHaveLength(60);
    expect(bounded.history!.at(-1)).toBe(history.at(-1));
    expect(GenerateSessionInputSchema.safeParse(bounded).success).toBe(true);
  });

  it('a program session with 200 sessions of history: ok', () => {
    const history = Array.from({ length: 200 }, (_, i) => entry(i, NOW - (200 - i) * DAY, [exercise('barbell_back_squat', 60, 5)]));
    const input: GenerateSessionInput = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: GYM, equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, minutesAvailable: 60, programSession: programContext(), experience: 'intermediate', history };
    expect(generateSession(input, SESSION_LIBRARY, ctx()).status).toBe('ok');
  });

  it('within the caps the input is returned unchanged', () => {
    const input = firstInput([entry(1, NOW - DAY, [exercise('barbell_back_squat', 50)])]);
    expect(boundSessionInput(input, NOW)).toBe(input);
    expect(boundSessionInput({ history: [], recentLoads: [] }, NOW)).toEqual({ history: [], recentLoads: [] });
  });

  it('more than 500 recent loads: folded to the S5 window per exercise (the ceiling never loosens)', () => {
    const recentLoads = Array.from({ length: 600 }, (_, i) => ({ exerciseId: i % 2 ? 'barbell_back_squat' : 'goblet_squat', loadKg: 40 + (i % 50), prescribedAt: at(NOW - (i % 10) * DAY) }));
    const bounded = boundSessionInput({ history: [], recentLoads }, NOW);
    expect(bounded.recentLoads!.length).toBeLessThanOrEqual(2);
    for (const id of ['barbell_back_squat', 'goblet_squat']) {
      const full = s5LoadCeiling(recentLoads.filter((r) => r.exerciseId === id).map((r) => ({ loadKg: r.loadKg, at: r.prescribedAt })), NOW);
      const folded = s5LoadCeiling(bounded.recentLoads!.filter((r) => r.exerciseId === id).map((r) => ({ loadKg: r.loadKg, at: r.prescribedAt })), NOW);
      expect(folded).toBe(full);
    }
    expect(squatLoad({ ...firstInput([]), recentLoads })).toBeLessThanOrEqual(41 * 1.1);
  });

  it('property: folding never gives a looser S5 ceiling, at any time', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.constantFrom('a', 'b', 'c'), loadKg: fc.double({ min: 0, max: 300, noNaN: true }), offset: fc.integer({ min: -20 * DAY, max: 5 * DAY }) }), { maxLength: 40 }),
        fc.integer({ min: -3 * DAY, max: 3 * DAY }),
        (refs, shift) => {
          const loads = refs.map((r) => ({ exerciseId: r.id, loadKg: r.loadKg, at: at(NOW + r.offset) }));
          const folded = foldLoads(loads);
          for (const id of ['a', 'b', 'c']) {
            const full = s5LoadCeiling(loads.filter((l) => l.exerciseId === id), NOW + shift);
            const small = s5LoadCeiling(folded.filter((l) => l.exerciseId === id), NOW + shift);
            if (full !== null) expect(small).not.toBeNull();
            if (full !== null && small !== null) expect(small).toBeLessThanOrEqual(full + 1e-9);
            // The window reduction is exact at its own time.
            expect(s5LoadCeiling(s5WindowReferences(loads.filter((l) => l.exerciseId === id), NOW + shift), NOW + shift)).toBe(full);
          }
        },
      ),
      { numRuns: 500 },
    );
    expect(s5WindowReferences([{ loadKg: Number.NaN, at: at(NOW) }], NOW)).toHaveLength(1);
  });
});

describe('SAF-7: load references passed to the progression never exceed its cap', () => {
  it('60 sessions with one exercise in two slots and 5 sets each (720 references): ok', () => {
    const history = Array.from({ length: 60 }, (_, i) =>
      entry(i, NOW - (60 - i) * DAY, [exercise('barbell_back_squat', 60, 5, 'squat', 'primary'), exercise('barbell_back_squat', 50, 5, 'squat', 'secondary')]),
    );
    expect(loadReferencesFor(history, [], 'barbell_back_squat').length).toBe(720);
    const input: GenerateSessionInput = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: GYM, equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, minutesAvailable: 60, programSession: programContext(), experience: 'intermediate', history };
    const r = generateSession(input, SESSION_LIBRARY, ctx());
    expect(r.status).toBe('ok');
  });
});

describe('SAF-6: a session with more than 20 exercise entries (swaps) keeps the S5 references of the extra ones', () => {
  it('the 21st entry (a swap prescribed at 20 kg) caps the next prescription of that exercise at 22 kg', () => {
    const input: GenerateSessionInput = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: GYM, equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, minutesAvailable: 60, programSession: programContext(), experience: 'intermediate' };
    const r = generateSession(input, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(NOW - DAY), seed: 4 }));
    if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
    const plan = r.plan;
    const last = plan.exercises.length - 1;
    const base = plan.exercises[last]!;
    const swaps = 21 - plan.exercises.length;
    const events: ExecutionLog[] = Array.from({ length: swaps }, (_, k) => ({
      kind: 'swapped',
      planId: plan.planId,
      exerciseIndex: last,
      fromExerciseId: base.exerciseId,
      replacement: { ...base, exerciseId: k === swaps - 1 ? 'fixture_overflow_press' : `fixture_swap_${k}`, sets: base.sets.map((s) => ({ ...s, loadKg: k === swaps - 1 ? 20 : 30 })) },
      reason: 'equipment',
      at: plan.generatedAt,
    }));
    const [h] = buildSessionHistory([record(input, plan)], [], events);
    expect(h!.exercises).toHaveLength(20);
    expect(SessionHistoryEntrySchema.parse(h)).toEqual(h);
    expect(h!.overflowLoads).toEqual([{ exerciseId: 'fixture_overflow_press', loadKg: 20, at: plan.generatedAt }]);
    expect(s5LoadCeiling(loadReferencesFor([h!], [], 'fixture_overflow_press'), NOW)).toBeCloseTo(22);
    // Sessions within the cap carry no overflow field.
    expect(buildSessionHistory([record(input, plan)], [], [])[0]!.overflowLoads).toBeUndefined();
  });
});
