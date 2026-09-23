import {
  ASSESSMENT_PROTOCOLS,
  buildAssessmentPlan as buildPlanOnLibrary,
  buildCapacityModel as buildCapacityOnLibrary,
  generateSession as generateOnLibrary,
  type AssessmentPlan,
  type AssessmentProtocol,
  type EngineContext,
  type EquipmentSet,
  type GenerateSessionInput,
  type GenerateSessionResult,
  type SessionLibrary,
} from '@fitadapt/engine';
import type { AssessmentResult, CapacityModel, EquipmentId, JointFlags, SafetyProfile } from '@fitadapt/shared';
import { seedLibrary, type ExerciseLibrary } from './library.js';

/**
 * M07 bound to the M06 seed: the engine's assessment, capacity model and
 * first-session generator over the seed's ladders, exercises and graph
 * (the same pattern as substitute()). The rules live in packages/engine.
 */
export function sessionLibrary(library: ExerciseLibrary = seedLibrary()): SessionLibrary {
  return {
    ladders: library.ladders,
    graph: library.graph,
    isHold: (id) => library.byId.get(id)?.tags.includes('isometric') === true,
    loadType: (id) => library.byId.get(id)?.loadType,
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

/** True when the place has the equipment for at least one option of every loaded gym test (recommendProtocol input). */
export function hasGymEquipment(equipment: readonly EquipmentId[]): boolean {
  const exercises = seedLibrary().graph.exercises;
  const available = new Set(equipment);
  return ASSESSMENT_PROTOCOLS.gym.tests
    .filter((t) => t.kind === 'load_reps')
    .every((t) => t.options.some((id) => exercises.get(id)?.equipment.every((g) => g.anyOf.some((e) => available.has(e)))));
}
