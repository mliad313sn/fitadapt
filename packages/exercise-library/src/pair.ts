import {
  fairScore as fairScoreOnLibrary,
  generatePairSession as generatePairOnLibrary,
  mergePlans as mergeOnLibrary,
  remainingTimeline as remainingOnLibrary,
  type EngineContext,
  type FairScoreInput,
  type GenerateSessionInput,
  type PairSessionResult,
  type PlanPosition,
  type SharedPlace,
} from '@fitadapt/engine';
import type { EquipmentId, FairScore, SessionPlan, SharedTimeline } from '@fitadapt/shared';
import { sessionLibrary } from './assessment.js';
import { seedLibrary } from './library.js';

/**
 * M09 Fair Pair bound to the M06 seed: the engine's pair planner and Fair
 * Challenge Score over the seed's graph (which implements each exercise
 * needs) and %-bodyweight coefficients. The rules live in packages/engine/pair.
 */
let bound: ReturnType<typeof sessionLibrary> | undefined;
const seedSession = () => (bound ??= sessionLibrary());

export function generatePairSession(inputA: GenerateSessionInput, inputB: GenerateSessionInput, place: SharedPlace, ctx: EngineContext): PairSessionResult {
  return generatePairOnLibrary(inputA, inputB, place, seedSession(), ctx);
}

/** mergePlans on the seed: `items` is the shared place's equipment (an id listed twice = two of it). */
export function mergePlans(planA: SessionPlan, planB: SessionPlan, items: readonly EquipmentId[]): SharedTimeline {
  return mergeOnLibrary(planA, planB, { items, graph: seedLibrary().graph });
}

export function remainingTimeline(a: PlanPosition, b: PlanPosition, items: readonly EquipmentId[], options: { lastTurn?: 'a' | 'b' | null } = {}): SharedTimeline {
  return remainingOnLibrary(a, b, { items, graph: seedLibrary().graph }, options);
}

export function fairScore(input: Omit<FairScoreInput, 'bodyweightLoad'>): FairScore {
  return fairScoreOnLibrary({ ...input, bodyweightLoad: seedSession().bodyweightLoad });
}
