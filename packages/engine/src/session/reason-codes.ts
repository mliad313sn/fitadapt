import { JOINTS, MOVEMENT_PATTERNS } from '@fitadapt/shared';
import { M05_REASON_PARAMS } from '../recovery/reason-codes.js';

/**
 * Every reason code the M02 session generator, progression and execution
 * rules emit, with the parameters its FR/EN sentence needs
 * (packages/i18n `engine.reason.<code>`). A test renders every code in both
 * languages with those parameters, and another checks that every set of
 * many generated plans carries the parameters its codes need.
 */
export const M02_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Plan level
  'session.program.from_program': [],
  'session.program.deload_week': [],
  'session.program.transition_week': [],
  'session.program.shifted': [],
  'session.program.merged': [],
  'session.switcher.place_changed': [],
  'session.readiness.reduced': [],
  'session.readiness.accessory_dropped': [],
  'session.conditioning.intervals_not_allowed': [],
  'session.conditioning.steady_finisher': [],
  'session.conditioning.steady_session': [],
  'session.conditioning.intervals_finisher': [],
  'session.conditioning.intervals_session': [],
  'session.time.accessory_sets_trimmed': [],
  'session.time.superset': [],
  'session.time.warmup_shortened': [],
  'session.time.conditioning_shortened': [],
  'session.time.finisher_dropped': [],
  'session.time.secondary_sets_trimmed': [],
  'session.time.accessory_dropped': [],
  'session.time.primary_sets_trimmed': [],
  'session.time.exercise_dropped': [],
  'session.unavailable.no_time': [],
  'session.unavailable.s7_age': [],
  'session.unavailable.s3_intensity_locked': [],
  'session.unavailable.clock_mismatch': [],
  'session.unavailable.no_program': [],
  ...Object.fromEntries(MOVEMENT_PATTERNS.map((p) => [`session.slot_dropped.${p}`, []])),
  // Exercise choice
  'session.exercise.continued': [],
  'session.exercise.from_program': [],
  'session.exercise.next_variant': [],
  'session.exercise.easier_variant': [],
  'session.exercise.swapped': [],
  'session.exercise.swapped_pain': [],
  'session.switcher.mapped': [],
  ...Object.fromEntries(JOINTS.map((j) => [`session.exercise.s2_substituted.${j}`, []])),
  'session.slot.primary': [],
  'session.slot.secondary': [],
  'session.slot.accessory': [],
  // Progression ("why this load")
  'session.progression.start': [],
  'session.progression.load_increased': ['deltaKg', 'sets', 'reps', 'rir'],
  'session.progression.load_held': ['max'],
  'session.progression.incomplete': ['max'],
  'session.progression.load_held_steps_unknown': ['loadKg'],
  'session.progression.load_reduced': ['deltaKg', 'min', 'sessions'],
  'session.progression.load_reduced_effort': ['deltaKg'],
  'session.progression.equipment_max': ['loadKg'],
  'session.progression.range_changed': ['min', 'max'],
  'session.progression.variant_up': ['reps', 'sessions'],
  'session.progression.variant_up_hold': ['heldSeconds', 'sessions'],
  'session.progression.variant_held': ['max'],
  'session.progression.variant_down': [],
  'session.progression.variant_down_effort': [],
  'session.progression.hold_longer': ['seconds', 'sessions'],
  'session.progression.hold_shorter': ['seconds'],
  'session.progression.hold_shorter_effort': ['seconds'],
  'session.progression.hold_held': ['seconds'],
  'session.progression.next_variant_unavailable': [],
  'session.progression.easier_variant_unavailable': [],
  'session.deload.no_progression': [],
  // Load, range, effort, rest, tempo
  'session.load.rounded': ['stepKg'],
  'session.load.bodyweight_share': ['percent'],
  'session.load.band_self_select': [],
  'session.rep_range.strength': ['min', 'max'],
  'session.rep_range.hypertrophy_primary': ['min', 'max'],
  'session.rep_range.hypertrophy': ['min', 'max'],
  'session.rep_range.general': ['min', 'max'],
  'session.rep_range.skill': ['min', 'max'],
  'session.rep_range.mobility': ['min', 'max'],
  'session.rep_range.from_assessment': ['min', 'max'],
  'session.rep_range.personal': ['min', 'max'],
  'session.hold.target': ['seconds'],
  'session.rir.target': ['rir'],
  'session.rir.deload': ['rir'],
  'session.rir.readiness_reduced': ['rir'],
  'session.effort.hold': ['rpe'],
  'session.tempo.eccentric': ['tempoSeconds'],
  'session.autoreg.load_reduced': ['deltaKg'],
});

export const M02_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M02_REASON_PARAMS));

/** Parameters a code's sentence needs (M07, M02 and M05 codes; unknown codes need none). */
export function reasonParamsFor(code: string): readonly string[] {
  return M02_REASON_PARAMS[code] ?? M05_REASON_PARAMS[code] ?? [];
}
