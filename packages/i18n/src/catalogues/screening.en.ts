/**
 * M01 health-screening wording (EN).
 *
 * CONTENT STATUS: licence check pending.
 * These questions are ORIGINAL wording written by the drafting assistant for
 * the company. They are not copied or adapted from PAR-Q+ or any other
 * published questionnaire (licence risk RSK-08). Seat A1 (sports & exercise
 * medicine physician) must review the questions, the answer-to-restriction
 * mapping (packages/safety/src/screening.config.ts) and this wording; seat A1
 * and counsel (B3) decide whether a licensed instrument should replace them.
 * No diagnosis: questions ask what a professional has told the user or what
 * the user has noticed, never what the user "has".
 */
export const SCREENING_CONTENT_STATUS = 'licence check pending' as const;

export const screeningEn = {
  'screening.title': 'A few health questions',
  'screening.intro': 'Your answers only adjust how hard sessions can be. They do not assess your health. Answer yes if you are unsure.',
  'screening.contentStatus': 'Draft questions, licence check pending, awaiting review by a physician.',
  'screening.yes': 'Yes',
  'screening.no': 'No',
  'screening.answerHint': 'Choose yes or no',
  'screening.question.heart_or_blood_pressure': 'Has a health professional ever told you that you have a heart or circulation problem, or raised blood pressure?',
  'screening.question.chest_discomfort': 'In the past {months} months, have you felt pain, pressure or tightness in your chest, or spreading to your arm, jaw or neck, whether active or at rest?',
  'screening.question.fainting_or_dizziness': 'In the past {months} months, have you fainted, or felt so dizzy that you lost your balance?',
  'screening.question.unusual_breathlessness': 'Do you get out of breath much sooner than people of your age, for example on one flight of stairs?',
  'screening.question.ongoing_condition': 'Is a health professional currently following you for a long-term condition, a recent illness or a recent operation?',
  'screening.question.medication_affecting_effort': 'Do you take a regular medicine that a professional said may change how your body reacts to effort?',
  'screening.question.advised_to_limit_activity': 'Has a health professional asked you to limit or avoid physical activity?',
  'screening.question.bone_joint_back': 'Do you have a bone, joint or back problem that gets worse when you move?',
  'screening.question.pregnancy_or_recent_birth': 'Are you pregnant, or have you given birth in the past {months} months?',
  'screening.question.advised_against_calorie_restriction': 'Has a health professional advised you not to restrict calories or not to follow a weight-loss diet?',
  'screening.question.medication_affecting_heart_rate': 'Do you take a regular medicine that can slow your heart rate or keep it from rising as usual during effort (for example, some heart or blood-pressure medicines)?',
  'screening.question.eating_disorder': 'Do you have, or have you had, an eating disorder?',
  'screening.clearance.label': 'A health professional has cleared me to exercise',
  'screening.clearance.description': 'Only turn this on if you have spoken with a professional about the points you answered yes to.',
  'screening.hold.notice': 'Some of your answers put training on hold until a health professional has checked you and agrees you can exercise.',
  'screening.continue': 'See my result',
  'screening.incomplete': 'Please answer every question. If you are unsure, answer yes.',
} as const;
