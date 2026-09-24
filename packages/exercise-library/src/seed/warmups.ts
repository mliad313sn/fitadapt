import type { MovementPattern } from '@fitadapt/shared';

/**
 * M05 warm-up and cool-down drills per movement pattern (seed content, best
 * first): the gentle mobility and activation exercises of the seed that
 * prepare each pattern. The engine picks among them what the person may do
 * today (equipment, SafetyProfile, S2, no high joint load) and what fits
 * the warm-up minutes. The lists are the engineer's draft from the seed's
 * own tags and patterns — NOT expert-validated: awaiting seat A2
 * (physiotherapist) and seat A3 (S&C coach), docs/status/M05.md.
 */
export const WARM_UP_DRILLS: Readonly<Record<MovementPattern, readonly string[]>> = Object.freeze({
  squat: ['knee_to_wall_ankle_rock', 'half_kneeling_hip_flexor_stretch', 'mini_band_lateral_walk', 'lunge_with_rotation'],
  lunge: ['half_kneeling_hip_flexor_stretch', 'knee_to_wall_ankle_rock', 'supported_standing_march', 'lunge_with_rotation'],
  hinge: ['hip_hinge_drill', 'cat_camel', 'bird_dog'],
  horizontal_push: ['open_book_rotation', 'band_external_rotation', 'band_pass_through'],
  vertical_push: ['band_pass_through', 'open_book_rotation', 'band_external_rotation'],
  horizontal_pull: ['band_pull_apart', 'open_book_rotation', 'prone_y_t_raise'],
  vertical_pull: ['band_face_pull', 'floor_w_raise', 'prone_floor_pulldown', 'open_book_rotation'],
  carry: ['bird_dog', 'supported_standing_march'],
  core: ['dead_bug', 'bird_dog', 'cat_camel'],
  isolation: ['band_external_rotation', 'open_book_rotation'],
  balance: ['supported_standing_march', 'weight_shift', 'knee_to_wall_ankle_rock'],
  mobility: ['cat_camel', 'open_book_rotation', 'half_kneeling_hip_flexor_stretch'],
  locomotion: ['knee_to_wall_ankle_rock', 'supported_standing_march', 'half_kneeling_hip_flexor_stretch'],
});
