import { S2_RED_PAIN_SCORE, s5LoadCeiling } from '@fitadapt/safety';
import { HISTORY_EXERCISES_MAX, type ExecutionLog, type HistoryExercise, type PerformedSet, type PlannedExercise, type SessionHistoryEntry, type SessionPlan, type SetLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { entryLoads, foldLoads } from './bounds.js';
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
    // M03: a cardio block that was run counts as logged training (the HIIT gate reads it).
    const cardio = events.filter((e): e is Extract<ExecutionLog, { kind: 'cardio_done' }> => e.kind === 'cardio_done' && e.planId === plan.planId);
    const kept = exercises.slice(0, HISTORY_EXERCISES_MAX);
    const base: SessionHistoryEntry = { planId: plan.planId, prescribedAt: plan.generatedAt, startedAt: record.startedAt, countsForProgression: counts, exercises: kept };
    // SAF-6: entries beyond the cap (many swaps) are not dropped silently: their S5 references are folded in.
    const overflow = foldLoads(entryLoads({ ...base, exercises: exercises.slice(HISTORY_EXERCISES_MAX) }));
    const entry: SessionHistoryEntry = overflow.length > 0 ? { ...base, overflowLoads: overflow } : base;
    if (cardio.length === 0) return entry;
    // A3/A5 #66: an interval block run to the end, without a red-flag stop or red pain, counts toward the interval ramp.
    const redPain = events.some((e) => e.kind === 'pain' && e.planId === plan.planId && e.score >= S2_RED_PAIN_SCORE);
    const hiitCompleted = plan.cardio?.hiit === true && cardio.some((c) => !c.endedEarly) && ended?.kind !== 'red_flag' && !redPain;
    return { ...entry, cardioSeconds: Math.min(10_800, cardio.reduce((s, c) => s + c.moderateSeconds + c.vigorousSeconds, 0)), ...(hiitCompleted ? { hiitCompleted: true as const } : {}) };
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
 *
 * SAF-5: `generatedAt` is the device's clock. With `asOfMs` (the server's
 * time), the window is evaluated at the EARLIER of the two, so a device clock
 * moved forward cannot push real references out of the 7-day window (a clock
 * moved back is already covered: references dated later always count). An
 * unreadable `generatedAt` is evaluated at `asOfMs` (or fails closed on all).
 */
export function s5Violations(plan: SessionPlan, history: readonly SessionHistoryEntry[], recentLoads: readonly RecentLoad[] = [], asOfMs?: number): S5Violation[] {
  const generated = Date.parse(plan.generatedAt);
  const now = asOfMs === undefined ? generated : Number.isFinite(generated) ? Math.min(generated, asOfMs) : asOfMs;
  const out: S5Violation[] = [];
  plan.exercises.forEach((ex, i) => {
    const ceiling = s5LoadCeiling(loadReferencesFor(history, recentLoads, ex.exerciseId), now);
    if (ceiling === null) return;
    for (const s of ex.sets) if (s.loadKg !== null && s.loadKg > ceiling + 1e-9) out.push({ exerciseIndex: i, exerciseId: ex.exerciseId, loadKg: s.loadKg, ceilingKg: ceiling });
  });
  return out;
}
