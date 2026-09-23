/**
 * M06 exercise wording (names, coaching cues, common mistakes), FR and EN side
 * by side. Original text written for the company for the MVP seed; not copied
 * from any book, site or dataset. Seed content, NOT expert-validated: every
 * exercise awaits review by seat A2 (physiotherapist) and A3 (S&C coach)
 * (docs/status/M06.md). Flattened into `exercise.<id>.name`,
 * `exercise.<id>.cue.<n>` and `exercise.<id>.mistake.<n>` keys.
 */
export interface ExerciseWording {
  readonly name: string;
  readonly cues: readonly string[];
  readonly mistakes: readonly string[];
}

export interface ExerciseText {
  readonly en: ExerciseWording;
  readonly fr: ExerciseWording;
}
