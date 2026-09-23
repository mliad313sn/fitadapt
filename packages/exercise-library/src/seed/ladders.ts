/**
 * Progression ladders. Each ladder is an ordered list of steps; a step lists
 * one or more exercises of equal rank (a branch, e.g. "deficit / diamond").
 * PROGRESSES_TO edges join every exercise of a step to every exercise of the
 * next step, and a REGRESSES_TO edge is generated for each of them.
 *
 * pull, push and squat follow the ladders in docs/specs/M02 (Scope, "Variant
 * ladders"); the others serve M02 slots and personas P2 (first strict
 * pull-up), P4 (balance, low impact) and P6 (rings, muscle-up, pistol).
 * Order and placement await review by seat A3 (S&C) and, for the balance and
 * low-impact ladders, seat A2 (physiotherapist).
 */
export interface Ladder {
  readonly id: string;
  readonly steps: readonly (readonly string[])[];
}

export const LADDERS: readonly Ladder[] = Object.freeze([
  // M02: dead hang → scapular pulls → inverted row (height-adjusted) → band-assisted → negatives → strict → weighted
  { id: 'pull', steps: [['dead_hang'], ['scapular_pull_up'], ['inverted_row_incline'], ['inverted_row'], ['band_assisted_pull_up'], ['negative_pull_up'], ['pull_up'], ['weighted_pull_up']] },
  // M02: wall → incline (by height) → knee → standard → deficit/diamond → archer
  { id: 'push', steps: [['wall_push_up'], ['incline_push_up_high'], ['incline_push_up_low'], ['knee_push_up'], ['push_up'], ['deficit_push_up', 'diamond_push_up'], ['archer_push_up'], ['pseudo_planche_push_up']] },
  // M02: box squat → air squat → goblet → split squat → barbell or leg press
  { id: 'squat', steps: [['box_squat'], ['air_squat'], ['goblet_squat'], ['split_squat'], ['barbell_back_squat', 'leg_press']] },

  { id: 'push_decline', steps: [['push_up'], ['decline_push_up']] },
  { id: 'push_rings', steps: [['push_up'], ['ring_push_up']] },
  { id: 'vertical_push_bodyweight', steps: [['hands_elevated_pike_push_up'], ['pike_push_up'], ['elevated_pike_push_up'], ['wall_handstand_hold']] },
  { id: 'vertical_push_loaded', steps: [['band_overhead_press'], ['seated_dumbbell_shoulder_press'], ['half_kneeling_dumbbell_press'], ['standing_dumbbell_press'], ['barbell_overhead_press']] },
  { id: 'press_loaded', steps: [['band_chest_press'], ['dumbbell_floor_press'], ['dumbbell_bench_press'], ['barbell_bench_press']] },
  { id: 'dip', steps: [['bench_dip'], ['parallel_bar_support_hold'], ['negative_dip'], ['parallel_bar_dip'], ['ring_dip']] },
  { id: 'dip_rings', steps: [['parallel_bar_support_hold'], ['ring_support_hold'], ['ring_dip']] },
  { id: 'row_bodyweight', steps: [['seated_band_row'], ['ring_row'], ['inverted_row']] },
  { id: 'row_loaded', steps: [['seated_band_row'], ['one_arm_dumbbell_row'], ['bent_over_dumbbell_row'], ['barbell_row']] },
  { id: 'pull_gym', steps: [['lat_pulldown'], ['assisted_pull_up_machine'], ['negative_pull_up']] },
  { id: 'pull_floor', steps: [['prone_floor_pulldown'], ['dead_hang']] },
  { id: 'row_floor', steps: [['floor_w_raise'], ['seated_band_row']] },
  { id: 'pull_band_home', steps: [['band_lat_pulldown'], ['band_assisted_pull_up']] },
  { id: 'chin', steps: [['negative_pull_up'], ['chin_up'], ['weighted_pull_up']] },
  // P6: bar and ring muscle-up paths
  { id: 'muscle_up_bar', steps: [['pull_up'], ['high_pull_up'], ['negative_muscle_up'], ['bar_muscle_up']] },
  { id: 'muscle_up_rings', steps: [['pull_up'], ['ring_false_grip_hang'], ['low_ring_muscle_up_transition'], ['ring_muscle_up']] },
  { id: 'single_leg_squat', steps: [['split_squat'], ['bulgarian_split_squat'], ['assisted_pistol_squat'], ['box_pistol_squat'], ['pistol_squat']] },
  { id: 'squat_power', steps: [['air_squat'], ['squat_jump']] },
  { id: 'lunge', steps: [['supported_reverse_lunge'], ['reverse_lunge'], ['walking_lunge']] },
  { id: 'lunge_loaded', steps: [['reverse_lunge'], ['dumbbell_reverse_lunge']] },
  { id: 'step', steps: [['low_step_up'], ['step_up'], ['bulgarian_split_squat']] },
  { id: 'hinge', steps: [['hip_hinge_drill'], ['kettlebell_deadlift'], ['dumbbell_romanian_deadlift'], ['barbell_romanian_deadlift'], ['conventional_deadlift']] },
  { id: 'hinge_single_leg', steps: [['hip_hinge_drill'], ['single_leg_rdl_bodyweight'], ['single_leg_rdl_dumbbell']] },
  { id: 'bridge', steps: [['glute_bridge'], ['hip_thrust_bodyweight'], ['single_leg_glute_bridge']] },
  { id: 'bridge_loaded', steps: [['hip_thrust_bodyweight'], ['dumbbell_hip_thrust']] },
  { id: 'hamstring', steps: [['glute_bridge'], ['sliding_leg_curl'], ['nordic_curl_eccentric']] },
  { id: 'plank', steps: [['knee_plank'], ['front_plank'], ['ab_wheel_kneeling']] },
  { id: 'side_plank', steps: [['side_plank_knees'], ['side_plank']] },
  { id: 'hollow', steps: [['dead_bug'], ['hollow_body_tuck'], ['hollow_body_hold']] },
  { id: 'hanging_core', steps: [['hanging_knee_raise'], ['hanging_leg_raise'], ['toes_to_bar']] },
  { id: 'l_sit', steps: [['tuck_l_sit'], ['l_sit']] },
  { id: 'calf', steps: [['calf_raise'], ['single_leg_calf_raise']] },
  // P4: balance ladder, supported first
  { id: 'balance', steps: [['weight_shift'], ['supported_single_leg_stand'], ['tandem_stance'], ['heel_to_toe_walk'], ['single_leg_stand'], ['clock_reach']] },
  // Low-impact conditioning: step options before jumps
  { id: 'jacks', steps: [['marching_in_place'], ['step_jack'], ['jumping_jack']] },
  { id: 'burpee', steps: [['step_back_burpee'], ['burpee']] },
] satisfies Ladder[]);

/**
 * The three M02 ladders as the spec writes them. Each step lists the exercises
 * that stand for it; the graph test requires a PROGRESSES_TO edge (and its
 * REGRESSES_TO) from every exercise of a step to every exercise of the next.
 * "Inverted row (height-adjusted)" is two exercises: incline, then horizontal.
 */
export const M02_LADDERS: Readonly<Record<'pull' | 'push' | 'squat', readonly (readonly string[])[]>> = Object.freeze({
  pull: [['dead_hang'], ['scapular_pull_up'], ['inverted_row_incline', 'inverted_row'], ['band_assisted_pull_up'], ['negative_pull_up'], ['pull_up'], ['weighted_pull_up']],
  push: [['wall_push_up'], ['incline_push_up_high', 'incline_push_up_low'], ['knee_push_up'], ['push_up'], ['deficit_push_up', 'diamond_push_up'], ['archer_push_up']],
  squat: [['box_squat'], ['air_squat'], ['goblet_squat'], ['split_squat'], ['barbell_back_squat', 'leg_press']],
});
