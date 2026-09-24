import {
  ASSESSMENT_PROTOCOLS,
  buildAssessmentPlan as buildPlanOnLibrary,
  buildCapacityModel as buildCapacityOnLibrary,
  autoregulateRemainingSets as autoregulateOnLibrary,
  generateSession as generateOnLibrary,
  painAdjustments as painOnLibrary,
  replacementsFor as replacementsOnLibrary,
  type PainAdjustment,
  type AssessmentPlan,
  type AssessmentProtocol,
  type EngineContext,
  type EquipmentSet,
  type GenerateSessionInput,
  type GenerateSessionResult,
  type SessionLibrary,
} from '@fitadapt/engine';
import type { AssessmentResult, CapacityModel, EquipmentId, Joint, JointFlags, PerformedSet, PlannedExercise, SafetyProfile, SessionPlan } from '@fitadapt/shared';
import { seedLibrary, type ExerciseLibrary } from './library.js';
import { WARM_UP_DRILLS } from './seed/warmups.js';

/**
 * M07 and M02 bound to the M06 seed: the engine's assessment, capacity model
 * and session generator (first session and program sessions) over the seed's
 * ladders, exercises and graph (the same pattern as substitute()). The rules
 * live in packages/engine.
 */
export function sessionLibrary(library: ExerciseLibrary = seedLibrary()): SessionLibrary {
  return {
    ladders: library.ladders,
    graph: library.graph,
    isHold: (id) => library.byId.get(id)?.tags.includes('isometric') === true,
    loadType: (id) => library.byId.get(id)?.loadType,
    // M02: tags (negatives → slow eccentric, skills) and the %-bodyweight coefficients (config values, validated:false).
    tags: (id) => library.byId.get(id)?.tags ?? [],
    bodyweightLoad: (id) => library.byId.get(id)?.bodyweightLoad?.value ?? null,
    // M05: warm-up and cool-down drills per pattern (seed content, awaiting A2/A3), only those in this library.
    warmUpDrills: (pattern) => WARM_UP_DRILLS[pattern].filter((id) => library.byId.has(id)),
  };
}

let bound: SessionLibrary | undefined;
const seedSession = () => (bound ??= sessionLibrary());

export function buildAssessmentPlan(protocol: AssessmentProtocol, input: { safetyProfile: SafetyProfile; equipment: EquipmentSet; jointFlags?: JointFlags }): AssessmentPlan {
  return buildPlanOnLibrary(protocol, { ...input, exercises: seedLibrary().graph.exercises });
}

export function buildCapacityModel(result: AssessmentResult): CapacityModel {
  return buildCapacityOnLibrary(result, seedSession());
}

export function generateSession(input: GenerateSessionInput, ctx: EngineContext): GenerateSessionResult {
  return generateOnLibrary(input, seedSession(), ctx);
}

/** M02: alternatives for one exercise of a plan (swap, pain flag, missing equipment) on the seed. */
export function replacementsFor(input: GenerateSessionInput, plan: SessionPlan, exerciseIndex: number, nowMs: number, reason: 'user' | 'pain' | 'equipment', limit?: number): PlannedExercise[] {
  return replacementsOnLibrary(input, seedSession(), plan, exerciseIndex, nowMs, reason, limit);
}

/** M02: remaining sets after a logged set (RIR autoregulation) on the seed. */
export function autoregulateRemainingSets(input: GenerateSessionInput, exercise: PlannedExercise, performed: PerformedSet): PlannedExercise {
  return autoregulateOnLibrary(input, seedSession(), exercise, performed);
}

/** M02: what a pain flag changes in the rest of the session (S2 now) on the seed. */
export function painAdjustments(input: GenerateSessionInput, plan: SessionPlan, fromIndex: number, joint: Joint, score: number, nowMs: number): PainAdjustment[] {
  return painOnLibrary(input, seedSession(), plan, fromIndex, joint, score, nowMs);
}

/** True when the place has the equipment for at least one option of every loaded gym test (recommendProtocol input). */
export function hasGymEquipment(equipment: readonly EquipmentId[]): boolean {
  const exercises = seedLibrary().graph.exercises;
  const available = new Set(equipment);
  return ASSESSMENT_PROTOCOLS.gym.tests
    .filter((t) => t.kind === 'load_reps')
    .every((t) => t.options.some((id) => exercises.get(id)?.equipment.every((g) => g.anyOf.some((e) => available.has(e)))));
}
