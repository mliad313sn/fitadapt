/**
 * Test-only fictional library for the M05 recovery tests (not built into
 * dist): the M02 session fixture plus a few gentle warm-up, mobility and
 * general-movement drills and a per-pattern drill list, so the warm-up,
 * cool-down and mobility-session rules can be exercised without the seed.
 * packages/exercise-library re-runs them on the real seed.
 */
import type { CapacityModel, ExerciseTag, MovementPattern } from '@fitadapt/shared';
import { buildCapacityModel } from '../assessment/index.js';
import { FIXTURE_LIBRARY } from './library.js';
import type { SessionLibrary } from '../session/library.js';
import { createExerciseGraph, type GraphExercise } from '../substitution.js';
import { SESSION_EXERCISES, SESSION_LIBRARY } from './session.js';

const allLow = { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'low', knee: 'low', ankle: 'low' } as const;

const DRILLS: (GraphExercise & { tags: ExerciseTag[] })[] = [
  { id: 'marching_in_place', pattern: 'locomotion', skill: 'entry', impact: 'low', jointLoad: allLow, equipment: [], contraindications: [], tags: ['warm_up', 'conditioning', 'low_impact'] },
  { id: 'step_jack', pattern: 'locomotion', skill: 'entry', impact: 'low', jointLoad: { ...allLow, knee: 'medium' }, equipment: [], contraindications: [], tags: ['warm_up', 'conditioning'] },
  { id: 'ankle_rock', pattern: 'mobility', skill: 'entry', impact: 'none', jointLoad: { ...allLow, knee: 'medium', ankle: 'medium' }, equipment: [], contraindications: [], tags: ['mobility', 'warm_up'] },
  { id: 'cat_camel', pattern: 'mobility', skill: 'entry', impact: 'none', jointLoad: { ...allLow, wrist: 'medium' }, equipment: [], contraindications: ['floor_transfer'], tags: ['mobility', 'warm_up'] },
  { id: 'open_book', pattern: 'mobility', skill: 'entry', impact: 'none', jointLoad: { ...allLow, shoulder: 'medium' }, equipment: [], contraindications: [], tags: ['mobility', 'warm_up'] },
  { id: 'band_pull_apart', pattern: 'horizontal_pull', skill: 'entry', impact: 'none', jointLoad: { ...allLow, shoulder: 'medium' }, equipment: [{ anyOf: ['resistance_band'] }], contraindications: [], tags: ['warm_up'] },
  { id: 'deep_squat_hold', pattern: 'mobility', skill: 'beginner', impact: 'none', jointLoad: { ...allLow, knee: 'high' }, equipment: [], contraindications: [], tags: ['mobility'] },
];

export const WARMUP_LISTS: Record<MovementPattern, readonly string[]> = {
  squat: ['ankle_rock', 'deep_squat_hold', 'cat_camel'],
  lunge: ['ankle_rock', 'cat_camel'],
  hinge: ['cat_camel', 'hip_hinge_drill'],
  horizontal_push: ['open_book'],
  vertical_push: ['open_book'],
  horizontal_pull: ['band_pull_apart', 'open_book'],
  vertical_pull: ['open_book'],
  carry: ['cat_camel'],
  core: ['dead_bug', 'cat_camel'],
  isolation: ['open_book'],
  balance: ['ankle_rock'],
  mobility: ['cat_camel', 'open_book'],
  locomotion: ['ankle_rock'],
};

const drillTags = new Map(DRILLS.map((d) => [d.id, d.tags]));

export const RECOVERY_LIBRARY: SessionLibrary = {
  ...SESSION_LIBRARY,
  loadType: (id) => (drillTags.has(id) ? (id === 'band_pull_apart' ? 'band' : 'none') : SESSION_LIBRARY.loadType(id)),
  tags: (id) => drillTags.get(id) ?? SESSION_LIBRARY.tags!(id),
  graph: createExerciseGraph(
    [...SESSION_EXERCISES, ...DRILLS.map(({ tags: _tags, ...ex }) => ex)],
    // The M02 fixture's SUBSTITUTES edges, unchanged.
    [...SESSION_LIBRARY.graph.substitutes].flatMap(([from, list]) => list.map((n) => ({ type: 'SUBSTITUTES', from, to: n.to, similarity: n.similarity, validated: false, source: 'fixture' }) as never)),
  ),
  warmUpDrills: (pattern) => WARMUP_LISTS[pattern],
};

/** The same library without a drill list (the engine falls back to the pattern's warm_up/mobility exercises). */
const { warmUpDrills: _lists, ...withoutLists } = RECOVERY_LIBRARY;
export const RECOVERY_LIBRARY_NO_LISTS: SessionLibrary = withoutLists;

/** A fictional gym starting-point check (loads known, so sessions prescribe loads and ramp-up sets). */
export const GYM_CAPACITY: CapacityModel = buildCapacityModel(
  {
    protocolId: 'gym',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: '2026-09-23T17:00:00.000Z',
    completedAt: '2026-09-23T17:30:00.000Z',
    tests: [
      { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 100, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 70, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 50, reps: 10, rir: 2, seconds: null },
      { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 60, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 80, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 45, rir: null },
    ],
  },
  FIXTURE_LIBRARY,
);
