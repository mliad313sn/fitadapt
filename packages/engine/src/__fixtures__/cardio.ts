/**
 * Test-only fixtures for the M03 cardio tests (not built into dist):
 * a fictional library with conditioning movements, machines and venue swaps,
 * and a logged-training history for the HIIT gate. Fictional data only.
 */
import type { EquipmentId, ExerciseTag, LoadType, SessionHistoryEntry } from '@fitadapt/shared';
import type { SessionLibrary } from '../session/library.js';
import { createExerciseGraph, type GraphExercise } from '../substitution.js';
import { FIXTURE_EXERCISES, FIXTURE_LADDERS } from './library.js';

const DAY = 86_400_000;
type Spec = [id: string, pattern: GraphExercise['pattern'], impact: GraphExercise['impact'], loadType: LoadType, eq: EquipmentId[], knee: 'low' | 'medium' | 'high', tags: ExerciseTag[], skill?: GraphExercise['skill']];

const SPECS: Spec[] = [
  ['marching_in_place', 'locomotion', 'low', 'none', [], 'low', ['conditioning', 'low_impact', 'warm_up'], 'entry'],
  ['shadow_boxing', 'locomotion', 'low', 'none', [], 'low', ['conditioning', 'low_impact'], 'entry'],
  ['brisk_walk', 'locomotion', 'low', 'none', [], 'low', ['conditioning', 'low_impact'], 'entry'],
  ['step_back_burpee', 'locomotion', 'low', 'bodyweight', [], 'medium', ['conditioning', 'low_impact'], 'beginner'],
  ['mountain_climber', 'locomotion', 'low', 'bodyweight', [], 'medium', ['conditioning'], 'beginner'],
  ['jumping_jack', 'locomotion', 'high', 'none', [], 'medium', ['conditioning'], 'beginner'],
  ['burpee', 'locomotion', 'high', 'bodyweight', [], 'high', ['conditioning'], 'intermediate'],
  ['squat_jump', 'squat', 'high', 'bodyweight', [], 'high', ['conditioning'], 'beginner'],
  ['easy_run', 'locomotion', 'high', 'none', [], 'high', ['conditioning'], 'beginner'],
  ['stationary_bike_easy', 'locomotion', 'none', 'machine', ['stationary_bike'], 'medium', ['conditioning', 'low_impact', 'supported'], 'entry'],
  ['rowing_machine_steady', 'locomotion', 'none', 'machine', ['rowing_machine'], 'medium', ['conditioning', 'low_impact'], 'beginner'],
  ['stair_climber_steady', 'locomotion', 'low', 'machine', ['stair_climber'], 'medium', ['conditioning', 'low_impact'], 'beginner'],
  ['elliptical_steady', 'locomotion', 'low', 'machine', ['elliptical'], 'medium', ['conditioning', 'low_impact', 'supported'], 'entry'],
  ['treadmill_incline_walk', 'locomotion', 'low', 'machine', ['treadmill'], 'medium', ['conditioning', 'low_impact'], 'entry'],
  ['step_up', 'lunge', 'none', 'bodyweight', [], 'medium', ['low_impact'], 'beginner'],
];

const CARDIO_EXERCISES: GraphExercise[] = SPECS.map(([id, pattern, impact, , eq, knee, , skill]) => ({
  id,
  pattern,
  skill: skill ?? 'beginner',
  impact,
  jointLoad: { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'low', knee, ankle: impact === 'high' ? 'high' : 'low' },
  equipment: eq.map((e) => ({ anyOf: [e] })),
  contraindications: impact === 'high' ? ['jumping_landing'] : [],
}));

const ALL = [...FIXTURE_EXERCISES.filter((e) => !CARDIO_EXERCISES.some((c) => c.id === e.id)), ...CARDIO_EXERCISES];
const TAGS = new Map<string, readonly ExerciseTag[]>(SPECS.map((s) => [s[0], s[6]]));
const LOADS = new Map<string, LoadType>(SPECS.map((s) => [s[0], s[3]]));
const SWAPS: Record<string, readonly string[]> = {
  step_up: ['stair_climber_steady'],
  stair_climber_steady: ['step_up'],
  shadow_boxing: ['rowing_machine_steady'],
  rowing_machine_steady: ['shadow_boxing'],
  marching_in_place: ['stationary_bike_easy'],
  stationary_bike_easy: ['marching_in_place'],
};

export const CARDIO_LIBRARY: SessionLibrary = {
  ladders: FIXTURE_LADDERS,
  graph: createExerciseGraph(ALL, []),
  isHold: (id) => ['knee_plank', 'front_plank', 'dead_hang'].includes(id),
  loadType: (id) => LOADS.get(id) ?? (FIXTURE_EXERCISES.find((e) => e.id === id) ? (['goblet_squat', 'barbell_back_squat', 'one_arm_dumbbell_row', 'bent_over_dumbbell_row', 'barbell_row', 'kettlebell_deadlift', 'dumbbell_romanian_deadlift', 'barbell_romanian_deadlift', 'conventional_deadlift', 'dumbbell_floor_press', 'dumbbell_bench_press', 'barbell_bench_press'].includes(id) ? 'external' : 'bodyweight') : undefined),
  tags: (id) => TAGS.get(id) ?? [],
  cardio: {
    steady: ['stationary_bike_easy', 'elliptical_steady', 'rowing_machine_steady', 'treadmill_incline_walk', 'stair_climber_steady', 'brisk_walk', 'marching_in_place'],
    swaps: (id) => SWAPS[id] ?? [],
  },
};

/**
 * A logged-training history for the HIIT gate: a first session `weeks` weeks
 * (and an hour) before `nowMs`, then `perWeek` logged sessions (cardio blocks
 * that were run) in each of the last `weeks` 7-day windows.
 */
export function trainedHistory(nowMs: number, weeks = 2, perWeek = 3): SessionHistoryEntry[] {
  const offsets = [weeks * 7 * DAY + 3_600_000];
  for (let w = weeks - 1; w >= 0; w--) for (let k = perWeek - 1; k >= 0; k--) offsets.push(w * 7 * DAY + DAY + Math.round((k * 5 * DAY) / Math.max(1, perWeek)));
  return offsets.map((o, i) => {
    const at = new Date(nowMs - o).toISOString();
    return { planId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, prescribedAt: at, startedAt: at, countsForProgression: false, exercises: [], cardioSeconds: 1200 };
  });
}
