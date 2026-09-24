/**
 * M05 recovery wording (EN): warm-up, cool-down, readiness check, triggered
 * deloads and the mobility and balance session — engine reason codes
 * (`engine.reason.<code>`) and screen copy. Plain, calm, never pressuring
 * (L4); no promised results (L1); no guilt. The health-related wording
 * (pain checks, physiotherapist suggestion, amber-joint tips, the S3 review
 * statement) is NOT here: it lives in recovery-medical.en.ts, flagged for
 * physician review.
 */
export const recoveryEn = {
  // ---- Engine reason codes: warm-up and cool-down
  'engine.reason.warmup.general': 'Easy movement first, to warm up gradually.',
  'engine.reason.warmup.general.any_easy': 'Easy movement of your choice first, such as marching on the spot.',
  'engine.reason.warmup.mobility.for_patterns': 'Mobility for the movements in today’s session.',
  'engine.reason.warmup.ramp_up': 'A few lighter sets before your first loaded exercise, building up to the working load.',
  'engine.reason.cooldown.after_session': 'There is time left, so the session ends with easy mobility.',
  'engine.reason.cooldown.mobility': 'Easy mobility for the areas you trained.',

  // ---- Engine reason codes: readiness
  'engine.reason.readiness.ok': 'Your check shows you feel ready: the session stays as planned.',
  'engine.reason.readiness.low': 'Your check shows you feel less ready today: the session is a little lighter.',
  'engine.reason.readiness.check_only': 'Based on your answers only. No watch data is needed.',
  'engine.reason.readiness.hrv_below_baseline': 'Your heart-rate variability is lower than your usual.',
  'engine.reason.readiness.resting_hr_above_baseline': 'Your resting heart rate is higher than your usual.',

  // ---- Engine reason codes: triggered deloads
  'engine.reason.session.deload.triggered.amber_weeks': 'A lighter week: you noted pain in two different weeks.',
  'engine.reason.session.deload.triggered.red_flag': 'A lighter week after the warning signs you reported.',
  'engine.reason.session.deload.triggered.performance_drop': 'A lighter week: your last two sessions felt harder than before.',
  'engine.reason.session.deload.triggered.low_readiness': 'A lighter week: you felt less ready three days in a row.',
  'engine.reason.session.deload.volume_reduced': 'About half the usual sets and no load increases, so you can recover.',
  'engine.reason.session.deload.in_deload_week': 'This is already a lighter week in your plan.',
  'engine.reason.session.deload.sets_reduced': 'Fewer sets than usual this week.',

  // ---- Engine reason codes: mobility and balance session
  'engine.reason.session.mobility.standalone': 'A mobility and balance session instead of today’s training.',
  'engine.reason.session.mobility.balance': 'Balance practice: hold on to something stable whenever you like.',
  'engine.reason.session.mobility.mobility': 'Easy mobility, moving within a comfortable range.',
  'engine.reason.session.mobility.easy_effort': 'Keep it easy: stop with about {rir} reps to spare.',
  'engine.reason.session.unavailable.no_mobility_exercise': 'No mobility or balance exercise fits your place and your answers today.',

  // ---- Screens: session type
  'recovery.mode.training': 'Training',
  'recovery.mode.mobility': 'Mobility and balance',
  'recovery.mode.hint': 'Chooses between today’s training and a gentle mobility and balance session',

  // ---- Screens: warm-up and cool-down
  'recovery.warmup.title': 'Warm-up · {minutes} min',
  'recovery.warmup.general': '{exercise} for {seconds} s',
  'recovery.warmup.generalAny': 'Easy movement you like for {seconds} s',
  'recovery.warmup.ramp': 'Lighter sets before {exercise}:',
  'recovery.warmup.rampSet': '{reps} reps with {load}',
  'recovery.warmup.rampSetNoLoad': '{reps} reps with no added weight',
  'recovery.warmup.drill': '{exercise} for {seconds} s',
  'recovery.cooldown.title': 'Cool-down · {minutes} min',

  // ---- Screens: readiness check (optional)
  'recovery.readiness.title': 'Quick check (optional)',
  'recovery.readiness.intro': 'Four taps, about 10 seconds. You can skip it: it can only make today lighter, never harder.',
  'recovery.readiness.sleep': 'How did you sleep?',
  'recovery.readiness.sleep.low': '1 = badly',
  'recovery.readiness.sleep.high': '5 = very well',
  'recovery.readiness.soreness': 'How sore are your muscles?',
  'recovery.readiness.soreness.low': '1 = not sore',
  'recovery.readiness.soreness.high': '5 = very sore',
  'recovery.readiness.stress': 'How stressed do you feel?',
  'recovery.readiness.stress.low': '1 = calm',
  'recovery.readiness.stress.high': '5 = very stressed',
  'recovery.readiness.energy': 'How is your energy?',
  'recovery.readiness.energy.low': '1 = low',
  'recovery.readiness.energy.high': '5 = full of energy',
  'recovery.readiness.chip': '{value} of 5',
  'recovery.readiness.chipHint': 'Answers {value} out of 5',
  'recovery.readiness.save': 'Save my check',
  'recovery.readiness.saveHint': 'Saves your answers on this device',
  'recovery.readiness.skip': 'Skip the check',
  'recovery.readiness.skipHint': 'Keeps today’s session as planned',
  'recovery.readiness.done.normal': 'Thanks. Today’s session stays as planned.',
  'recovery.readiness.done.reduced': 'Thanks. Today’s session is a little lighter: one set fewer per exercise and more reps to spare.',
  'recovery.readiness.noWearable': 'No watch data today: your answers are enough.',

  // ---- Screens: deload
  'recovery.deload.title': 'A lighter week',
  'recovery.deload.until': 'Until {date}.',
  'recovery.deload.untilReview': 'Until a week after your review is confirmed.',
} as const;
