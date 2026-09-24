import type { EquipmentId, Exercise } from '@fitadapt/shared';
import { defineExercise, type ExerciseSpec } from './define.js';

/**
 * M06 MVP seed: structure of every exercise (pattern, muscles, equipment,
 * joint-load profile, impact, skill, %-bodyweight coefficient, tags).
 * Wording lives in packages/i18n/src/catalogues/exercises.
 *
 * Joint-load profiles are the author's classification for the seed (letters in
 * the order shoulder, elbow, wrist, lumbar, hip, knee, ankle). They are NOT
 * expert-validated: every entry awaits review by seat A2 (physiotherapist) for
 * joint loads, contraindication tags and substitutions, and by seat A3 (S&C)
 * for patterns, skill levels, ladders and coefficients (docs/status/M06.md).
 */

const BENCHLIKE: EquipmentId[] = ['flat_bench', 'adjustable_bench', 'sturdy_chair', 'box'];
const STEP: EquipmentId[] = ['box', 'aerobic_step', 'flat_bench', 'sturdy_chair'];
const ROW_BAR: EquipmentId[] = ['low_bar', 'gymnastic_rings', 'suspension_trainer', 'smith_machine', 'squat_rack'];
/** Band anchor at chest height. */
const ANCHOR: EquipmentId[] = ['door_anchor', 'squat_rack', 'low_bar', 'parallel_bars'];
/** Band anchor above head height. */
const HIGH_ANCHOR: EquipmentId[] = ['door_anchor', 'pull_up_bar', 'squat_rack'];
const HAND_WEIGHT: EquipmentId[] = ['dumbbell', 'kettlebell'];

const SPECS: Record<string, ExerciseSpec> = {
  // ---------------------------------------------------------------- horizontal push
  wall_push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], j: 'llmllll', sk: 'entry', lt: 'bodyweight', bw: [0.2, 'estimate'], t: ['low_impact', 'supported'] },
  incline_push_up_high: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], j: 'mlmllll', sk: 'entry', lt: 'bodyweight', bw: [0.3, 'estimate'], t: ['low_impact', 'supported'] },
  incline_push_up_low: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], eq: [BENCHLIKE], j: 'mmmllll', sk: 'beginner', lt: 'bodyweight', bw: [0.48, 'ebben_interpolated'], t: ['low_impact'] },
  knee_push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], j: 'mmmllml', sk: 'beginner', lt: 'bodyweight', bw: [0.49, 'ebben'], ci: ['floor_transfer'], t: ['low_impact'] },
  push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], j: 'mmhllll', sk: 'beginner', lt: 'bodyweight', bw: [0.64, 'ebben'], ci: ['floor_transfer', 'loaded_wrist_extension'] },
  decline_push_up: { p: 'horizontal_push', m: ['chest', 'front_delts'], s: ['triceps', 'deep_core'], eq: [STEP], j: 'hmhllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.74, 'ebben'], ci: ['floor_transfer', 'loaded_wrist_extension', 'inversion'] },
  diamond_push_up: { p: 'horizontal_push', m: ['triceps', 'chest'], s: ['front_delts', 'deep_core'], j: 'mhhllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.64, 'estimate'], ci: ['floor_transfer', 'loaded_wrist_extension'] },
  deficit_push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], eq: [['parallettes', 'dumbbell']], j: 'hmmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.66, 'estimate'], ci: ['floor_transfer', 'end_range_shoulder'] },
  archer_push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core'], j: 'hhhllll', sk: 'advanced', uni: true, lt: 'bodyweight', bw: [0.75, 'estimate'], ci: ['floor_transfer', 'loaded_wrist_extension'], t: ['calisthenics_skill'] },
  pseudo_planche_push_up: { p: 'horizontal_push', m: ['chest', 'front_delts'], s: ['triceps', 'deep_core'], j: 'hhhllll', sk: 'advanced', lt: 'bodyweight', bw: [0.75, 'estimate'], ci: ['floor_transfer', 'loaded_wrist_extension'], t: ['calisthenics_skill'] },
  ring_push_up: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts', 'deep_core', 'rotator_cuff'], eq: [['gymnastic_rings', 'suspension_trainer']], j: 'hmmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.64, 'estimate'], ci: ['floor_transfer'] },
  dumbbell_floor_press: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], eq: ['dumbbell'], j: 'mmmllll', sk: 'beginner', lt: 'external', ci: ['floor_transfer', 'supine_position'] },
  dumbbell_bench_press: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], eq: ['dumbbell', ['flat_bench', 'adjustable_bench']], j: 'mmmllll', sk: 'beginner', lt: 'external', ci: ['supine_position'] },
  barbell_bench_press: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], eq: ['barbell', 'flat_bench', 'squat_rack'], j: 'hmmllll', sk: 'intermediate', lt: 'external', ci: ['supine_position', 'breath_hold_bracing'] },
  band_chest_press: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band', t: ['low_impact'] },
  machine_chest_press: { p: 'horizontal_push', m: ['chest', 'triceps'], s: ['front_delts'], eq: ['chest_press_machine'], j: 'mmlllll', sk: 'entry', lt: 'machine', t: ['low_impact', 'supported'] },

  // ---------------------------------------------------------------- vertical push, dips
  hands_elevated_pike_push_up: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'traps'], j: 'mmmllll', sk: 'beginner', lt: 'bodyweight', bw: [0.35, 'estimate'], t: ['supported'] },
  pike_push_up: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'traps', 'chest'], j: 'hmhllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['inversion', 'loaded_wrist_extension'] },
  elevated_pike_push_up: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'traps', 'chest'], eq: [STEP], j: 'hmhllll', sk: 'advanced', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['inversion', 'loaded_wrist_extension', 'overhead_loading'] },
  wall_handstand_hold: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['traps', 'deep_core', 'side_delts'], j: 'hmhllll', sk: 'advanced', lt: 'bodyweight', bw: [0.9, 'estimate'], ci: ['inversion', 'loaded_wrist_extension', 'overhead_loading'], t: ['isometric', 'calisthenics_skill'] },
  seated_dumbbell_shoulder_press: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts'], eq: ['dumbbell', 'adjustable_bench'], j: 'hmlllll', sk: 'beginner', lt: 'external', ci: ['overhead_loading'], t: ['supported'] },
  half_kneeling_dumbbell_press: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'deep_core', 'obliques'], eq: ['dumbbell'], j: 'hmlllml', sk: 'beginner', uni: true, lt: 'external', ci: ['overhead_loading', 'floor_transfer'] },
  standing_dumbbell_press: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'deep_core'], eq: ['dumbbell'], j: 'hmlmlll', sk: 'beginner', lt: 'external', ci: ['overhead_loading'] },
  barbell_overhead_press: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts', 'deep_core', 'traps'], eq: ['barbell', 'squat_rack'], j: 'hmmmlll', sk: 'intermediate', lt: 'external', ci: ['overhead_loading', 'breath_hold_bracing'] },
  band_overhead_press: { p: 'vertical_push', m: ['front_delts', 'triceps'], s: ['side_delts'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band', ci: ['overhead_loading'] },
  bench_dip: { p: 'vertical_push', m: ['triceps'], s: ['chest', 'front_delts'], eq: [BENCHLIKE], j: 'hhmllll', sk: 'beginner', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['end_range_shoulder', 'loaded_wrist_extension'] },
  parallel_bar_support_hold: { p: 'vertical_push', m: ['triceps', 'chest'], s: ['front_delts', 'traps'], eq: ['parallel_bars'], j: 'mmmllll', sk: 'beginner', lt: 'bodyweight', bw: [0.95, 'estimate'], t: ['isometric'] },
  negative_dip: { p: 'vertical_push', m: ['triceps', 'chest'], s: ['front_delts'], eq: ['parallel_bars'], j: 'hhmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['end_range_shoulder'], t: ['eccentric_focus'] },
  parallel_bar_dip: { p: 'vertical_push', m: ['triceps', 'chest'], s: ['front_delts'], eq: ['parallel_bars'], j: 'hhmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['end_range_shoulder'] },
  ring_support_hold: { p: 'vertical_push', m: ['triceps', 'chest'], s: ['front_delts', 'rotator_cuff'], eq: ['gymnastic_rings'], j: 'hmmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], t: ['isometric', 'calisthenics_skill'] },
  ring_dip: { p: 'vertical_push', m: ['triceps', 'chest'], s: ['front_delts', 'rotator_cuff'], eq: ['gymnastic_rings'], j: 'hhmllll', sk: 'advanced', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['end_range_shoulder'], t: ['calisthenics_skill'] },

  // ---------------------------------------------------------------- horizontal pull
  seated_band_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band', ci: ['floor_transfer'], t: ['low_impact'] },
  one_arm_dumbbell_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts'], eq: ['dumbbell', BENCHLIKE], j: 'mmlllll', sk: 'beginner', uni: true, lt: 'external', t: ['supported'] },
  bent_over_dumbbell_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts', 'lower_back'], eq: ['dumbbell'], j: 'mmlmmll', sk: 'beginner', lt: 'external' },
  barbell_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts', 'lower_back'], eq: ['barbell'], j: 'mmlhmll', sk: 'intermediate', lt: 'external', ci: ['breath_hold_bracing'] },
  seated_cable_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts'], eq: ['cable_station'], j: 'mmlllll', sk: 'entry', lt: 'machine', t: ['supported'] },
  inverted_row_incline: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts', 'deep_core'], eq: [ROW_BAR], j: 'mmlllll', sk: 'beginner', lt: 'bodyweight', bw: [0.4, 'estimate'] },
  inverted_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts', 'deep_core'], eq: [ROW_BAR], j: 'mmlllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.6, 'estimate'] },
  ring_row: { p: 'horizontal_pull', m: ['lats', 'upper_back'], s: ['biceps', 'rear_delts', 'deep_core'], eq: [['gymnastic_rings', 'suspension_trainer']], j: 'mmlllll', sk: 'beginner', lt: 'bodyweight', bw: [0.5, 'estimate'] },
  band_face_pull: { p: 'horizontal_pull', m: ['rear_delts', 'rotator_cuff'], s: ['upper_back', 'traps'], eq: ['resistance_band', HIGH_ANCHOR], j: 'mllllll', sk: 'entry', lt: 'band', t: ['warm_up'] },
  band_pull_apart: { p: 'horizontal_pull', m: ['rear_delts', 'upper_back'], s: ['rotator_cuff', 'traps'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band', t: ['warm_up', 'low_impact'] },
  prone_y_t_raise: { p: 'horizontal_pull', m: ['rear_delts', 'traps'], s: ['upper_back', 'rotator_cuff', 'lower_back'], j: 'mllllll', sk: 'entry', lt: 'none', ci: ['prone_position', 'floor_transfer'], t: ['warm_up'] },

  // ---------------------------------------------------------------- vertical pull, hangs, muscle-up steps
  floor_w_raise: { p: 'horizontal_pull', m: ['upper_back', 'rear_delts'], s: ['lats', 'traps'], j: 'mllllll', sk: 'entry', lt: 'none', ci: ['prone_position', 'floor_transfer'], t: ['warm_up', 'low_impact'] },
  prone_floor_pulldown: { p: 'vertical_pull', m: ['lats'], s: ['rear_delts', 'upper_back', 'traps'], j: 'mllllll', sk: 'entry', lt: 'none', ci: ['prone_position', 'floor_transfer'], t: ['warm_up', 'low_impact'] },
  dead_hang: { p: 'vertical_pull', m: ['forearms', 'lats'], s: ['traps', 'rotator_cuff'], eq: [['pull_up_bar', 'gymnastic_rings']], j: 'mmmllll', sk: 'entry', lt: 'bodyweight', bw: [1, 'hang'], ci: ['hanging'], t: ['isometric'] },
  scapular_pull_up: { p: 'vertical_pull', m: ['lats', 'traps'], s: ['rotator_cuff', 'forearms'], eq: ['pull_up_bar'], j: 'mmmllll', sk: 'beginner', lt: 'bodyweight', bw: [1, 'hang'], ci: ['hanging'] },
  band_assisted_pull_up: { p: 'vertical_pull', m: ['lats', 'biceps'], s: ['upper_back', 'forearms', 'rear_delts'], eq: ['pull_up_bar', 'resistance_band'], j: 'mmmllll', sk: 'beginner', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['hanging'] },
  negative_pull_up: { p: 'vertical_pull', m: ['lats', 'biceps'], s: ['upper_back', 'forearms', 'rear_delts'], eq: ['pull_up_bar', STEP], j: 'hmmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['hanging'], t: ['eccentric_focus'] },
  pull_up: { p: 'vertical_pull', m: ['lats'], s: ['biceps', 'upper_back', 'forearms', 'rear_delts'], eq: ['pull_up_bar'], j: 'hmmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['hanging'] },
  chin_up: { p: 'vertical_pull', m: ['lats', 'biceps'], s: ['upper_back', 'forearms'], eq: ['pull_up_bar'], j: 'hhmllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['hanging'] },
  weighted_pull_up: { p: 'vertical_pull', m: ['lats'], s: ['biceps', 'upper_back', 'forearms', 'rear_delts'], eq: ['pull_up_bar', ['dumbbell', 'kettlebell', 'weight_plate']], j: 'hhmllll', sk: 'advanced', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['hanging'] },
  lat_pulldown: { p: 'vertical_pull', m: ['lats'], s: ['biceps', 'upper_back'], eq: ['lat_pulldown'], j: 'mmlllll', sk: 'entry', lt: 'machine', t: ['supported'] },
  assisted_pull_up_machine: { p: 'vertical_pull', m: ['lats', 'biceps'], s: ['upper_back', 'forearms'], eq: ['assisted_pull_up_machine'], j: 'mmmllll', sk: 'entry', lt: 'machine', t: ['supported'] },
  band_lat_pulldown: { p: 'vertical_pull', m: ['lats'], s: ['biceps', 'upper_back'], eq: ['resistance_band', HIGH_ANCHOR], j: 'mllllml', sk: 'entry', lt: 'band', ci: ['floor_transfer'] },
  high_pull_up: { p: 'vertical_pull', m: ['lats', 'upper_back'], s: ['biceps', 'forearms', 'chest'], eq: ['pull_up_bar'], j: 'hhmllll', sk: 'advanced', lt: 'bodyweight', bw: [0.95, 'estimate'], ci: ['hanging'], t: ['calisthenics_skill'] },
  ring_false_grip_hang: { p: 'vertical_pull', m: ['forearms', 'lats'], s: ['biceps'], eq: ['gymnastic_rings'], j: 'mmhllll', sk: 'advanced', lt: 'bodyweight', bw: [1, 'hang'], ci: ['hanging'], t: ['isometric', 'calisthenics_skill'] },
  low_ring_muscle_up_transition: { p: 'vertical_pull', m: ['lats', 'chest', 'triceps'], s: ['forearms', 'front_delts'], eq: ['gymnastic_rings'], j: 'hhhllll', sk: 'advanced', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['end_range_shoulder'], t: ['calisthenics_skill'] },
  negative_muscle_up: { p: 'vertical_pull', m: ['lats', 'chest', 'triceps'], s: ['forearms', 'front_delts'], eq: [['pull_up_bar', 'gymnastic_rings']], j: 'hhhllll', sk: 'expert', lt: 'bodyweight', bw: [1, 'estimate'], ci: ['hanging', 'end_range_shoulder'], t: ['eccentric_focus', 'calisthenics_skill'] },
  bar_muscle_up: { p: 'vertical_pull', m: ['lats', 'chest', 'triceps'], s: ['forearms', 'front_delts', 'abs'], eq: ['pull_up_bar'], j: 'hhhllll', sk: 'expert', lt: 'bodyweight', bw: [1, 'estimate'], ci: ['hanging', 'end_range_shoulder'], t: ['calisthenics_skill'] },
  ring_muscle_up: { p: 'vertical_pull', m: ['lats', 'chest', 'triceps'], s: ['forearms', 'front_delts', 'abs'], eq: ['gymnastic_rings'], j: 'hhhllll', sk: 'expert', lt: 'bodyweight', bw: [1, 'estimate'], ci: ['hanging', 'end_range_shoulder'], t: ['calisthenics_skill'] },

  // ---------------------------------------------------------------- squat
  box_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_adductors', 'deep_core'], eq: [BENCHLIKE], j: 'llllmml', sk: 'entry', lt: 'bodyweight', bw: [0.7, 'estimate'], t: ['low_impact', 'supported'] },
  air_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_adductors', 'deep_core'], j: 'llllmmm', sk: 'beginner', lt: 'bodyweight', bw: [0.7, 'estimate'], t: ['low_impact'] },
  goblet_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_adductors', 'deep_core', 'upper_back'], eq: [HAND_WEIGHT], j: 'lmlmmmm', sk: 'beginner', lt: 'external', t: ['low_impact'] },
  barbell_back_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_adductors', 'lower_back', 'deep_core'], eq: ['barbell', 'squat_rack'], j: 'mlmhhhm', sk: 'intermediate', lt: 'external', ci: ['breath_hold_bracing', 'deep_knee_flexion'] },
  leg_press: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_adductors'], eq: ['leg_press'], j: 'lllmmhl', sk: 'entry', lt: 'machine', t: ['low_impact', 'supported'] },
  // A1/A2 pre-review (joint loads): a deep wall sit loads the patellofemoral joint heavily → knee H (stricter; seat A2).
  wall_sit: { p: 'squat', m: ['quads'], s: ['glutes'], j: 'lllllhl', sk: 'beginner', lt: 'bodyweight', bw: [0.5, 'estimate'], t: ['isometric', 'low_impact', 'supported'] },
  cossack_squat: { p: 'squat', m: ['hip_adductors', 'quads', 'glutes'], s: ['hamstrings'], j: 'lllmhhm', sk: 'intermediate', uni: true, lt: 'bodyweight', bw: [0.7, 'estimate'], ci: ['deep_knee_flexion'], t: ['mobility'] },
  assisted_pistol_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_abductors', 'deep_core'], j: 'lllmmhm', sk: 'intermediate', uni: true, lt: 'bodyweight', bw: [0.8, 'estimate'], ci: ['deep_knee_flexion'], t: ['supported'] },
  box_pistol_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_abductors', 'deep_core'], eq: [BENCHLIKE], j: 'lllmmhm', sk: 'advanced', uni: true, lt: 'bodyweight', bw: [0.85, 'estimate'], ci: ['high_balance_demand'], t: ['calisthenics_skill'] },
  pistol_squat: { p: 'squat', m: ['quads', 'glutes'], s: ['hip_abductors', 'deep_core', 'calves'], j: 'lllmmhh', sk: 'expert', uni: true, lt: 'bodyweight', bw: [0.9, 'estimate'], ci: ['deep_knee_flexion', 'high_balance_demand'], t: ['calisthenics_skill'] },
  squat_jump: { p: 'squat', m: ['quads', 'glutes'], s: ['calves'], j: 'llllmhh', imp: 'high', sk: 'intermediate', lt: 'bodyweight', bw: [0.7, 'estimate'], ci: ['jumping_landing'], t: ['conditioning'] },

  // ---------------------------------------------------------------- lunge
  split_squat: { p: 'lunge', m: ['quads', 'glutes'], s: ['hip_adductors', 'hamstrings'], j: 'llllmmm', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.7, 'estimate'] },
  reverse_lunge: { p: 'lunge', m: ['quads', 'glutes'], s: ['hamstrings', 'hip_adductors'], j: 'llllmmm', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.7, 'estimate'] },
  supported_reverse_lunge: { p: 'lunge', m: ['quads', 'glutes'], s: ['hamstrings', 'hip_adductors'], j: 'llllmml', sk: 'entry', uni: true, lt: 'bodyweight', bw: [0.6, 'estimate'], t: ['supported', 'low_impact', 'balance'] },
  dumbbell_reverse_lunge: { p: 'lunge', m: ['quads', 'glutes'], s: ['hamstrings', 'hip_adductors', 'forearms'], eq: ['dumbbell'], j: 'lmlmmmm', sk: 'beginner', uni: true, lt: 'external' },
  walking_lunge: { p: 'lunge', m: ['quads', 'glutes'], s: ['hamstrings', 'hip_adductors', 'calves'], j: 'llllmmm', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.7, 'estimate'], ci: ['high_balance_demand'] },
  bulgarian_split_squat: { p: 'lunge', m: ['quads', 'glutes'], s: ['hip_adductors', 'hamstrings'], eq: [BENCHLIKE], j: 'llllmhm', sk: 'intermediate', uni: true, lt: 'bodyweight', bw: [0.8, 'estimate'], ci: ['deep_knee_flexion', 'high_balance_demand'] },
  step_up: { p: 'lunge', m: ['quads', 'glutes'], s: ['hamstrings', 'calves'], eq: [STEP], j: 'llllmmm', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.8, 'estimate'], t: ['low_impact'] },
  low_step_up: { p: 'lunge', m: ['quads', 'glutes'], s: ['calves', 'hip_abductors'], j: 'lllllml', sk: 'entry', uni: true, lt: 'bodyweight', bw: [0.8, 'estimate'], t: ['low_impact', 'supported', 'balance'] },
  lateral_lunge: { p: 'lunge', m: ['hip_adductors', 'quads', 'glutes'], s: ['hamstrings'], j: 'llllmmm', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.7, 'estimate'] },

  // ---------------------------------------------------------------- hinge
  glute_bridge: { p: 'hinge', m: ['glutes'], s: ['hamstrings', 'deep_core'], j: 'llllmll', sk: 'entry', lt: 'bodyweight', bw: [0.4, 'estimate'], ci: ['floor_transfer', 'supine_position'], t: ['low_impact'] },
  single_leg_glute_bridge: { p: 'hinge', m: ['glutes'], s: ['hamstrings', 'deep_core'], j: 'llllmll', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.55, 'estimate'], ci: ['floor_transfer', 'supine_position'], t: ['low_impact'] },
  hip_thrust_bodyweight: { p: 'hinge', m: ['glutes'], s: ['hamstrings', 'quads'], eq: [BENCHLIKE], j: 'llllmml', sk: 'beginner', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['floor_transfer'], t: ['low_impact'] },
  dumbbell_hip_thrust: { p: 'hinge', m: ['glutes'], s: ['hamstrings', 'quads'], eq: ['dumbbell', BENCHLIKE], j: 'lllmhml', sk: 'beginner', lt: 'external', ci: ['floor_transfer'], t: ['low_impact'] },
  hip_hinge_drill: { p: 'hinge', m: ['hamstrings', 'glutes'], s: ['lower_back'], j: 'lllmmll', sk: 'entry', lt: 'none', t: ['warm_up', 'low_impact'] },
  kettlebell_deadlift: { p: 'hinge', m: ['glutes', 'hamstrings'], s: ['quads', 'lower_back', 'forearms'], eq: [HAND_WEIGHT], j: 'lllmmml', sk: 'entry', lt: 'external', t: ['low_impact'] },
  dumbbell_romanian_deadlift: { p: 'hinge', m: ['hamstrings', 'glutes'], s: ['lower_back', 'forearms', 'upper_back'], eq: ['dumbbell'], j: 'lmlmmll', sk: 'beginner', lt: 'external' },
  barbell_romanian_deadlift: { p: 'hinge', m: ['hamstrings', 'glutes'], s: ['lower_back', 'forearms', 'upper_back'], eq: ['barbell'], j: 'lmlhhll', sk: 'intermediate', lt: 'external', ci: ['breath_hold_bracing'] },
  conventional_deadlift: { p: 'hinge', m: ['hamstrings', 'glutes', 'lower_back'], s: ['quads', 'forearms', 'traps', 'upper_back'], eq: ['barbell', 'weight_plate'], j: 'mmmhhml', sk: 'intermediate', lt: 'external', ci: ['breath_hold_bracing'] },
  kettlebell_swing: { p: 'hinge', m: ['glutes', 'hamstrings'], s: ['lower_back', 'deep_core', 'forearms'], eq: ['kettlebell'], j: 'mmlhhll', imp: 'low', sk: 'intermediate', lt: 'external', t: ['conditioning'] },
  single_leg_rdl_bodyweight: { p: 'hinge', m: ['hamstrings', 'glutes'], s: ['hip_abductors', 'deep_core'], j: 'lllmmlm', sk: 'intermediate', uni: true, lt: 'bodyweight', bw: [0.3, 'estimate'], ci: ['high_balance_demand'], t: ['balance'] },
  single_leg_rdl_dumbbell: { p: 'hinge', m: ['hamstrings', 'glutes'], s: ['hip_abductors', 'deep_core', 'forearms'], eq: ['dumbbell'], j: 'lmlmmlm', sk: 'intermediate', uni: true, lt: 'external', ci: ['high_balance_demand'], t: ['balance'] },
  nordic_curl_eccentric: { p: 'hinge', m: ['hamstrings'], s: ['glutes', 'calves'], j: 'llllmhl', sk: 'advanced', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['floor_transfer'], t: ['eccentric_focus'] },
  sliding_leg_curl: { p: 'hinge', m: ['hamstrings'], s: ['glutes', 'calves'], j: 'lllmmml', sk: 'intermediate', lt: 'bodyweight', bw: [0.4, 'estimate'], ci: ['floor_transfer', 'supine_position'] },
  machine_leg_curl: { p: 'hinge', m: ['hamstrings'], s: ['calves'], eq: ['leg_curl_machine'], j: 'lllllml', sk: 'entry', lt: 'machine', t: ['supported'] },
  prone_back_extension: { p: 'hinge', m: ['lower_back', 'glutes'], s: ['hamstrings', 'upper_back'], j: 'lllmlll', sk: 'beginner', lt: 'none', ci: ['prone_position', 'floor_transfer'] },

  // ---------------------------------------------------------------- core
  dead_bug: { p: 'core', m: ['deep_core', 'abs'], s: ['hip_flexors'], j: 'lllllll', sk: 'entry', lt: 'none', ci: ['floor_transfer', 'supine_position'], t: ['low_impact', 'warm_up'] },
  bird_dog: { p: 'core', m: ['deep_core', 'lower_back'], s: ['glutes', 'rear_delts'], j: 'llmllml', sk: 'entry', lt: 'none', ci: ['floor_transfer'], t: ['low_impact', 'warm_up', 'balance'] },
  knee_plank: { p: 'core', m: ['deep_core', 'abs'], s: ['front_delts'], j: 'mllllml', sk: 'entry', lt: 'bodyweight', bw: [0.35, 'estimate'], ci: ['floor_transfer'], t: ['isometric', 'low_impact'] },
  front_plank: { p: 'core', m: ['deep_core', 'abs'], s: ['front_delts', 'glutes'], j: 'mllmlll', sk: 'beginner', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['floor_transfer'], t: ['isometric', 'low_impact'] },
  side_plank_knees: { p: 'core', m: ['obliques'], s: ['deep_core', 'hip_abductors'], j: 'mllllml', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [0.3, 'estimate'], ci: ['floor_transfer'], t: ['isometric', 'low_impact'] },
  side_plank: { p: 'core', m: ['obliques'], s: ['deep_core', 'hip_abductors'], j: 'mllllll', sk: 'intermediate', uni: true, lt: 'bodyweight', bw: [0.4, 'estimate'], ci: ['floor_transfer'], t: ['isometric'] },
  hollow_body_tuck: { p: 'core', m: ['abs', 'deep_core'], s: ['hip_flexors'], j: 'lllmlll', sk: 'beginner', lt: 'none', ci: ['floor_transfer', 'supine_position'], t: ['isometric'] },
  hollow_body_hold: { p: 'core', m: ['abs', 'deep_core'], s: ['hip_flexors'], j: 'lllmlll', sk: 'intermediate', lt: 'none', ci: ['floor_transfer', 'supine_position'], t: ['isometric', 'calisthenics_skill'] },
  ab_wheel_kneeling: { p: 'core', m: ['abs', 'deep_core'], s: ['lats', 'front_delts'], eq: ['ab_wheel'], j: 'mllhlml', sk: 'intermediate', lt: 'bodyweight', bw: [0.5, 'estimate'], ci: ['floor_transfer'] },
  hanging_knee_raise: { p: 'core', m: ['abs', 'hip_flexors'], s: ['forearms', 'lats'], eq: ['pull_up_bar'], j: 'mmmmlll', sk: 'intermediate', lt: 'none', ci: ['hanging'] },
  hanging_leg_raise: { p: 'core', m: ['abs', 'hip_flexors'], s: ['forearms', 'lats'], eq: ['pull_up_bar'], j: 'mmmmlll', sk: 'advanced', lt: 'none', ci: ['hanging'] },
  toes_to_bar: { p: 'core', m: ['abs', 'hip_flexors'], s: ['forearms', 'lats'], eq: ['pull_up_bar'], j: 'hmmmlll', sk: 'expert', lt: 'none', ci: ['hanging'], t: ['calisthenics_skill'] },
  tuck_l_sit: { p: 'core', m: ['abs', 'hip_flexors'], s: ['triceps', 'deep_core'], j: 'mmhllll', sk: 'intermediate', lt: 'bodyweight', bw: [0.9, 'estimate'], ci: ['loaded_wrist_extension', 'floor_transfer'], t: ['isometric', 'calisthenics_skill'] },
  l_sit: { p: 'core', m: ['abs', 'hip_flexors'], s: ['triceps', 'deep_core'], eq: [['parallettes', 'parallel_bars']], j: 'mmmllll', sk: 'advanced', lt: 'bodyweight', bw: [0.95, 'estimate'], t: ['isometric', 'calisthenics_skill'] },
  band_pallof_press: { p: 'core', m: ['obliques', 'deep_core'], s: ['abs'], eq: ['resistance_band', ANCHOR], j: 'mllllll', sk: 'entry', lt: 'band', t: ['low_impact'] },

  // ---------------------------------------------------------------- carry
  farmer_carry: { p: 'carry', m: ['forearms', 'traps'], s: ['deep_core', 'glutes', 'obliques'], eq: [HAND_WEIGHT], j: 'mmmmlll', imp: 'low', sk: 'beginner', lt: 'external', t: ['low_impact'] },
  suitcase_carry: { p: 'carry', m: ['obliques', 'forearms'], s: ['deep_core', 'traps'], eq: [HAND_WEIGHT], j: 'mmmmlll', imp: 'low', sk: 'beginner', uni: true, lt: 'external', t: ['low_impact'] },

  // ---------------------------------------------------------------- isolation
  dumbbell_curl: { p: 'isolation', m: ['biceps'], s: ['forearms'], eq: ['dumbbell'], j: 'lmlllll', sk: 'entry', lt: 'external' },
  band_curl: { p: 'isolation', m: ['biceps'], s: ['forearms'], eq: ['resistance_band'], j: 'lmlllll', sk: 'entry', lt: 'band' },
  band_triceps_pushdown: { p: 'isolation', m: ['triceps'], eq: ['resistance_band', HIGH_ANCHOR], j: 'lmlllll', sk: 'entry', lt: 'band' },
  cable_triceps_pushdown: { p: 'isolation', m: ['triceps'], eq: ['cable_station'], j: 'lmlllll', sk: 'entry', lt: 'machine' },
  dumbbell_overhead_triceps_extension: { p: 'isolation', m: ['triceps'], eq: ['dumbbell'], j: 'mmlllll', sk: 'beginner', lt: 'external', ci: ['overhead_loading'] },
  wall_triceps_press: { p: 'isolation', m: ['triceps'], s: ['chest'], j: 'lmlllll', sk: 'entry', lt: 'bodyweight', bw: [0.2, 'estimate'], t: ['low_impact', 'supported'] },
  dumbbell_lateral_raise: { p: 'isolation', m: ['side_delts'], s: ['traps'], eq: ['dumbbell'], j: 'mllllll', sk: 'entry', lt: 'external' },
  band_lateral_raise: { p: 'isolation', m: ['side_delts'], s: ['traps'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band' },
  dumbbell_reverse_fly: { p: 'isolation', m: ['rear_delts', 'upper_back'], s: ['traps'], eq: ['dumbbell'], j: 'mllmlll', sk: 'beginner', lt: 'external' },
  band_external_rotation: { p: 'isolation', m: ['rotator_cuff'], s: ['rear_delts'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'band', t: ['warm_up'] },
  calf_raise: { p: 'isolation', m: ['calves'], j: 'llllllm', sk: 'entry', lt: 'bodyweight', bw: [1, 'estimate'], t: ['low_impact', 'supported'] },
  single_leg_calf_raise: { p: 'isolation', m: ['calves'], j: 'llllllh', sk: 'beginner', uni: true, lt: 'bodyweight', bw: [1, 'estimate'], t: ['low_impact', 'supported'] },
  machine_leg_extension: { p: 'isolation', m: ['quads'], eq: ['leg_extension_machine'], j: 'lllllml', sk: 'entry', lt: 'machine', t: ['supported'] },
  mini_band_lateral_walk: { p: 'isolation', m: ['hip_abductors', 'glutes'], eq: ['mini_band'], j: 'llllmll', sk: 'entry', lt: 'band', t: ['warm_up', 'low_impact'] },
  side_lying_hip_abduction: { p: 'isolation', m: ['hip_abductors'], s: ['glutes'], j: 'llllmll', sk: 'entry', lt: 'none', ci: ['floor_transfer'], t: ['low_impact'] },

  // ---------------------------------------------------------------- balance (P4 and warm-ups)
  weight_shift: { p: 'balance', m: ['hip_abductors'], s: ['calves', 'deep_core'], j: 'lllllll', sk: 'entry', lt: 'none', t: ['balance', 'supported', 'low_impact'] },
  supported_single_leg_stand: { p: 'balance', m: ['hip_abductors', 'calves'], s: ['deep_core', 'glutes'], j: 'lllllll', sk: 'entry', lt: 'none', t: ['balance', 'supported', 'low_impact'] },
  tandem_stance: { p: 'balance', m: ['hip_abductors', 'calves'], s: ['deep_core'], j: 'lllllll', sk: 'entry', lt: 'none', t: ['balance', 'supported', 'low_impact'] },
  heel_to_toe_walk: { p: 'balance', m: ['hip_abductors', 'calves'], s: ['deep_core'], j: 'llllllm', sk: 'beginner', lt: 'none', t: ['balance', 'supported', 'low_impact'] },
  single_leg_stand: { p: 'balance', m: ['hip_abductors', 'calves'], s: ['deep_core', 'glutes'], j: 'llllllm', sk: 'beginner', uni: true, lt: 'none', t: ['balance', 'low_impact'] },
  clock_reach: { p: 'balance', m: ['glutes', 'hip_abductors'], s: ['quads', 'calves', 'deep_core'], j: 'llllmml', sk: 'intermediate', uni: true, lt: 'none', ci: ['high_balance_demand'], t: ['balance', 'low_impact'] },
  supported_standing_march: { p: 'balance', m: ['hip_flexors', 'deep_core'], s: ['calves', 'hip_abductors'], j: 'lllllll', sk: 'entry', lt: 'none', t: ['balance', 'supported', 'low_impact', 'warm_up'] },

  // ---------------------------------------------------------------- mobility
  cat_camel: { p: 'mobility', m: ['lower_back', 'deep_core'], s: ['upper_back'], j: 'llmllml', sk: 'entry', lt: 'none', ci: ['floor_transfer'], t: ['mobility', 'warm_up', 'low_impact'] },
  half_kneeling_hip_flexor_stretch: { p: 'mobility', m: ['hip_flexors'], s: ['quads', 'glutes'], j: 'lllllml', sk: 'entry', lt: 'none', ci: ['floor_transfer'], t: ['mobility', 'low_impact'] },
  open_book_rotation: { p: 'mobility', m: ['upper_back'], s: ['obliques', 'chest'], j: 'mllllll', sk: 'entry', lt: 'none', ci: ['floor_transfer'], t: ['mobility', 'warm_up', 'low_impact'] },
  knee_to_wall_ankle_rock: { p: 'mobility', m: ['calves'], s: ['tibialis'], j: 'lllllmm', sk: 'entry', lt: 'none', t: ['mobility', 'warm_up', 'low_impact'] },
  band_pass_through: { p: 'mobility', m: ['rotator_cuff', 'front_delts'], s: ['rear_delts', 'chest'], eq: ['resistance_band'], j: 'mllllll', sk: 'entry', lt: 'none', ci: ['end_range_shoulder'], t: ['mobility', 'warm_up'] },
  lunge_with_rotation: { p: 'mobility', m: ['hip_flexors', 'upper_back'], s: ['glutes', 'obliques'], j: 'llmlmml', sk: 'beginner', lt: 'none', ci: ['floor_transfer'], t: ['mobility', 'warm_up'] },
  deep_squat_hold: { p: 'mobility', m: ['hip_adductors', 'glutes'], s: ['calves'], j: 'llllmhm', sk: 'beginner', lt: 'none', ci: ['deep_knee_flexion'], t: ['mobility', 'supported'] },

  // ---------------------------------------------------------------- locomotion / conditioning
  marching_in_place: { p: 'locomotion', m: ['hip_flexors', 'calves'], s: ['quads'], j: 'lllllll', imp: 'low', sk: 'entry', lt: 'none', t: ['conditioning', 'low_impact', 'warm_up'] },
  step_jack: { p: 'locomotion', m: ['calves', 'side_delts'], s: ['hip_abductors'], j: 'mllllll', imp: 'low', sk: 'entry', lt: 'none', t: ['conditioning', 'low_impact', 'warm_up'] },
  jumping_jack: { p: 'locomotion', m: ['calves', 'side_delts'], s: ['hip_abductors'], j: 'mllllmh', imp: 'high', sk: 'beginner', lt: 'none', ci: ['jumping_landing'], t: ['conditioning'] },
  burpee: { p: 'locomotion', m: ['quads', 'chest'], s: ['deep_core', 'calves', 'triceps'], j: 'mmhlmmh', imp: 'high', sk: 'intermediate', lt: 'bodyweight', bw: [0.7, 'estimate'], ci: ['jumping_landing', 'floor_transfer', 'loaded_wrist_extension'], t: ['conditioning'] },
  step_back_burpee: { p: 'locomotion', m: ['quads', 'chest'], s: ['deep_core', 'triceps'], j: 'mmmlmml', imp: 'low', sk: 'beginner', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['floor_transfer'], t: ['conditioning', 'low_impact'] },
  jump_rope_basic: { p: 'locomotion', m: ['calves'], s: ['forearms', 'quads'], eq: ['jump_rope'], j: 'llllllh', imp: 'moderate', sk: 'beginner', lt: 'none', ci: ['jumping_landing'], t: ['conditioning'] },
  bear_crawl: { p: 'locomotion', m: ['deep_core', 'front_delts', 'quads'], s: ['triceps'], j: 'mlhllml', imp: 'low', sk: 'beginner', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['loaded_wrist_extension', 'floor_transfer'], t: ['conditioning'] },
  mountain_climber: { p: 'locomotion', m: ['deep_core', 'hip_flexors'], s: ['front_delts', 'quads'], j: 'mlhlmml', imp: 'low', sk: 'beginner', lt: 'bodyweight', bw: [0.6, 'estimate'], ci: ['loaded_wrist_extension', 'floor_transfer'], t: ['conditioning'] },
  stationary_bike_easy: { p: 'locomotion', m: ['quads'], s: ['glutes', 'hamstrings', 'calves'], eq: ['stationary_bike'], j: 'llllmml', sk: 'entry', lt: 'machine', t: ['conditioning', 'low_impact', 'supported'] },
  rowing_machine_steady: { p: 'locomotion', m: ['lats', 'quads'], s: ['glutes', 'hamstrings', 'upper_back'], eq: ['rowing_machine'], j: 'mmlmmml', sk: 'beginner', lt: 'machine', t: ['conditioning', 'low_impact'] },
  // M03: steady-state modalities and venue-swap partners (seed content, same review status as every entry: A2/A3 pending).
  treadmill_incline_walk: { p: 'locomotion', m: ['calves', 'glutes'], s: ['quads', 'hamstrings'], eq: ['treadmill'], j: 'llllmml', imp: 'low', sk: 'entry', lt: 'machine', t: ['conditioning', 'low_impact'] },
  elliptical_steady: { p: 'locomotion', m: ['quads', 'glutes'], s: ['hamstrings', 'calves'], eq: ['elliptical'], j: 'llllmml', sk: 'entry', lt: 'machine', t: ['conditioning', 'low_impact', 'supported'] },
  stair_climber_steady: { p: 'locomotion', m: ['quads', 'glutes'], s: ['calves', 'hamstrings'], eq: ['stair_climber'], j: 'llllmmm', imp: 'low', sk: 'beginner', lt: 'machine', t: ['conditioning', 'low_impact', 'supported'] },
  brisk_walk: { p: 'locomotion', m: ['calves', 'glutes'], s: ['quads', 'hamstrings'], j: 'lllllll', imp: 'low', sk: 'entry', lt: 'none', t: ['conditioning', 'low_impact'] },
  easy_run: { p: 'locomotion', m: ['calves', 'quads'], s: ['glutes', 'hamstrings'], j: 'lllmmhh', imp: 'high', sk: 'beginner', lt: 'none', ci: ['jumping_landing'], t: ['conditioning'] },
  shadow_boxing: { p: 'locomotion', m: ['front_delts', 'obliques'], s: ['calves', 'triceps'], j: 'mmlllll', imp: 'low', sk: 'entry', lt: 'none', t: ['conditioning', 'low_impact'] },
};

export const SEED_EXERCISES: readonly Exercise[] = Object.freeze(Object.entries(SPECS).map(([id, spec]) => Object.freeze(defineExercise(id, spec))));
