import { coreExercises } from './exercises/core.js';
import { legExercises } from './exercises/legs.js';
import { otherExercises } from './exercises/other.js';
import { pullExercises } from './exercises/pull.js';
import { pushExercises } from './exercises/push.js';
import type { ExerciseText, ExerciseWording } from './exercises/types.js';

/**
 * M06 exercise library wording (EN). Exercise names, cues and common mistakes
 * are seed content awaiting review by seats A2 and A3 (docs/status/M06.md).
 */
export const EXERCISE_TEXT = { ...pushExercises, ...pullExercises, ...legExercises, ...coreExercises, ...otherExercises } as const satisfies Record<string, ExerciseText>;
export type ExerciseTextId = keyof typeof EXERCISE_TEXT;
/** Ids of the exercises that have wording (packages/exercise-library checks its seed against them). */
export const EXERCISE_TEXT_IDS = Object.freeze(Object.keys(EXERCISE_TEXT) as ExerciseTextId[]);

export type ExerciseMessageKey = `exercise.${ExerciseTextId}.name` | `exercise.${ExerciseTextId}.cue.${number}` | `exercise.${ExerciseTextId}.mistake.${number}`;

export function flattenExerciseText(locale: 'en' | 'fr'): Record<ExerciseMessageKey, string> {
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(EXERCISE_TEXT) as [string, ExerciseText][]) {
    const w: ExerciseWording = text[locale];
    out[`exercise.${id}.name`] = w.name;
    w.cues.forEach((cue, i) => (out[`exercise.${id}.cue.${i + 1}`] = cue));
    w.mistakes.forEach((m, i) => (out[`exercise.${id}.mistake.${i + 1}`] = m));
  }
  return out as Record<ExerciseMessageKey, string>;
}

export const libraryLabelsEn = {
  'library.title': 'Exercise library',
  'library.open': 'Exercise library',
  'library.openHint': 'Browse exercises, search and filter by movement, muscle and equipment',
  'library.back': 'Back',
  'library.search.label': 'Search exercises',
  'library.search.hint': 'Type part of an exercise name',
  'library.filter.pattern': 'Movement',
  'library.filter.muscle': 'Muscle',
  'library.filter.equipment': 'Equipment I have',
  'library.filter.equipmentHint': 'Shows only exercises you can do with the selected equipment',
  'library.filter.any': 'Any',
  'library.filter.clear': 'Clear filters',
  'library.filter.selectedHint': 'Double tap to remove this filter',
  'library.filter.unselectedHint': 'Double tap to apply this filter',
  'library.results': '{count, plural, =0 {No exercises match} one {# exercise} other {# exercises}}',
  'library.empty': 'No exercise matches these filters. Try removing one.',
  'library.favourite.add': 'Add {name} to favourites',
  'library.favourite.remove': 'Remove {name} from favourites',
  'library.favourite.on': 'Favourite',
  'library.favourite.off': 'Not a favourite',
  'library.draftNotice': 'Draft content: these exercises have not yet been reviewed by a physiotherapist or strength coach.',
  'library.offline': 'Available offline',
  'library.equipmentNone': 'No equipment',

  'library.pattern.squat': 'Squat',
  'library.pattern.hinge': 'Hip hinge',
  'library.pattern.lunge': 'Lunge',
  'library.pattern.horizontal_push': 'Horizontal push',
  'library.pattern.vertical_push': 'Vertical push',
  'library.pattern.horizontal_pull': 'Horizontal pull',
  'library.pattern.vertical_pull': 'Vertical pull',
  'library.pattern.carry': 'Carry',
  'library.pattern.core': 'Core',
  'library.pattern.isolation': 'Single joint',
  'library.pattern.balance': 'Balance',
  'library.pattern.mobility': 'Mobility',
  'library.pattern.locomotion': 'Cardio moves',

  'library.muscle.chest': 'Chest',
  'library.muscle.front_delts': 'Front shoulders',
  'library.muscle.side_delts': 'Side shoulders',
  'library.muscle.rear_delts': 'Rear shoulders',
  'library.muscle.upper_back': 'Upper back',
  'library.muscle.lats': 'Lats',
  'library.muscle.traps': 'Trapezius',
  'library.muscle.rotator_cuff': 'Rotator cuff',
  'library.muscle.biceps': 'Biceps',
  'library.muscle.triceps': 'Triceps',
  'library.muscle.forearms': 'Forearms and grip',
  'library.muscle.abs': 'Abdominals',
  'library.muscle.obliques': 'Obliques',
  'library.muscle.deep_core': 'Deep core',
  'library.muscle.lower_back': 'Lower back',
  'library.muscle.glutes': 'Glutes',
  'library.muscle.hip_abductors': 'Outer hips',
  'library.muscle.hip_adductors': 'Inner thighs',
  'library.muscle.hip_flexors': 'Hip flexors',
  'library.muscle.quads': 'Quadriceps',
  'library.muscle.hamstrings': 'Hamstrings',
  'library.muscle.calves': 'Calves',
  'library.muscle.tibialis': 'Shins',

  'library.equipment.dumbbell': 'Dumbbells',
  'library.equipment.kettlebell': 'Kettlebell',
  'library.equipment.barbell': 'Barbell',
  'library.equipment.weight_plate': 'Weight plates',
  'library.equipment.resistance_band': 'Resistance band',
  'library.equipment.mini_band': 'Mini band',
  'library.equipment.exercise_mat': 'Exercise mat',
  'library.equipment.door_anchor': 'Door anchor',
  'library.equipment.ab_wheel': 'Ab wheel',
  'library.equipment.jump_rope': 'Jump rope',
  'library.equipment.parallettes': 'Parallettes',
  'library.equipment.box': 'Sturdy box',
  'library.equipment.aerobic_step': 'Step platform',
  'library.equipment.pull_up_bar': 'Pull-up bar',
  'library.equipment.parallel_bars': 'Parallel bars or dip station',
  'library.equipment.low_bar': 'Low bar',
  'library.equipment.gymnastic_rings': 'Gymnastic rings',
  'library.equipment.suspension_trainer': 'Suspension straps',
  'library.equipment.flat_bench': 'Flat bench',
  'library.equipment.adjustable_bench': 'Adjustable bench',
  'library.equipment.squat_rack': 'Squat rack',
  'library.equipment.smith_machine': 'Guided bar machine',
  'library.equipment.cable_station': 'Cable station',
  'library.equipment.lat_pulldown': 'Pulldown machine',
  'library.equipment.assisted_pull_up_machine': 'Assisted pull-up machine',
  'library.equipment.leg_press': 'Leg press',
  'library.equipment.leg_curl_machine': 'Leg curl machine',
  'library.equipment.leg_extension_machine': 'Leg extension machine',
  'library.equipment.chest_press_machine': 'Chest press machine',
  'library.equipment.sturdy_chair': 'Sturdy chair',
  'library.equipment.stationary_bike': 'Stationary bike',
  'library.equipment.rowing_machine': 'Rowing machine',
  'library.equipment.treadmill': 'Treadmill',

  'library.joint.shoulder': 'Shoulder',
  'library.joint.elbow': 'Elbow',
  'library.joint.wrist': 'Wrist',
  'library.joint.lumbar': 'Lower back',
  'library.joint.hip': 'Hip',
  'library.joint.knee': 'Knee',
  'library.joint.ankle': 'Ankle',
  'library.jointLoad.low': 'Low load',
  'library.jointLoad.medium': 'Medium load',
  'library.jointLoad.high': 'High load',
  'library.impact.none': 'No impact',
  'library.impact.low': 'Low impact',
  'library.impact.moderate': 'Moderate impact',
  'library.impact.high': 'High impact',
  'library.skill.entry': 'Starting point',
  'library.skill.beginner': 'Beginner',
  'library.skill.intermediate': 'Intermediate',
  'library.skill.advanced': 'Advanced',
  'library.skill.expert': 'Expert',

  // Engine reason codes for substitutions (packages/engine SubstitutionReasonCode).
  'engine.reason.substitution.highest_similarity': '{to} was chosen because it trains the most similar movement and muscles to {from}.',
  'engine.reason.substitution.equipment_unavailable': '{from} needs equipment that is not in your current equipment profile.',
  'engine.reason.substitution.joint_red': 'You marked your {joint} as red, so {from} was replaced by an exercise that puts little load on it.',
  'engine.reason.substitution.joint_amber': 'You marked your {joint} as amber, so options that load it less were preferred.',
  'engine.reason.substitution.impact_above_ceiling': '{from} has more impact than your current settings allow.',
  'engine.reason.substitution.avoid_tag': '{from} includes a movement you are advised to avoid for now.',
  'engine.reason.substitution.excluded_by_user': 'You asked not to be given {from}.',
  'engine.reason.substitution.none_available': 'No suitable alternative to {from} was found with your equipment and current settings, so it was left out.',
} as const;

export const libraryEn = { ...libraryLabelsEn, ...flattenExerciseText('en') };
export type LibraryMessageKey = keyof typeof libraryLabelsEn | ExerciseMessageKey;
