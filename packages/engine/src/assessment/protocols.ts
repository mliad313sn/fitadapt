import type { AssessmentProtocolId, AssessmentTestKind, CapacitySlotId } from '@fitadapt/shared';
import { assessmentValue, type AssessmentConfigKey } from './config.js';

/**
 * Assessment protocols (M07, decision C7): safe, submaximal baseline tests.
 * Every shipped test is submaximal — it stops with reps (or effort) in
 * reserve, never at failure — and the plan builder (plan.ts) makes the stop
 * rule stricter, never looser, when S1 caps effort.
 *
 * - home (≤ 15 min): push-up variant reps (the user picks a level), dead-hang
 *   time, inverted-row reps, bodyweight squat reps, plank hold.
 * - home_55plus: 30-second chair stand (after Jones et al., 1999, paced and
 *   stopped at a reserve), wall/incline push-up reps, plank hold.
 * - gym: submaximal load tests (a load for about 6–10 reps, stopped at the
 *   reserve) → e1RM by RIR-adjusted Epley, plus a plank hold.
 *
 * Protocols are data. Their thresholds live in ASSESSMENT_CONFIG
 * (validated: false). Exercise ids and ladder ids refer to the M06 seed
 * (packages/exercise-library, checked by its tests); the engine resolves them
 * against the ladders and exercises it is given.
 */

export interface MappingKeys {
  /** Below this measure: one step down from the tested variant. */
  readonly stayMin: AssessmentConfigKey;
  /** From this measure: one step up from the tested variant. */
  readonly promoteAt: AssessmentConfigKey;
}

export interface AssessmentTestDefinition {
  readonly id: string;
  readonly kind: AssessmentTestKind;
  readonly slot: CapacitySlotId;
  readonly ladderId: string;
  /** Variants the user may pick from, easiest first (the "level" of the test). */
  readonly options: readonly string[];
  /**
   * 'submaximal' for every shipped test. 'maximal' (to technical failure) exists
   * only so the S1 gate can be proven: the plan builder downgrades it for any
   * user without allowMaxTests.
   */
  readonly effort: 'submaximal' | 'maximal';
  /** Bodyweight and hold tests map through thresholds; load tests through e1RM. */
  readonly mapping: MappingKeys | null;
  /** Safety caps on the effort asked: a rep cap and/or a time cap (seconds). */
  readonly capReps: AssessmentConfigKey | null;
  readonly capSeconds: AssessmentConfigKey | null;
  /** Fixed test window (timed reps). */
  readonly windowSeconds: AssessmentConfigKey | null;
  /**
   * The result counts for its slot only if this other test reached its
   * stayMin (e.g. rows raise the pull rung only with a tolerable dead hang).
   */
  readonly gate: { readonly testId: string } | null;
  /** i18n keys: `assessment.test.<messageId>.name|how` */
  readonly messageId: string;
}

export interface AssessmentProtocol {
  readonly id: AssessmentProtocolId;
  readonly version: number;
  readonly tests: readonly AssessmentTestDefinition[];
}

const test = (t: Partial<AssessmentTestDefinition> & Pick<AssessmentTestDefinition, 'id' | 'kind' | 'slot' | 'ladderId' | 'options'>): AssessmentTestDefinition =>
  Object.freeze({ effort: 'submaximal', mapping: null, capReps: null, capSeconds: null, windowSeconds: null, gate: null, messageId: t.id, ...t, options: Object.freeze([...t.options]) });

const mapping = (id: string): MappingKeys => ({ stayMin: `${id}.stayMin` as AssessmentConfigKey, promoteAt: `${id}.promoteAt` as AssessmentConfigKey });

const PLANK = test({ id: 'plank_hold', kind: 'hold', slot: 'core', ladderId: 'plank', options: ['knee_plank', 'front_plank'], mapping: mapping('plank_hold'), capSeconds: 'plank_hold.capSeconds' });

export const HOME_PROTOCOL: AssessmentProtocol = Object.freeze({
  id: 'home',
  version: 1,
  tests: Object.freeze([
    test({ id: 'push_reps', kind: 'reps', slot: 'horizontal_push', ladderId: 'push', options: ['wall_push_up', 'incline_push_up_high', 'incline_push_up_low', 'knee_push_up', 'push_up'], mapping: mapping('push_reps'), capReps: 'push_reps.capReps' }),
    test({ id: 'dead_hang_hold', kind: 'hold', slot: 'vertical_pull', ladderId: 'pull', options: ['dead_hang'], mapping: mapping('dead_hang_hold'), capSeconds: 'dead_hang_hold.capSeconds' }),
    test({ id: 'row_reps', kind: 'reps', slot: 'vertical_pull', ladderId: 'pull', options: ['inverted_row_incline', 'inverted_row', 'pull_up'], mapping: mapping('row_reps'), capReps: 'row_reps.capReps', gate: { testId: 'dead_hang_hold' } }),
    test({ id: 'squat_reps', kind: 'reps', slot: 'squat', ladderId: 'squat', options: ['box_squat', 'air_squat'], mapping: mapping('squat_reps'), capReps: 'squat_reps.capReps' }),
    PLANK,
  ]),
});

export const OLDER_ADULT_PROTOCOL: AssessmentProtocol = Object.freeze({
  id: 'home_55plus',
  version: 1,
  tests: Object.freeze([
    test({ id: 'chair_stand', kind: 'timed_reps', slot: 'squat', ladderId: 'squat', options: ['box_squat'], mapping: mapping('chair_stand'), windowSeconds: 'chairStandWindowSeconds' }),
    test({ id: 'push_reps_55', kind: 'reps', slot: 'horizontal_push', ladderId: 'push', options: ['wall_push_up', 'incline_push_up_high', 'incline_push_up_low', 'knee_push_up'], mapping: mapping('push_reps_55'), capReps: 'push_reps_55.capReps', messageId: 'push_reps' }),
    test({ id: 'plank_hold_55', kind: 'hold', slot: 'core', ladderId: 'plank', options: ['knee_plank', 'front_plank'], mapping: mapping('plank_hold_55'), capSeconds: 'plank_hold_55.capSeconds', messageId: 'plank_hold' }),
  ]),
});

const load = (id: string, slot: CapacitySlotId, ladderId: string, options: string[]) => test({ id, kind: 'load_reps', slot, ladderId, options, capReps: 'load.capReps' });

export const GYM_PROTOCOL: AssessmentProtocol = Object.freeze({
  id: 'gym',
  version: 1,
  tests: Object.freeze([
    load('squat_load', 'squat', 'squat', ['barbell_back_squat', 'leg_press', 'goblet_squat']),
    load('press_load', 'horizontal_push', 'press_loaded', ['barbell_bench_press', 'dumbbell_bench_press', 'dumbbell_floor_press']),
    load('pulldown_load', 'vertical_pull', 'pull_gym', ['lat_pulldown']),
    load('row_load', 'horizontal_pull', 'row_loaded', ['barbell_row', 'bent_over_dumbbell_row', 'one_arm_dumbbell_row']),
    load('hinge_load', 'hinge', 'hinge', ['barbell_romanian_deadlift', 'dumbbell_romanian_deadlift', 'kettlebell_deadlift']),
    PLANK,
  ]),
});

export const ASSESSMENT_PROTOCOLS: Readonly<Record<AssessmentProtocolId, AssessmentProtocol>> = Object.freeze({
  home: HOME_PROTOCOL,
  gym: GYM_PROTOCOL,
  home_55plus: OLDER_ADULT_PROTOCOL,
});

export function protocol(id: AssessmentProtocolId): AssessmentProtocol {
  return ASSESSMENT_PROTOCOLS[id];
}

/** Estimated duration of a protocol (tests plus rests between them), in minutes. */
export function estimatedMinutes(p: AssessmentProtocol): number {
  const tests = p.tests.reduce((sum, t) => sum + assessmentValue(`minutes.${t.kind}` as AssessmentConfigKey), 0);
  const rests = ((p.tests.length - 1) * assessmentValue('restBetweenTestsSeconds')) / 60;
  return Math.round((tests + rests) * 10) / 10;
}

/**
 * Which protocol to offer first: the 55+ protocol from olderAdultProtocolAge,
 * otherwise the gym protocol when the place has the equipment of at least one
 * option of every loaded test, otherwise home. The user may choose another
 * offered protocol; the 55+ protocol is always offered from that age.
 */
export function recommendProtocol(input: { ageYears: number; hasGymEquipment: boolean }): AssessmentProtocolId {
  if (input.ageYears >= assessmentValue('olderAdultProtocolAge')) return 'home_55plus';
  return input.hasGymEquipment ? 'gym' : 'home';
}
