import type { EquipmentId, Exercise, MovementPattern, MuscleId } from '@fitadapt/shared';

/** Lower-case, accents removed, punctuation folded to spaces: "Pompe inclinée" → "pompe inclinee". */
export function normaliseSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface ExerciseFilter {
  /** Free text matched against the exercise name in the reader's language. */
  readonly text?: string;
  readonly pattern?: MovementPattern;
  /** Matches primary or secondary muscles (primary only with `primaryMuscleOnly`). */
  readonly muscle?: MuscleId;
  readonly primaryMuscleOnly?: boolean;
  /** Only exercises doable with this equipment (every requirement group satisfied). */
  readonly equipment?: readonly EquipmentId[];
}

export function doableWith(exercise: Exercise, equipment: readonly EquipmentId[]): boolean {
  const have = new Set(equipment);
  return exercise.equipment.every((g) => g.anyOf.some((id) => have.has(id)));
}

/**
 * In-memory search and filter (API, coach portal, tests). The device runs the
 * same filters in SQLite (apps/mobile/src/library). `nameOf` returns the
 * translated name for the reader's locale. Results are sorted by name.
 */
export function searchExercises(exercises: readonly Exercise[], filter: ExerciseFilter, nameOf: (e: Exercise) => string): Exercise[] {
  const words = filter.text ? normaliseSearchText(filter.text).split(' ').filter(Boolean) : [];
  return exercises
    .filter((e) => !filter.pattern || e.pattern === filter.pattern)
    .filter((e) => !filter.muscle || e.primaryMuscles.includes(filter.muscle) || (!filter.primaryMuscleOnly && e.secondaryMuscles.includes(filter.muscle)))
    .filter((e) => !filter.equipment || doableWith(e, filter.equipment))
    .filter((e) => {
      if (words.length === 0) return true;
      const name = normaliseSearchText(nameOf(e));
      return words.every((w) => name.includes(w));
    })
    .map((e) => ({ e, name: nameOf(e) }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.e.id < b.e.id ? -1 : 1))
    .map(({ e }) => e);
}
