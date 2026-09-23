/**
 * Test-only helpers: run a plan as a fictional user would (append-only set
 * logs), and turn the records into the engine's history. Not built into dist.
 */
import type { ExecutionLog, PerformedSet, PlannedSet, SessionPlan, WorkoutSessionRecord } from '@fitadapt/shared';
import type { GenerateSessionInput } from '../session/types.js';
import { buildSessionHistory, type StoredSetLog } from '../session/history.js';

export type Performance = (set: PlannedSet, exerciseIndex: number, exerciseId: string) => Omit<PerformedSet, 'index'> | null;

/** Every set done exactly at the top of its target at the planned reserve, with the planned load (or `chosenKg` when the user chooses). */
export const atTop =
  (chosenKg: number | null = null): Performance =>
  (set) => ({ status: 'done', reps: set.target.kind === 'reps' ? set.target.max : null, seconds: set.target.kind === 'hold' ? set.target.seconds : null, loadKg: set.loadKg ?? chosenKg, rir: set.targetRir });

export const belowRange: Performance = (set) => ({ status: 'done', reps: set.target.kind === 'reps' ? Math.max(0, set.target.min - 2) : null, seconds: set.target.kind === 'hold' ? Math.max(0, set.target.seconds - 10) : null, loadKg: set.loadKg, rir: set.targetRir });

let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function perform(plan: SessionPlan, how: Performance, at: string = plan.generatedAt): StoredSetLog[] {
  const logs: StoredSetLog[] = [];
  plan.exercises.forEach((e, i) => {
    for (const s of e.sets) {
      const done = how(s, i, e.exerciseId);
      if (!done) continue;
      logs.push({ id: id(), data: { schemaVersion: 1, planId: plan.planId, exerciseIndex: i, exerciseId: e.exerciseId, set: { index: s.index, ...done }, loggedAt: at, correctionOf: null } });
    }
  });
  return logs;
}

export function record(input: GenerateSessionInput, plan: SessionPlan, startedAt: string = plan.generatedAt): WorkoutSessionRecord {
  return { schemaVersion: 1, input: input as WorkoutSessionRecord['input'], plan, safetyEvents: [], startedAt, jurisdiction: 'GB', firstWorkout: false };
}

/** A running log of sessions, as the device keeps it. */
export class Diary {
  readonly sessions: WorkoutSessionRecord[] = [];
  readonly setLogs: StoredSetLog[] = [];
  readonly events: ExecutionLog[] = [];
  add(input: GenerateSessionInput, plan: SessionPlan, how: Performance, startedAt: string = plan.generatedAt) {
    this.sessions.push(record(input, plan, startedAt));
    this.setLogs.push(...perform(plan, how, startedAt));
  }
  history() {
    return buildSessionHistory(this.sessions, this.setLogs, this.events);
  }
}
