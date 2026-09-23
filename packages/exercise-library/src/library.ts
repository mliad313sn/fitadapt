import { createExerciseGraph, rankSubstitutes as rankOnGraph, substitute as substituteOnGraph, type EquipmentSet, type ExerciseGraph, type SubstitutionOptions, type SubstitutionResult } from '@fitadapt/engine';
import { canonicalJson, sha256Hex } from '@fitadapt/legal';
import type { Equipment, Exercise, ExerciseEdge, JointFlags, Muscle, SafetyProfile } from '@fitadapt/shared';
import { SIMILARITY_CONFIG } from './config.js';
import { buildEdges } from './edges.js';
import { SEED_EXERCISES } from './seed/exercises.js';
import { LADDERS, type Ladder } from './seed/ladders.js';
import { EQUIPMENT, MUSCLES } from './taxonomy.js';

export interface ExerciseLibrary {
  readonly exercises: readonly Exercise[];
  readonly edges: readonly ExerciseEdge[];
  readonly equipment: readonly Equipment[];
  readonly muscles: readonly Muscle[];
  readonly ladders: readonly Ladder[];
  /** SHA-256 of the library content; the device reinstalls its offline copy when it changes. */
  readonly contentHash: string;
  readonly byId: ReadonlyMap<string, Exercise>;
  readonly graph: ExerciseGraph;
}

export function createLibrary(exercises: readonly Exercise[], ladders: readonly Ladder[] = LADDERS): ExerciseLibrary {
  const edges = buildEdges(exercises, ladders);
  // Edges are derived from these inputs, so hashing the inputs identifies the whole graph.
  const contentHash = sha256Hex(canonicalJson({ exercises, ladders, equipment: EQUIPMENT, muscles: MUSCLES, similarity: SIMILARITY_CONFIG }));
  return Object.freeze({
    exercises,
    edges,
    equipment: EQUIPMENT,
    muscles: MUSCLES,
    ladders,
    contentHash,
    byId: new Map(exercises.map((e) => [e.id, e] as const)),
    graph: createExerciseGraph(exercises, edges),
  });
}

let seed: ExerciseLibrary | undefined;

/** The MVP seed library (built once, then cached). */
export function seedLibrary(): ExerciseLibrary {
  seed ??= createLibrary(SEED_EXERCISES);
  return seed;
}

/**
 * substitute(exercise, equipment, jointFlags, safetyProfile) on the seed
 * library: the highest-similarity valid substitute, or null. The rules live
 * in packages/engine (substitution.ts).
 */
export function substitute(exercise: string | Exercise, equipment: EquipmentSet, jointFlags: JointFlags, safetyProfile: SafetyProfile, options?: SubstitutionOptions): SubstitutionResult | null {
  return substituteOnGraph(seedLibrary().graph, exercise, equipment, jointFlags, safetyProfile, options);
}

export function rankSubstitutes(exercise: string | Exercise, equipment: EquipmentSet, jointFlags: JointFlags, safetyProfile: SafetyProfile, options?: SubstitutionOptions): SubstitutionResult[] {
  return rankOnGraph(seedLibrary().graph, exercise, equipment, jointFlags, safetyProfile, options);
}

/** The most permissive SafetyProfile (used for the coverage KPI; real profiles come from M01). */
export const UNRESTRICTED_SAFETY_PROFILE: SafetyProfile = Object.freeze({
  maxRPE: 10,
  allowHIIT: true,
  allowMaxTests: true,
  impactCeiling: 'high',
  avoidTags: [],
  excludedExerciseIds: [],
});

/** Share of exercises with at least one valid substitute on an equipment set (M06 KPI). */
export function substituteCoverage(library: ExerciseLibrary, equipment: EquipmentSet, safetyProfile: SafetyProfile = UNRESTRICTED_SAFETY_PROFILE): { covered: number; total: number; share: number; missing: string[] } {
  const missing = library.exercises.filter((e) => substituteOnGraph(library.graph, e.id, equipment, {}, safetyProfile) === null).map((e) => e.id);
  const total = library.exercises.length;
  const covered = total - missing.length;
  return { covered, total, share: covered / total, missing };
}

/** Ladder position (0-based step) of an exercise, for M09 relative-effort scaling; null if not on the ladder. */
export function ladderRank(library: ExerciseLibrary, ladderId: string, exerciseId: string): number | null {
  const ladder = library.ladders.find((l) => l.id === ladderId);
  const index = ladder ? ladder.steps.findIndex((step) => step.includes(exerciseId)) : -1;
  return index < 0 ? null : index;
}
