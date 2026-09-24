import { s5LoadCeiling } from '@fitadapt/safety';
import type { ExecutionLog, HistoryExercise, PerformedSet, PlannedExercise, SessionHistoryEntry, SessionPlan, SetLog, WorkoutSessionRecord } from '@fitadapt/shared';
import { loadReferencesFor } from './program-session.js';
import type { RecentLoad } from './types.js';

/**
 * The engine's view of what the user did, rebuilt from the append-only
 * records (workout_sessions, set_logs, execution_logs): for every started
 * session, each exercise with what was prescribed and every prescribed set
 * as done or skipped (a set that was never logged counts as skipped). A swap
 * adds the replacement the engine prescribed as its own exercise; a
 * correction replaces the set log it names. Pure: the device and the server
 * build the same history from the same records.
 */
export interface StoredSetLog {
  readonly id: string;
  readonly data: SetLog;
}

function exerciseEntry(ex: PlannedExercise, logs: readonly SetLog[]): HistoryExercise {
  const first = ex.sets[0]!;
  const bySet = new Map<number, PerformedSet>();
  for (const log of logs) bySet.set(log.set.index, log.set);
  const performed = ex.sets.map((s) => bySet.get(s.index) ?? { index: s.index, status: 'skipped' as const, reps: null, seconds: null, loadKg: null, rir: null });
  return { slot: ex.slot, role: ex.role, exerciseId: ex.exerciseId, ladderId: ex.ladderId, target: first.target, targetRir: first.targetRir, prescribedLoadKg: first.loadKg, performed };
}

/** Latest entry per corrected id (corrections are new entries naming the one they replace). */
function effectiveLogs(setLogs: readonly StoredSetLog[]): SetLog[] {
  const corrected = new Set(setLogs.map((l) => l.data.correctionOf).filter((id): id is string => id !== null));
  return setLogs.filter((l) => !corrected.has(l.id)).map((l) => l.data);
}

export function buildSessionHistory(sessions: readonly WorkoutSessionRecord[], setLogs: readonly StoredSetLog[], events: readonly ExecutionLog[]): SessionHistoryEntry[] {
  const logs = effectiveLogs(setLogs);
  const ordered = [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.plan.planId < b.plan.planId ? -1 : 1));
  return ordered.map((record) => {
    const { plan } = record;
    const own = logs.filter((l) => l.planId === plan.planId);
    const ended = events.find((e) => (e.kind === 'ended' || e.kind === 'red_flag') && e.planId === plan.planId);
    const exercises: HistoryExercise[] = [];
    plan.exercises.forEach((ex, i) => {
      const swaps = events.filter((e): e is Extract<ExecutionLog, { kind: 'swapped' }> => e.kind === 'swapped' && e.planId === plan.planId && e.exerciseIndex === i);
      exercises.push(exerciseEntry(ex, own.filter((l) => l.exerciseIndex === i && l.exerciseId === ex.exerciseId)));
      for (const swap of swaps) exercises.push(exerciseEntry(swap.replacement, own.filter((l) => l.exerciseIndex === i && l.exerciseId === swap.replacement.exerciseId)));
    });
    // M05: a triggered-deload session does not count toward progression either (like M08 deload weeks).
    const triggeredDeload = plan.reasonCodes.some((c) => c.startsWith('session.deload.triggered.'));
    const counts = (plan.kind === 'first_session' || plan.program?.microcycleKind === 'accumulation') && ended?.kind !== 'red_flag' && !triggeredDeload;
    return { planId: plan.planId, prescribedAt: plan.generatedAt, startedAt: record.startedAt, countsForProgression: counts, exercises: exercises.slice(0, 20) };
  });
}

export interface S5Violation {
  readonly exerciseIndex: number;
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly ceilingKg: number;
}

/**
 * Every set of a plan whose load is above the S5 ceiling given the history
 * (and M07 recent loads) at the plan's generation time. Empty for every plan
 * the engine makes; the server runs it over its own stored records.
 */
export function s5Violations(plan: SessionPlan, history: readonly SessionHistoryEntry[], recentLoads: readonly RecentLoad[] = []): S5Violation[] {
  const now = Date.parse(plan.generatedAt);
  const out: S5Violation[] = [];
  plan.exercises.forEach((ex, i) => {
    const ceiling = s5LoadCeiling(loadReferencesFor(history, recentLoads, ex.exerciseId), now);
    if (ceiling === null) return;
    for (const s of ex.sets) if (s.loadKg !== null && s.loadKg > ceiling + 1e-9) out.push({ exerciseIndex: i, exerciseId: ex.exerciseId, loadKg: s.loadKg, ceilingKg: ceiling });
  });
  return out;
}
