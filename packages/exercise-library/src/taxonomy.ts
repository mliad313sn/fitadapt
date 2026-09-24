import {
  EQUIPMENT_IDS,
  EquipmentSchema,
  MuscleSchema,
  type Equipment,
  type EquipmentCategory,
  type EquipmentId,
  type EquipmentLocation,
  type Muscle,
  type MuscleId,
} from '@fitadapt/shared';

/**
 * Equipment taxonomy (M06) used by M01 to build per-location equipment
 * profiles and by M02 for load rounding. Ids are stable identifiers stored in
 * user profiles: add new ids, never rename or reuse one.
 *
 * "Bodyweight only" means the body plus ordinary surroundings: the floor, a
 * wall, a door frame, a stair, and a stable surface around hip height (table,
 * counter). Anything else is equipment.
 */
type EquipmentSpec = [EquipmentCategory, EquipmentLocation[], { loadable?: boolean; portable?: boolean }?];

const EQUIPMENT_SPECS: Record<EquipmentId, EquipmentSpec> = {
  dumbbell: ['free_weight', ['home', 'gym'], { loadable: true, portable: true }],
  kettlebell: ['free_weight', ['home', 'gym'], { loadable: true, portable: true }],
  barbell: ['free_weight', ['gym', 'home'], { loadable: true }],
  weight_plate: ['free_weight', ['gym', 'home'], { loadable: true }],
  resistance_band: ['band', ['home', 'gym', 'travel', 'park'], { portable: true }],
  mini_band: ['band', ['home', 'gym', 'travel'], { portable: true }],
  exercise_mat: ['accessory', ['home', 'gym', 'travel'], { portable: true }],
  door_anchor: ['accessory', ['home', 'travel'], { portable: true }],
  ab_wheel: ['accessory', ['home', 'gym'], { portable: true }],
  jump_rope: ['accessory', ['home', 'gym', 'travel', 'park'], { portable: true }],
  parallettes: ['accessory', ['home', 'gym', 'park'], { portable: true }],
  box: ['accessory', ['gym', 'home']],
  aerobic_step: ['accessory', ['home', 'gym']],
  pull_up_bar: ['bar', ['home', 'gym', 'park']],
  parallel_bars: ['bar', ['gym', 'park']],
  low_bar: ['bar', ['park', 'gym']],
  gymnastic_rings: ['suspension', ['park', 'gym', 'home'], { portable: true }],
  suspension_trainer: ['suspension', ['home', 'gym', 'travel', 'park'], { portable: true }],
  flat_bench: ['bench_rack', ['gym', 'home', 'park']],
  adjustable_bench: ['bench_rack', ['gym', 'home']],
  squat_rack: ['bench_rack', ['gym', 'home']],
  smith_machine: ['machine', ['gym'], { loadable: true }],
  cable_station: ['cable', ['gym'], { loadable: true }],
  lat_pulldown: ['machine', ['gym'], { loadable: true }],
  assisted_pull_up_machine: ['machine', ['gym'], { loadable: true }],
  leg_press: ['machine', ['gym'], { loadable: true }],
  leg_curl_machine: ['machine', ['gym'], { loadable: true }],
  leg_extension_machine: ['machine', ['gym'], { loadable: true }],
  chest_press_machine: ['machine', ['gym'], { loadable: true }],
  sturdy_chair: ['household', ['home', 'travel']],
  stationary_bike: ['cardio', ['gym', 'home']],
  rowing_machine: ['cardio', ['gym', 'home']],
  treadmill: ['cardio', ['gym', 'home']],
  elliptical: ['cardio', ['gym', 'home']],
  stair_climber: ['cardio', ['gym']],
};

export const EQUIPMENT: readonly Equipment[] = Object.freeze(
  EQUIPMENT_IDS.map((id) => {
    const [category, locations, flags = {}] = EQUIPMENT_SPECS[id];
    return EquipmentSchema.parse({ id, category, nameKey: `library.equipment.${id}`, locations, loadable: flags.loadable ?? false, portable: flags.portable ?? false });
  }),
);

/**
 * Starting equipment profiles. M01 builds a user's profiles from the checklist;
 * these presets seed the checklist and define the three coverage sets of the
 * M06 KPI ("exercises with a valid substitute per equipment profile").
 */
export const EQUIPMENT_PRESET_IDS = ['bodyweight_only', 'home_basic', 'full_gym', 'park', 'travel'] as const;
export type EquipmentPresetId = (typeof EQUIPMENT_PRESET_IDS)[number];

const gym = EQUIPMENT_IDS.filter((id) => !['sturdy_chair', 'door_anchor', 'low_bar'].includes(id));

export const EQUIPMENT_PRESETS: Readonly<Record<EquipmentPresetId, readonly EquipmentId[]>> = Object.freeze({
  bodyweight_only: Object.freeze([] as EquipmentId[]),
  // P1 at home: pull-up bar, bands, a pair of dumbbells; a mat and a sturdy chair are common household items.
  home_basic: Object.freeze(['pull_up_bar', 'resistance_band', 'dumbbell', 'exercise_mat', 'sturdy_chair'] as EquipmentId[]),
  full_gym: Object.freeze(gym),
  // P6: park bars and bench, own rings.
  park: Object.freeze(['pull_up_bar', 'parallel_bars', 'low_bar', 'flat_bench', 'gymnastic_rings'] as EquipmentId[]),
  travel: Object.freeze(['resistance_band', 'mini_band', 'door_anchor', 'suspension_trainer', 'jump_rope', 'sturdy_chair'] as EquipmentId[]),
});

const MUSCLE_REGIONS: Record<MuscleId, Muscle['region']> = {
  chest: 'upper',
  front_delts: 'upper',
  side_delts: 'upper',
  rear_delts: 'upper',
  upper_back: 'upper',
  lats: 'upper',
  traps: 'upper',
  rotator_cuff: 'upper',
  biceps: 'upper',
  triceps: 'upper',
  forearms: 'upper',
  abs: 'core',
  obliques: 'core',
  deep_core: 'core',
  lower_back: 'core',
  glutes: 'lower',
  hip_abductors: 'lower',
  hip_adductors: 'lower',
  hip_flexors: 'lower',
  quads: 'lower',
  hamstrings: 'lower',
  calves: 'lower',
  tibialis: 'lower',
};

export const MUSCLES: readonly Muscle[] = Object.freeze(
  (Object.keys(MUSCLE_REGIONS) as MuscleId[]).map((id) => MuscleSchema.parse({ id, region: MUSCLE_REGIONS[id], nameKey: `library.muscle.${id}` })),
);
