import { PROGRAM_MUSCLE_GROUPS, WeeklyMuscleSetsSchema, type HistoryExercise, type IsoDate, type PerformedSet, type ProgramMuscleGroup, type SessionHistoryEntry, type TrainingAge, type WeeklyMuscleSets } from '@fitadapt/shared';
import { addDays, mondayOf } from '../program/dates.js';
import { contributions, volumeRange } from '../program/volume.js';
import { analyticsValue } from './config.js';
import type { DateOf } from './strength.js';

/**
 * Weekly hard sets per muscle group, against the M08 goal ranges for the
 * user's training age (PROGRAM_CONFIG `volume.*`, "starting points, to be
 * validated"). A set counts when it was done and hard: at most
 * `hardSet.maxRir` reps in reserve, or, when the user did not report the
 * reserve, when the engine prescribed at most that. Each movement pattern
 * gives its muscle groups the same (fractional) share M08 plans with
 * (`contributions`), so planned and done volume are measured the same way.
 * Balance and mobility work counts toward no group.
 */

export function isHardSet(set: PerformedSet, exercise: Pick<HistoryExercise, 'targetRir'>): boolean {
  if (set.status !== 'done' || !((set.reps ?? 0) > 0 || (set.seconds ?? 0) > 0)) return false;
  const rir = set.rir ?? exercise.targetRir;
  return rir <= analyticsValue('hardSet.maxRir');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hard sets per muscle group of one session. */
export function sessionHardSets(entry: SessionHistoryEntry): Map<ProgramMuscleGroup, number> {
  const out = new Map<ProgramMuscleGroup, number>();
  for (const ex of entry.exercises) {
    const hard = ex.performed.filter((s) => isHardSet(s, ex)).length;
    if (hard === 0) continue;
    for (const [group, share] of contributions(ex.slot)) out.set(group, (out.get(group) ?? 0) + hard * share);
  }
  return out;
}

export interface WeeklyHardSetsInput {
  readonly history: readonly SessionHistoryEntry[];
  readonly dateOf: DateOf;
  readonly trainingAge: TrainingAge;
  /** Any day of the last week to show; weeks start on Monday. */
  readonly through: IsoDate;
  readonly weeks: number;
}

/** For each of the last `weeks` weeks (oldest first) and each muscle group: hard sets done and the goal range. */
export function weeklyHardSets({ history, dateOf, trainingAge, through, weeks }: WeeklyHardSetsInput): WeeklyMuscleSets[] {
  const lastWeek = mondayOf(through);
  const firstWeek = addDays(lastWeek, -7 * (Math.max(1, Math.floor(weeks)) - 1));
  const totals = new Map<string, number>();
  for (const entry of history) {
    const week = mondayOf(dateOf(entry.startedAt));
    if (week < firstWeek || week > lastWeek) continue;
    for (const [group, sets] of sessionHardSets(entry)) totals.set(`${week}|${group}`, (totals.get(`${week}|${group}`) ?? 0) + sets);
  }
  const { min, max } = volumeRange(trainingAge);
  const out: WeeklyMuscleSets[] = [];
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    for (const muscle of PROGRAM_MUSCLE_GROUPS) {
      const hardSets = round2(totals.get(`${week}|${muscle}`) ?? 0);
      out.push(WeeklyMuscleSetsSchema.parse({ weekStart: week, muscle, hardSets, rangeMin: min, rangeMax: max, status: hardSets < min ? 'below' : hardSets > max ? 'above' : 'within' }));
    }
  }
  return out;
}
