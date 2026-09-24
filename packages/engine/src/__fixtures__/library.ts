/**
 * Test-only fictional library for the engine's assessment and session tests
 * (not built into dist). It mirrors the ids and ladder order of the M06 seed
 * for the ladders M07 uses; packages/exercise-library re-runs the persona
 * tests against the real seed.
 */
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type EquipmentId, type LoadType, type SafetyProfile, type ScreeningQuestionId } from '@fitadapt/shared';
import type { AssessmentLadder } from '../assessment/capacity.js';
import type { SessionLibrary } from '../session/first-session.js';
import { createExerciseGraph, type GraphExercise } from '../substitution.js';

type Spec = { eq?: (EquipmentId | EquipmentId[])[]; ci?: GraphExercise['contraindications']; imp?: GraphExercise['impact']; lt?: LoadType; hold?: boolean; knee?: 'low' | 'medium' | 'high'; pattern?: GraphExercise['pattern'] };

const BENCH: EquipmentId[] = ['flat_bench', 'adjustable_bench', 'sturdy_chair', 'box'];
const ROW_BAR: EquipmentId[] = ['low_bar', 'gymnastic_rings', 'suspension_trainer', 'smith_machine', 'squat_rack'];

const SPECS: Record<string, Spec> = {
  wall_push_up: { pattern: 'horizontal_push' },
  incline_push_up_high: { pattern: 'horizontal_push' },
  incline_push_up_low: { pattern: 'horizontal_push', eq: [BENCH] },
  knee_push_up: { pattern: 'horizontal_push', ci: ['floor_transfer'] },
  push_up: { pattern: 'horizontal_push', ci: ['floor_transfer'] },
  deficit_push_up: { pattern: 'horizontal_push', eq: [['parallettes', 'dumbbell']] },
  diamond_push_up: { pattern: 'horizontal_push' },
  archer_push_up: { pattern: 'horizontal_push' },
  dead_hang: { pattern: 'vertical_pull', eq: [['pull_up_bar', 'gymnastic_rings']], ci: ['hanging'], hold: true },
  scapular_pull_up: { pattern: 'vertical_pull', eq: ['pull_up_bar'], ci: ['hanging'] },
  inverted_row_incline: { pattern: 'horizontal_pull', eq: [ROW_BAR] },
  inverted_row: { pattern: 'horizontal_pull', eq: [ROW_BAR] },
  band_assisted_pull_up: { pattern: 'vertical_pull', eq: ['pull_up_bar', 'resistance_band'], ci: ['hanging'] },
  negative_pull_up: { pattern: 'vertical_pull', eq: ['pull_up_bar', ['box', 'sturdy_chair']], ci: ['hanging'] },
  pull_up: { pattern: 'vertical_pull', eq: ['pull_up_bar'], ci: ['hanging'] },
  weighted_pull_up: { pattern: 'vertical_pull', eq: ['pull_up_bar', ['dumbbell', 'kettlebell']], ci: ['hanging'] },
  box_squat: { pattern: 'squat', eq: [BENCH] },
  air_squat: { pattern: 'squat' },
  goblet_squat: { pattern: 'squat', eq: [['dumbbell', 'kettlebell']], lt: 'external', knee: 'low' },
  split_squat: { pattern: 'lunge' },
  barbell_back_squat: { pattern: 'squat', eq: ['barbell', 'squat_rack'], lt: 'external', knee: 'high' },
  leg_press: { pattern: 'squat', eq: ['leg_press'], lt: 'machine', knee: 'high' },
  knee_plank: { pattern: 'core', ci: ['floor_transfer'], hold: true },
  front_plank: { pattern: 'core', ci: ['floor_transfer'], hold: true },
  ab_wheel_kneeling: { pattern: 'core', eq: ['ab_wheel'] },
  seated_band_row: { pattern: 'horizontal_pull', eq: ['resistance_band'], lt: 'band' },
  ring_row: { pattern: 'horizontal_pull', eq: [['gymnastic_rings', 'suspension_trainer']] },
  one_arm_dumbbell_row: { pattern: 'horizontal_pull', eq: ['dumbbell', BENCH], lt: 'external' },
  bent_over_dumbbell_row: { pattern: 'horizontal_pull', eq: ['dumbbell'], lt: 'external' },
  barbell_row: { pattern: 'horizontal_pull', eq: ['barbell'], lt: 'external' },
  hip_hinge_drill: { pattern: 'hinge', lt: 'none' },
  kettlebell_deadlift: { pattern: 'hinge', eq: [['dumbbell', 'kettlebell']], lt: 'external' },
  dumbbell_romanian_deadlift: { pattern: 'hinge', eq: ['dumbbell'], lt: 'external' },
  barbell_romanian_deadlift: { pattern: 'hinge', eq: ['barbell'], lt: 'external' },
  conventional_deadlift: { pattern: 'hinge', eq: ['barbell', 'weight_plate'], lt: 'external' },
  band_chest_press: { pattern: 'horizontal_push', eq: ['resistance_band'], lt: 'band' },
  dumbbell_floor_press: { pattern: 'horizontal_push', eq: ['dumbbell'], lt: 'external' },
  dumbbell_bench_press: { pattern: 'horizontal_push', eq: ['dumbbell', ['flat_bench', 'adjustable_bench']], lt: 'external' },
  barbell_bench_press: { pattern: 'horizontal_push', eq: ['barbell', 'flat_bench', 'squat_rack'], lt: 'external' },
  lat_pulldown: { pattern: 'vertical_pull', eq: ['lat_pulldown'], lt: 'machine' },
  assisted_pull_up_machine: { pattern: 'vertical_pull', eq: ['assisted_pull_up_machine'], lt: 'machine' },
};

export const FIXTURE_EXERCISES: GraphExercise[] = Object.entries(SPECS).map(([id, s]) => ({
  id,
  pattern: s.pattern ?? 'core',
  skill: 'beginner',
  impact: s.imp ?? 'none',
  jointLoad: { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'low', knee: s.knee ?? 'medium', ankle: 'low' },
  equipment: (s.eq ?? []).map((g) => ({ anyOf: Array.isArray(g) ? g : [g] })),
  contraindications: s.ci ?? [],
}));

export const FIXTURE_LADDERS: AssessmentLadder[] = [
  { id: 'push', steps: [['wall_push_up'], ['incline_push_up_high'], ['incline_push_up_low'], ['knee_push_up'], ['push_up'], ['deficit_push_up', 'diamond_push_up'], ['archer_push_up']] },
  { id: 'pull', steps: [['dead_hang'], ['scapular_pull_up'], ['inverted_row_incline'], ['inverted_row'], ['band_assisted_pull_up'], ['negative_pull_up'], ['pull_up'], ['weighted_pull_up']] },
  { id: 'squat', steps: [['box_squat'], ['air_squat'], ['goblet_squat'], ['split_squat'], ['barbell_back_squat', 'leg_press']] },
  { id: 'plank', steps: [['knee_plank'], ['front_plank'], ['ab_wheel_kneeling']] },
  { id: 'row_bodyweight', steps: [['seated_band_row'], ['ring_row'], ['inverted_row']] },
  { id: 'row_loaded', steps: [['seated_band_row'], ['one_arm_dumbbell_row'], ['bent_over_dumbbell_row'], ['barbell_row']] },
  { id: 'hinge', steps: [['hip_hinge_drill'], ['kettlebell_deadlift'], ['dumbbell_romanian_deadlift'], ['barbell_romanian_deadlift'], ['conventional_deadlift']] },
  { id: 'press_loaded', steps: [['band_chest_press'], ['dumbbell_floor_press'], ['dumbbell_bench_press'], ['barbell_bench_press']] },
  { id: 'pull_gym', steps: [['lat_pulldown'], ['assisted_pull_up_machine'], ['negative_pull_up']] },
];

/** A few SUBSTITUTES edges so the session generator's last-resort substitution can be exercised. */
const EDGES = [
  { type: 'SUBSTITUTES' as const, from: 'barbell_back_squat', to: 'goblet_squat', similarity: 0.8, validated: false, source: 'fixture' },
  { type: 'SUBSTITUTES' as const, from: 'barbell_back_squat', to: 'air_squat', similarity: 0.7, validated: false, source: 'fixture' },
];

const byId = new Map(FIXTURE_EXERCISES.map((e) => [e.id, e]));

export const FIXTURE_LIBRARY: SessionLibrary = {
  ladders: FIXTURE_LADDERS,
  isHold: (id) => SPECS[id]?.hold === true,
  loadType: (id) => (byId.has(id) ? (SPECS[id]!.lt ?? 'bodyweight') : undefined),
  graph: createExerciseGraph(FIXTURE_EXERCISES, EDGES as never),
};

export const P1_HOME: EquipmentId[] = ['pull_up_bar', 'resistance_band', 'dumbbell'];
export const FULL_GYM: EquipmentId[] = ['barbell', 'squat_rack', 'flat_bench', 'dumbbell', 'kettlebell', 'leg_press', 'lat_pulldown', 'weight_plate', 'resistance_band', 'pull_up_bar', 'box', 'ab_wheel', 'gymnastic_rings'];

/**
 * SAF-3: the safety facts every engine input must carry, at their "nothing reported" values
 * (no pain flags, no history, no recent loads, no date of birth, unknown local date, unlocked).
 */
export const SAFE_FACTS = Object.freeze({
  jointFlags: {},
  history: [],
  recentLoads: [],
  birthDate: null,
  localDate: null,
  intensityLock: Object.freeze({ locked: false, since: null }),
}) as { readonly jointFlags: Record<never, never>; readonly history: readonly never[]; readonly recentLoads: readonly never[]; readonly birthDate: null; readonly localDate: null; readonly intensityLock: { readonly locked: false; readonly since: null } };

/** SafetyProfile from the M01 screening (never re-implemented here). */
export function profileFrom(yes: ScreeningQuestionId[] = [], options: { clearanceAttested?: boolean; birthYear?: number } = {}): SafetyProfile {
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  return evaluateScreening({
    answers,
    clearanceAttested: options.clearanceAttested ?? false,
    birthDate: { year: options.birthYear ?? 1988, month: 1, day: 1 },
    answeredOn: { year: 2026, month: 9, day: 23 },
    limitations: [],
    excludedExerciseIds: [],
  });
}
