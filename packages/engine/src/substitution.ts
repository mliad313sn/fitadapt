import {
  JOINTS,
  defineConfig,
  impactRank,
  skillRank,
  type EquipmentId,
  type Exercise,
  type ExerciseEdge,
  type Joint,
  type JointFlags,
  type SafetyProfile,
} from '@fitadapt/shared';

/**
 * Exercise substitution over the M06 knowledge graph (ADR-011).
 *
 * substitute() returns the highest-similarity SUBSTITUTES neighbour that
 * - needs only equipment the user has (every REQUIRES group satisfied);
 * - loads no joint flagged red at medium or high level (S2 pain gate, M05);
 * - stays within the SafetyProfile impact ceiling (S1, M01);
 * - has none of the movement tags the SafetyProfile asks to avoid;
 * - is not an exercise the user excluded;
 * - is at most `maxSkillStepUp` skill levels above the original.
 * Among valid options, amber joints loaded at medium/high lower the score.
 * The rules are hard filters: no configuration can relax the S2 filter.
 * Pure and deterministic: ties break on exercise id.
 */

export const SUBSTITUTION_CONFIG = defineConfig({
  /** Score penalty per amber joint that the candidate loads at medium or high. */
  amberJointPenalty: { value: 0.1, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  /** Largest allowed jump in skill level from the original to a substitute. */
  maxSkillStepUp: { value: 1, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
});

export type SubstitutionReasonCode =
  | 'substitution.highest_similarity'
  | 'substitution.equipment_unavailable'
  | 'substitution.joint_red'
  | 'substitution.joint_amber'
  | 'substitution.impact_above_ceiling'
  | 'substitution.avoid_tag'
  | 'substitution.excluded_by_user'
  | 'substitution.none_available';

export const SUBSTITUTION_REASON_CODES: readonly SubstitutionReasonCode[] = Object.freeze([
  'substitution.highest_similarity',
  'substitution.equipment_unavailable',
  'substitution.joint_red',
  'substitution.joint_amber',
  'substitution.impact_above_ceiling',
  'substitution.avoid_tag',
  'substitution.excluded_by_user',
  'substitution.none_available',
]);

export interface SubstitutionReason {
  readonly code: SubstitutionReasonCode;
  /** The joint concerned, for joint_red / joint_amber (rendered through i18n `library.joint.*`). */
  readonly joint?: Joint;
}

export type GraphExercise = Pick<Exercise, 'id' | 'pattern' | 'skill' | 'impact' | 'jointLoad' | 'equipment' | 'contraindications'>;

interface Neighbour {
  readonly to: string;
  readonly similarity: number;
}

export interface ExerciseGraph {
  readonly exercises: ReadonlyMap<string, GraphExercise>;
  /** SUBSTITUTES neighbours per exercise, highest similarity first, then by id. */
  readonly substitutes: ReadonlyMap<string, readonly Neighbour[]>;
}

export function createExerciseGraph(exercises: readonly GraphExercise[], edges: readonly ExerciseEdge[]): ExerciseGraph {
  const byId = new Map(exercises.map((e) => [e.id, e] as const));
  const substitutes = new Map<string, Neighbour[]>();
  for (const edge of edges) {
    if (edge.type !== 'SUBSTITUTES') continue;
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error(`SUBSTITUTES edge ${edge.from} → ${edge.to} references an unknown exercise`);
    const list = substitutes.get(edge.from) ?? [];
    list.push({ to: edge.to, similarity: edge.similarity });
    substitutes.set(edge.from, list);
  }
  for (const list of substitutes.values()) list.sort((a, b) => b.similarity - a.similarity || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  return { exercises: byId, substitutes };
}

export type EquipmentSet = ReadonlySet<EquipmentId> | readonly EquipmentId[];

function asSet(equipment: EquipmentSet): ReadonlySet<EquipmentId> {
  return equipment instanceof Set ? equipment : new Set(equipment as readonly EquipmentId[]);
}

export function hasEquipment(exercise: GraphExercise, equipment: ReadonlySet<EquipmentId>): boolean {
  return exercise.equipment.every((group) => group.anyOf.some((id) => equipment.has(id)));
}

/** Joints flagged red that the exercise loads at medium or high level (S2). */
export function redJointsLoaded(exercise: GraphExercise, jointFlags: JointFlags): Joint[] {
  return JOINTS.filter((j) => jointFlags[j] === 'red' && exercise.jointLoad[j] !== 'low');
}

function amberJointsLoaded(exercise: GraphExercise, jointFlags: JointFlags): Joint[] {
  return JOINTS.filter((j) => jointFlags[j] === 'amber' && exercise.jointLoad[j] !== 'low');
}

/**
 * Why an exercise cannot be prescribed for this user right now (empty = allowed).
 * The same checks decide whether a candidate substitute is valid.
 */
export function blockingReasons(exercise: GraphExercise, equipment: EquipmentSet, jointFlags: JointFlags, safetyProfile: SafetyProfile): SubstitutionReason[] {
  const reasons: SubstitutionReason[] = [];
  if (safetyProfile.excludedExerciseIds.includes(exercise.id)) reasons.push({ code: 'substitution.excluded_by_user' });
  if (!hasEquipment(exercise, asSet(equipment))) reasons.push({ code: 'substitution.equipment_unavailable' });
  for (const joint of redJointsLoaded(exercise, jointFlags)) reasons.push({ code: 'substitution.joint_red', joint });
  if (impactRank(exercise.impact) > impactRank(safetyProfile.impactCeiling)) reasons.push({ code: 'substitution.impact_above_ceiling' });
  if (exercise.contraindications.some((tag) => safetyProfile.avoidTags.includes(tag))) reasons.push({ code: 'substitution.avoid_tag' });
  return reasons;
}

export interface SubstitutionResult {
  readonly exerciseId: string;
  readonly similarity: number;
  /** Similarity minus amber penalties; the ranking key. */
  readonly score: number;
  /** Why the original was replaced (if it was blocked) and why this option was chosen. */
  readonly reasons: readonly SubstitutionReason[];
}

export interface SubstitutionOptions {
  readonly config?: typeof SUBSTITUTION_CONFIG;
}

function resolve(graph: ExerciseGraph, exercise: string | GraphExercise): GraphExercise {
  const found = typeof exercise === 'string' ? graph.exercises.get(exercise) : graph.exercises.get(exercise.id);
  if (!found) throw new Error(`unknown exercise ${typeof exercise === 'string' ? exercise : exercise.id}`);
  return found;
}

/** Every valid substitute, best first. */
export function rankSubstitutes(
  graph: ExerciseGraph,
  exercise: string | GraphExercise,
  equipment: EquipmentSet,
  jointFlags: JointFlags,
  safetyProfile: SafetyProfile,
  options: SubstitutionOptions = {},
): SubstitutionResult[] {
  const config = options.config ?? SUBSTITUTION_CONFIG;
  const original = resolve(graph, exercise);
  const available = asSet(equipment);
  const blocked = blockingReasons(original, available, jointFlags, safetyProfile);
  const maxSkill = skillRank(original.skill) + config.maxSkillStepUp.value;
  const results: SubstitutionResult[] = [];
  for (const { to, similarity } of graph.substitutes.get(original.id) ?? []) {
    const candidate = graph.exercises.get(to) as GraphExercise;
    if (skillRank(candidate.skill) > maxSkill) continue;
    if (blockingReasons(candidate, available, jointFlags, safetyProfile).length > 0) continue;
    const amber = amberJointsLoaded(candidate, jointFlags);
    const originalAmber = amberJointsLoaded(original, jointFlags);
    const score = Math.round((similarity - config.amberJointPenalty.value * amber.length) * 1000) / 1000;
    const amberReasons = originalAmber.filter((j) => !amber.includes(j)).map((joint): SubstitutionReason => ({ code: 'substitution.joint_amber', joint }));
    results.push({ exerciseId: to, similarity, score, reasons: [...blocked, ...amberReasons, { code: 'substitution.highest_similarity' }] });
  }
  results.sort((a, b) => b.score - a.score || b.similarity - a.similarity || (a.exerciseId < b.exerciseId ? -1 : 1));
  return results;
}

/**
 * The highest-similarity valid substitute for `exercise`, or null when none
 * satisfies equipment, joint flags and the SafetyProfile (the caller then drops
 * the slot: reason `substitution.none_available`).
 */
export function substitute(
  graph: ExerciseGraph,
  exercise: string | GraphExercise,
  equipment: EquipmentSet,
  jointFlags: JointFlags,
  safetyProfile: SafetyProfile,
  options: SubstitutionOptions = {},
): SubstitutionResult | null {
  return rankSubstitutes(graph, exercise, equipment, jointFlags, safetyProfile, options)[0] ?? null;
}

export interface SubstitutionSafetyEvent {
  readonly invariant: 'S2';
  readonly reasonCode: 'substitution.joint_red';
  readonly action: 'substituted';
}

/**
 * The S2 safety event to write to the defensibility log (L11, packages/legal
 * `safety.event`) when a substitution was forced by a red joint; null otherwise.
 * The caller adds the engine version (stamp()).
 */
export function substitutionSafetyEvent(result: SubstitutionResult | null): SubstitutionSafetyEvent | null {
  if (!result || !result.reasons.some((r) => r.code === 'substitution.joint_red')) return null;
  return { invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted' };
}
