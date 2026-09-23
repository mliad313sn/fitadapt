import { S2_RED_PAIN_SCORE } from '@fitadapt/safety';
import type { Joint, PerformedSet, PlannedExercise, SessionPlan } from '@fitadapt/shared';
import { sessionValue } from '../config/session.js';
import { redJointsLoaded } from '../substitution.js';
import { achievableAtMost, implementFor } from './increments.js';
import type { SessionLibrary } from './library.js';
import { replacementsFor } from './program-session.js';
import type { GenerateSessionInput } from './types.js';

/**
 * Execution-time rules (the screen asks, the engine decides):
 *
 * - RIR autoregulation inside a session: when a set is reported clearly
 *   closer to failure than planned (reserve ≤ target − 2) or below the bottom
 *   of the range, the remaining sets of that exercise get lighter (one
 *   equipment step at or below −5 %). A session never gets heavier than it
 *   was prescribed (S5).
 * - Pain during a session: a joint scored ≥ 6 (S2 red) makes every remaining
 *   exercise that loads it at medium/high level swap to an allowed
 *   alternative now (the next session substitutes too, through the joint
 *   flags); when there is none, that exercise is to be skipped.
 */
export function autoregulateRemainingSets(input: GenerateSessionInput, library: SessionLibrary, exercise: PlannedExercise, performed: PerformedSet): PlannedExercise {
  const planned = exercise.sets.find((s) => s.index === performed.index);
  if (!planned || performed.status !== 'done' || planned.loadKg === null) return exercise;
  const tooHard = performed.rir !== null && performed.rir <= planned.targetRir - sessionValue('autoregulation.rirDeviation');
  const short = planned.target.kind === 'reps' && performed.reps !== null && performed.reps < planned.target.min;
  if (!tooHard && !short) return exercise;
  const ex = library.graph.exercises.get(exercise.exerciseId);
  const loading = ex ? implementFor(ex, library.loadType(ex.id), new Set(input.equipment), input.equipmentLoads ?? null, input.loadIncrementKg ?? 2.5) : null;
  if (!loading?.implement) return exercise;
  const lighter = achievableAtMost(planned.loadKg * (1 - sessionValue('autoregulation.loadReductionFraction')), loading.implement);
  if (lighter === null || lighter >= planned.loadKg) return exercise;
  return {
    ...exercise,
    sets: exercise.sets.map((s) =>
      s.index > performed.index && s.loadKg !== null && s.loadKg > lighter
        ? { ...s, loadKg: lighter, reasonCodes: [...s.reasonCodes, 'session.autoreg.load_reduced'], reasonParams: { ...s.reasonParams, deltaKg: Math.round((s.loadKg - lighter) * 100) / 100 } }
        : s,
    ),
  };
}

export interface PainAdjustment {
  readonly exerciseIndex: number;
  /** The allowed replacement, or null: skip this exercise. */
  readonly replacement: PlannedExercise | null;
}

export function painAdjustments(input: GenerateSessionInput, library: SessionLibrary, plan: SessionPlan, fromIndex: number, joint: Joint, score: number, nowMs: number): PainAdjustment[] {
  if (score < S2_RED_PAIN_SCORE) return [];
  const flags = { ...(input.jointFlags ?? {}), [joint]: 'red' as const };
  const withFlag: GenerateSessionInput = { ...input, jointFlags: flags };
  const out: PainAdjustment[] = [];
  plan.exercises.forEach((e, i) => {
    if (i < fromIndex) return;
    const ex = library.graph.exercises.get(e.exerciseId);
    if (!ex || redJointsLoaded(ex, flags).length === 0) return;
    out.push({ exerciseIndex: i, replacement: replacementsFor(withFlag, library, plan, i, nowMs, 'pain', 1)[0] ?? null });
  });
  return out;
}
