import { ExerciseHistoryPointSchema, type ExerciseHistoryPoint, type IsoDate, type PerformedSet, type SessionHistoryEntry } from '@fitadapt/shared';
import { epleyE1RM } from '../assessment/e1rm.js';
import { mondayOf } from '../program/dates.js';

/**
 * Strength analytics over the engine's session history (M02
 * `buildSessionHistory`): per-exercise e1RM (M07 Epley with the RIR
 * adjustment), best set, volume load and variant level over time. Pure and
 * deterministic; dates come from the caller's local calendar (`dateOf`).
 * Nothing here decides a prescription: M02 owns progression.
 */

/** Maps a record time (ISO) to the user's local calendar date. */
export type DateOf = (iso: string) => IsoDate;

/** Ladder of each exercise (M06 seed): the rungs in order, each rung a list of equivalent exercises. */
export type LadderLookup = (exerciseId: string) => { readonly ladderId: string; readonly rung: number } | null;

const done = (s: PerformedSet) => s.status === 'done' && ((s.reps ?? 0) > 0 || (s.seconds ?? 0) > 0);

/** Epley e1RM of one set (null for sets without load, outside 1–12 reps, or not done). */
export function setE1RM(set: PerformedSet): number | null {
  if (!done(set) || set.loadKg === null || set.reps === null) return null;
  return epleyE1RM(set.loadKg, set.reps, set.rir ?? 0);
}

/** Σ reps × load of the done, loaded sets (kg). Body-weight sets add nothing (their load is not known here). */
export function volumeLoad(sets: readonly PerformedSet[]): number {
  let total = 0;
  for (const s of sets) if (done(s) && s.loadKg !== null && s.reps !== null) total += s.reps * s.loadKg;
  return Math.round(total * 100) / 100;
}

/**
 * The best set: the highest e1RM among loaded sets; without any, the most
 * reps (then the longest hold, then the fewest reps in reserve).
 */
export function bestSet(sets: readonly PerformedSet[]): PerformedSet | null {
  let best: PerformedSet | null = null;
  let bestE1rm = -1;
  for (const s of sets) {
    if (!done(s)) continue;
    const e = setE1RM(s) ?? -1;
    if (best === null) {
      best = s;
      bestE1rm = e;
      continue;
    }
    if (e > bestE1rm) {
      best = s;
      bestE1rm = e;
    } else if (e === bestE1rm && bestE1rm < 0) {
      const better = (s.reps ?? 0) - (best.reps ?? 0) || (s.seconds ?? 0) - (best.seconds ?? 0) || (best.rir ?? 0) - (s.rir ?? 0);
      if (better > 0) best = s;
    }
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One point per session in which the exercise had at least one done set:
 * e1RM, best set, volume load, done sets and the ladder rung (variant level).
 */
export function exerciseHistory(history: readonly SessionHistoryEntry[], exerciseId: string, dateOf: DateOf, ladder?: LadderLookup): ExerciseHistoryPoint[] {
  const out: ExerciseHistoryPoint[] = [];
  for (const entry of history) {
    const sets = entry.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.performed);
    const doneSets = sets.filter(done);
    if (doneSets.length === 0) continue;
    const best = bestSet(doneSets);
    const e1rms = doneSets.map(setE1RM).filter((v): v is number => v !== null);
    out.push(
      ExerciseHistoryPointSchema.parse({
        date: dateOf(entry.startedAt),
        planId: entry.planId,
        exerciseId,
        e1rmKg: e1rms.length > 0 ? round1(Math.max(...e1rms)) : null,
        volumeLoadKg: volumeLoad(doneSets),
        bestSet: best ? { reps: best.reps, seconds: best.seconds, loadKg: best.loadKg, rir: best.rir } : null,
        doneSets: doneSets.length,
        ladderRung: ladder?.(exerciseId)?.rung ?? null,
      }),
    );
  }
  return out;
}

/** The e1RM history of an exercise (sessions with a loaded set of 1–12 reps only). */
export function e1rmHistory(history: readonly SessionHistoryEntry[], exerciseId: string, dateOf: DateOf): { date: IsoDate; e1rmKg: number }[] {
  return exerciseHistory(history, exerciseId, dateOf).flatMap((p) => (p.e1rmKg === null ? [] : [{ date: p.date, e1rmKg: p.e1rmKg }]));
}

/** Exercises the user has done sets of, most recent first (the per-exercise history list). */
export function trainedExercises(history: readonly SessionHistoryEntry[], dateOf: DateOf): { exerciseId: string; lastDate: IsoDate; sessions: number }[] {
  const seen = new Map<string, { lastDate: IsoDate; sessions: number }>();
  for (const entry of history) {
    const date = dateOf(entry.startedAt);
    const here = new Set(entry.exercises.filter((e) => e.performed.some(done)).map((e) => e.exerciseId));
    for (const id of here) {
      const prev = seen.get(id);
      seen.set(id, { lastDate: prev && prev.lastDate > date ? prev.lastDate : date, sessions: (prev?.sessions ?? 0) + 1 });
    }
  }
  return [...seen.entries()].map(([exerciseId, v]) => ({ exerciseId, ...v })).sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.exerciseId.localeCompare(b.exerciseId)));
}

/** Volume load per week (weeks start on Monday), oldest first, only weeks with training. */
export function weeklyVolumeLoad(history: readonly SessionHistoryEntry[], dateOf: DateOf): { weekStart: IsoDate; volumeLoadKg: number; sessions: number }[] {
  const weeks = new Map<IsoDate, { volumeLoadKg: number; sessions: number }>();
  for (const entry of history) {
    const sets = entry.exercises.flatMap((e) => e.performed);
    if (!sessionWasTrained(entry)) continue;
    const week = mondayOf(dateOf(entry.startedAt));
    const w = weeks.get(week) ?? { volumeLoadKg: 0, sessions: 0 };
    w.volumeLoadKg = Math.round((w.volumeLoadKg + volumeLoad(sets)) * 100) / 100;
    w.sessions += 1;
    weeks.set(week, w);
  }
  return [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([weekStart, v]) => ({ weekStart, ...v }));
}

/** A session "happened" when a set was done or a cardio block was run (adherence, streaks). */
export function sessionWasTrained(entry: SessionHistoryEntry): boolean {
  return entry.exercises.some((e) => e.performed.some(done)) || (entry.cardioSeconds ?? 0) > 0;
}
