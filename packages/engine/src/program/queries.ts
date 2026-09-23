import { ScheduledDeloadSchema, type IsoDate, type Mesocycle, type Microcycle, type Program, type ReflowRecord, type ScheduledDeload } from '@fitadapt/shared';
import { addDays } from './dates.js';
import { effectiveWeeks, type EffectiveSession } from './reflow.js';

/**
 * Read-side of a program for the calendar, M02 (session generation), M05
 * (deloads) and M07 (re-assessment at the end of the mesocycle).
 */

export function microcycleOn(program: Program, date: IsoDate): Microcycle | null {
  return program.microcycles.find((m) => m.startDate <= date && date <= m.endDate) ?? null;
}

export function mesocycleOn(program: Program, date: IsoDate): Mesocycle | null {
  return program.mesocycles.find((m) => m.startDate <= date && date <= m.endDate) ?? null;
}

/** M05: the deload weeks the program schedules (volume factor from config; M05 adds triggered deloads). */
export function scheduledDeloads(program: Program): ScheduledDeload[] {
  return program.microcycles
    .filter((m) => m.kind === 'deload')
    .map((m) => ScheduledDeloadSchema.parse({ week: m.week, mesocycle: m.mesocycle, startDate: m.startDate, endDate: m.endDate, volumeFactor: m.volumeFactor, trigger: 'scheduled' }));
}

/** M05: the scheduled deload covering `date`, or null. */
export function deloadOn(program: Program, date: IsoDate): ScheduledDeload | null {
  return scheduledDeloads(program).find((d) => d.startDate <= date && date <= d.endDate) ?? null;
}

/**
 * M07: the day the re-assessment falls due for an assessment made on
 * `assessedOn` — the day after the end of the mesocycle containing it (or of
 * the first mesocycle when the assessment came before the program). An
 * assessment made during a deload week is the end-of-block re-test, so the
 * next mesocycle's end counts. Null after the program ends (the default
 * applies then).
 */
export function reassessmentDateFor(program: Program, assessedOn: IsoDate): IsoDate | null {
  const i = assessedOn < program.startDate ? 0 : program.mesocycles.findIndex((m) => m.startDate <= assessedOn && assessedOn <= m.endDate);
  if (i < 0) return null;
  const meso = program.mesocycles[i]!;
  const inDeload = program.microcycles.some((m) => m.week === meso.deloadWeek && m.startDate <= assessedOn && assessedOn <= m.endDate);
  const target = inDeload ? program.mesocycles[i + 1] : meso;
  return target ? addDays(target.endDate, 1) : null;
}

/**
 * M02 entry point: what the program asks for on `date` after the recorded
 * reflows — the session(s), the week (kind, volume factor, targets) and the
 * mesocycle (intent). M02 fills each slot with an exercise, a rep range and a
 * load within the session's targetRpe and hard sets.
 */
export interface ProgramDay {
  readonly programId: string;
  readonly date: IsoDate;
  readonly sessions: readonly EffectiveSession[];
  readonly microcycle: Microcycle;
  readonly mesocycle: Mesocycle;
}

export function programDay(program: Program, reflows: readonly ReflowRecord[], date: IsoDate): ProgramDay | null {
  const weeks = effectiveWeeks(program, reflows);
  const week = weeks.find((w) => w.microcycle.startDate <= date && date <= w.microcycle.endDate);
  if (!week) return null;
  return {
    programId: program.programId,
    date,
    sessions: week.sessions.filter((s) => s.date === date && (s.state === 'planned' || s.state === 'shifted')),
    microcycle: week.microcycle,
    mesocycle: program.mesocycles[week.microcycle.mesocycle - 1]!,
  };
}
