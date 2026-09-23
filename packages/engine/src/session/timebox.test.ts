import type { PlannedExercise, SlotIntent, SlotRole } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { SESSION_CONFIG } from '../config/session.js';
import { competing, fitToTime, planSeconds, totalSeconds, type WorkExercise } from './timebox.js';

/** A fictional exercise: `sets` sets of 10 reps (30 s of work) and 60 s of rest → 90 s per set + 30 s setup. */
function w(slot: PlannedExercise['slot'], role: SlotRole, sets: number, intent: SlotIntent = 'hypertrophy', rest = 60): WorkExercise {
  const exercise: PlannedExercise = {
    slot,
    role,
    exerciseId: `${slot}_${role}`,
    ladderId: null,
    supersetGroup: null,
    sets: Array.from({ length: sets }, (_, i) => ({ index: i + 1, target: { kind: 'reps', min: 8, max: 10 }, loadKg: null, targetRir: 2, restSeconds: rest, tempo: null, reasonCodes: ['session.rep_range.hypertrophy'], reasonParams: {} })),
    reasonCodes: ['session.exercise.from_program'],
  };
  return { exercise, pattern: slot, role, intent, sets, partner: null, dropped: false };
}

const session = () => [w('squat', 'primary', 3, 'strength', 120), w('horizontal_push', 'primary', 3), w('horizontal_pull', 'secondary', 3), w('core', 'accessory', 3), w('isolation', 'accessory', 3)];

describe('time-boxing (Scope: trim accessory sets first, then supersets, never the warm-up below its minimum)', () => {
  it('fits as planned when there is time', () => {
    const full = totalSeconds(session(), 8, null);
    const fit = fitToTime(session(), 8, null, Math.ceil(full / 60))!;
    expect(fit.reasonCodes).toEqual([]);
    expect(fit.exercises.map((e) => e.sets.length)).toEqual([3, 3, 3, 3, 3]);
    expect(fit.warmUpMinutes).toBe(8);
  });

  it('trims accessory sets first (last first), then pairs non-competing patterns as supersets, then shortens the warm-up to its minimum', () => {
    const full = totalSeconds(session(), 8, null);
    // A little short: accessory sets only.
    const a = fitToTime(session(), 8, null, (full - 60) / 60)!;
    expect(a.reasonCodes).toEqual(['session.time.accessory_sets_trimmed']);
    expect(a.exercises.map((e) => e.sets.length)).toEqual([3, 3, 3, 3, 2]);
    // Shorter: accessories down to one set each, then supersets.
    const b = fitToTime(session(), 8, null, (full - 7 * 60) / 60)!;
    expect(b.reasonCodes.slice(0, 2)).toEqual(['session.time.accessory_sets_trimmed', 'session.time.superset']);
    expect(b.exercises.filter((e) => e.role === 'accessory').every((e) => e.sets.length === 1)).toBe(true);
    const grouped = b.exercises.filter((e) => e.supersetGroup !== null);
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    for (const letter of new Set(grouped.map((e) => e.supersetGroup))) {
      const pair = grouped.filter((e) => e.supersetGroup === letter);
      expect(pair).toHaveLength(2);
      expect(competing(pair[0]!.slot, pair[1]!.slot)).toBe(false);
      // Paired exercises are next to each other; the first rests only for the transition.
      const i = b.exercises.indexOf(pair[0]!);
      expect(b.exercises[i + 1]).toBe(pair[1]);
      expect(pair[0]!.sets[0]!.restSeconds).toBe(SESSION_CONFIG['time.supersetTransitionSeconds'].value);
    }
    // The heavy strength primary is never paired.
    expect(b.exercises.find((e) => e.slot === 'squat')!.supersetGroup).toBeNull();
    // Much shorter: the warm-up goes to its minimum, never below.
    const c = fitToTime(session(), 8, null, 20)!;
    expect(c.reasonCodes).toContain('session.time.warmup_shortened');
    expect(c.warmUpMinutes).toBe(SESSION_CONFIG['warmUp.minimumMinutes'].value);
    expect(c.seconds).toBeLessThanOrEqual(20 * 60);
  });

  it('then a finisher is shortened and dropped, then secondary sets, accessories, primary sets and whole exercises go (last first)', () => {
    const cond = { kind: 'steady' as const, placement: 'finisher' as const, minutes: 10 };
    const d = fitToTime(session(), 8, cond, 30)!;
    expect(d.reasonCodes).toEqual(expect.arrayContaining(['session.time.accessory_sets_trimmed', 'session.time.superset', 'session.time.warmup_shortened', 'session.time.conditioning_shortened']));
    expect(d.seconds).toBeLessThanOrEqual(30 * 60);
    const e = fitToTime(session(), 8, cond, 14)!;
    expect(e.conditioning).toBeNull();
    expect(e.reasonCodes).toEqual(expect.arrayContaining(['session.time.finisher_dropped', 'session.time.secondary_sets_trimmed', 'session.time.accessory_dropped']));
    expect(e.exercises.every((x) => x.role !== 'accessory')).toBe(true);
    const f = fitToTime(session(), 8, cond, 9)!;
    expect(f.reasonCodes).toEqual(expect.arrayContaining(['session.time.primary_sets_trimmed', 'session.time.exercise_dropped']));
    expect(f.exercises.length).toBeGreaterThanOrEqual(1);
    expect(f.exercises[0]!.slot).toBe('squat');
    expect(f.seconds).toBeLessThanOrEqual(9 * 60);
    // Not even the warm-up minimum and one set: no plan.
    expect(fitToTime(session(), 8, cond, 6)).toBeNull();
    // A whole-session conditioning block only shrinks.
    const cardio = fitToTime([], 8, { kind: 'steady', placement: 'session', minutes: 40 }, 30)!;
    expect(cardio.conditioning).toEqual({ kind: 'steady', placement: 'session', minutes: 25 });
    expect(fitToTime([], 8, null, 30)).toBeNull();
  });

  it('planSeconds recomputes the fitted duration from the plan alone', () => {
    for (const minutes of [60, 40, 30, 20, 14, 9]) {
      const fit = fitToTime(session(), 8, { kind: 'steady', placement: 'finisher', minutes: 10 }, minutes);
      if (!fit) continue;
      expect(planSeconds({ warmUp: { minutes: fit.warmUpMinutes }, conditioning: fit.conditioning, exercises: fit.exercises })).toBe(fit.seconds);
    }
  });

  it('competing patterns share a region: same group, or arms with pushes and pulls; balance and mobility are never paired', () => {
    expect(competing('squat', 'hinge')).toBe(true);
    expect(competing('horizontal_push', 'vertical_push')).toBe(true);
    expect(competing('isolation', 'horizontal_pull')).toBe(true);
    expect(competing('horizontal_pull', 'isolation')).toBe(true);
    expect(competing('horizontal_push', 'horizontal_pull')).toBe(false);
    expect(competing('squat', 'horizontal_push')).toBe(false);
    expect(competing('core', 'isolation')).toBe(false);
    expect(competing('balance', 'core')).toBe(true);
    const fit = fitToTime([w('balance', 'secondary', 3, 'balance'), w('mobility', 'accessory', 3, 'mobility'), w('core', 'accessory', 1)], 8, null, 12);
    expect(fit?.exercises.every((e) => e.supersetGroup === null)).toBe(true);
  });
});
