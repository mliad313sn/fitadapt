import type { ExerciseTag, LoadType, MovementPattern } from '@fitadapt/shared';
import type { AssessmentLadder, CapacityLibrary } from '../assessment/capacity.js';
import type { ExerciseGraph } from '../substitution.js';

/**
 * The part of the M06 library the session generator reads (data, not I/O):
 * the graph (patterns, skill, joint loads, equipment, substitutes), the
 * variant ladders, and per-exercise facts. packages/exercise-library binds it
 * to the reviewed seed; tests use a fictional one.
 */
export interface SessionLibrary extends CapacityLibrary {
  readonly graph: ExerciseGraph;
  readonly loadType: (exerciseId: string) => LoadType | undefined;
  /** M06 tags (e.g. eccentric_focus → slow eccentric tempo, calisthenics_skill). Absent → no tags. */
  readonly tags?: (exerciseId: string) => readonly ExerciseTag[];
  /** %-bodyweight coefficient of a bodyweight variant (M06 config value, validated:false). Absent → unknown. */
  readonly bodyweightLoad?: (exerciseId: string) => number | null;
  /** M05: warm-up / cool-down drills that prepare a movement pattern (M06 content, best first). Absent → the pattern's warm_up/mobility exercises. */
  readonly warmUpDrills?: (pattern: MovementPattern) => readonly string[];
}

export const tagsOf = (library: SessionLibrary, id: string): readonly ExerciseTag[] => library.tags?.(id) ?? [];

/** The first ladder (in library order) containing an exercise, with its step. */
export function ladderOf(library: SessionLibrary, exerciseId: string, preferred: string | null = null): { ladder: AssessmentLadder; step: number } | null {
  const ordered = preferred ? [...library.ladders.filter((l) => l.id === preferred), ...library.ladders.filter((l) => l.id !== preferred)] : library.ladders;
  for (const ladder of ordered) {
    const step = ladder.steps.findIndex((s) => s.includes(exerciseId));
    if (step >= 0) return { ladder, step };
  }
  return null;
}
