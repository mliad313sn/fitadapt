/**
 * M03 cardio seed content (draft by the engineer, NOT expert-validated:
 * awaiting seat A3 (S&C coach) and A2 (physiotherapist) review,
 * docs/status/M03.md):
 * - STEADY_MODALITIES: the steady-state modalities the engine prefers, in
 *   order (machines first — supported and low impact — then walking);
 * - VENUE_SWAPS: pairs that keep a similar conditioning stimulus when the
 *   place changes (spec: step-ups ↔ stair climber, shadow boxing ↔ rower,
 *   marching ↔ bike; plus incline walk ↔ brisk walk, elliptical ↔ bike).
 */
export const STEADY_MODALITIES: readonly string[] = Object.freeze([
  'stationary_bike_easy',
  'elliptical_steady',
  'rowing_machine_steady',
  'treadmill_incline_walk',
  'stair_climber_steady',
  'brisk_walk',
  'marching_in_place',
]);

const PAIRS: readonly (readonly [string, string])[] = [
  ['step_up', 'stair_climber_steady'],
  ['shadow_boxing', 'rowing_machine_steady'],
  ['marching_in_place', 'stationary_bike_easy'],
  ['brisk_walk', 'treadmill_incline_walk'],
  ['elliptical_steady', 'stationary_bike_easy'],
];

export const VENUE_SWAPS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  PAIRS.reduce<Record<string, string[]>>((acc, [a, b]) => {
    (acc[a] ??= []).push(b);
    (acc[b] ??= []).push(a);
    return acc;
  }, {}),
);
