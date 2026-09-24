import { JOINTS, TRIGGERED_DELOAD_TRIGGERS } from '@fitadapt/shared';

/**
 * Every reason code the M05 recovery rules emit (warm-up, cool-down,
 * readiness, triggered deloads, amber-joint variant hints, mobility
 * sessions), with the parameters its FR/EN sentence needs (packages/i18n
 * `engine.reason.<code>`). A test renders every code in both languages.
 */
export const M05_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Warm-up and cool-down
  'warmup.general': [],
  'warmup.general.any_easy': [],
  'warmup.mobility.for_patterns': [],
  'warmup.ramp_up': [],
  'cooldown.after_session': [],
  'cooldown.mobility': [],
  // Readiness
  'readiness.ok': [],
  'readiness.low': [],
  'readiness.check_only': [],
  'readiness.hrv_below_baseline': [],
  'readiness.resting_hr_above_baseline': [],
  // Triggered deloads
  ...Object.fromEntries(TRIGGERED_DELOAD_TRIGGERS.map((t) => [`session.deload.triggered.${t}`, []])),
  'session.deload.volume_reduced': [],
  'session.deload.in_deload_week': [],
  'session.deload.sets_reduced': [],
  // Alternative grips and variants for amber joints
  ...Object.fromEntries(JOINTS.map((j) => [`session.amber.${j}`, []])),
  // Standalone mobility and balance session
  'session.mobility.standalone': [],
  'session.mobility.balance': [],
  'session.mobility.mobility': [],
  'session.mobility.easy_effort': ['rir'],
  'session.unavailable.no_mobility_exercise': [],
});

export const M05_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M05_REASON_PARAMS));
