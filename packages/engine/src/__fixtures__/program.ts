/**
 * Test-only fictional library and inputs for the program tests (not built
 * into dist). One or more exercises per movement pattern with different
 * equipment, so equipment profiles change which slots a place allows.
 * packages/exercise-library re-runs the persona programs on the real seed.
 */
import type { EquipmentId, GoalId, ProgramInput, SafetyProfile, Weekday } from '@fitadapt/shared';
import type { ProgramLibrary } from '../program/generate.js';
import type { GraphExercise } from '../substitution.js';
import { profileFrom } from './library.js';

type Spec = [id: string, pattern: GraphExercise['pattern'], equipment: (EquipmentId | EquipmentId[])[], ci?: GraphExercise['contraindications'], impact?: GraphExercise['impact']];

const SPECS: Spec[] = [
  ['air_squat', 'squat', []],
  ['goblet_squat', 'squat', [['dumbbell', 'kettlebell']]],
  ['barbell_back_squat', 'squat', ['barbell', 'squat_rack']],
  ['hip_hinge_drill', 'hinge', []],
  ['dumbbell_romanian_deadlift', 'hinge', ['dumbbell']],
  ['split_squat', 'lunge', []],
  ['push_up', 'horizontal_push', [], ['floor_transfer']],
  ['wall_push_up', 'horizontal_push', []],
  ['dumbbell_bench_press', 'horizontal_push', ['dumbbell', ['flat_bench', 'adjustable_bench']]],
  ['pike_push_up', 'vertical_push', [], ['inversion']],
  ['dumbbell_overhead_press', 'vertical_push', ['dumbbell'], ['overhead_loading']],
  ['band_row', 'horizontal_pull', ['resistance_band']],
  ['one_arm_dumbbell_row', 'horizontal_pull', ['dumbbell']],
  ['pull_up', 'vertical_pull', ['pull_up_bar'], ['hanging']],
  ['lat_pulldown', 'vertical_pull', ['lat_pulldown']],
  ['front_plank', 'core', [], ['floor_transfer']],
  ['dead_bug', 'core', [], ['supine_position']],
  ['dumbbell_curl', 'isolation', ['dumbbell']],
  ['band_curl', 'isolation', ['resistance_band']],
  ['supported_single_leg_stand', 'balance', []],
  ['hip_circles', 'mobility', []],
  ['farmer_carry', 'carry', [['dumbbell', 'kettlebell']]],
  ['marching', 'locomotion', []],
  ['jumping_jacks', 'locomotion', [], ['jumping_landing'], 'high'],
];

export const PROGRAM_EXERCISES: GraphExercise[] = SPECS.map(([id, pattern, eq, ci, impact]) => ({
  id,
  pattern,
  skill: 'beginner',
  impact: impact ?? 'low',
  jointLoad: { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'medium', knee: 'medium', ankle: 'low' },
  equipment: eq.map((g) => ({ anyOf: Array.isArray(g) ? g : [g] })),
  contraindications: ci ?? [],
}));

export const PROGRAM_LIBRARY: ProgramLibrary = { exercises: new Map(PROGRAM_EXERCISES.map((e) => [e.id, e])) };

export const HOME = '11111111-1111-4111-8111-111111111111';
export const GYM = '22222222-2222-4222-8222-222222222222';
export const PARK = '33333333-3333-4333-8333-333333333333';
export const GYM_EQUIPMENT: EquipmentId[] = ['barbell', 'squat_rack', 'dumbbell', 'flat_bench', 'lat_pulldown', 'pull_up_bar', 'resistance_band', 'kettlebell'];
export const HOME_EQUIPMENT: EquipmentId[] = ['pull_up_bar', 'resistance_band', 'dumbbell'];

export function programInput(overrides: Partial<ProgramInput> & { goal?: GoalId; days?: number; minutes?: number; profile?: SafetyProfile; trainingDays?: Weekday[] | null } = {}): ProgramInput {
  const { goal, days, minutes, profile, ...rest } = overrides;
  return {
    goals: { primary: goal ?? 'muscle_gain', secondary: null },
    experience: 'intermediate',
    daysPerWeek: days ?? 3,
    minutesPerSession: minutes ?? 45,
    trainingDays: null,
    startDate: '2026-09-28',
    safetyProfile: profile ?? profileFrom(),
    locations: [{ equipmentProfileId: GYM, location: 'gym', equipment: GYM_EQUIPMENT }],
    defaultEquipmentProfileId: null,
    locationByWeekday: {},
    previousGoal: null,
    ...rest,
  };
}
