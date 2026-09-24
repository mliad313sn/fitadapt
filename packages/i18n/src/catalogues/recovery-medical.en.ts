/**
 * M05 HEALTH-RELATED WORDING (EN) — REQUIRES PHYSICIAN REVIEW.
 *
 * Draft by an AI engineering assistant, not by a clinician. Every message in
 * this file is medical-style copy (pain checks, the physiotherapist
 * suggestion, amber-joint tips, the red-flag check-in and the medical-review
 * statement that lifts the S3 lock) and must be reviewed by seat A1
 * (physician) and, for the pain and joint wording, seat A2
 * (physiotherapist) before release; the review statement also by counsel.
 * Wellness guidance only: no diagnosis, no treatment, no promised outcome
 * (L1, `pnpm legal:claims`). The flag below is read by tests and by the
 * release checks (MEDICAL_REVIEW).
 */
const joints = { shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', lumbar: 'lower back', hip: 'hip', knee: 'knee', ankle: 'ankle' } as const;
type J = keyof typeof joints;
const upper = (j: J) => j === 'shoulder' || j === 'elbow' || j === 'wrist';
const amber = (j: J) =>
  upper(j)
    ? `Your ${joints[j]} is on amber: a neutral grip (palms facing each other) or a shorter range of motion may feel easier. Stop this exercise if the pain rises.`
    : `Your ${joints[j]} is on amber: move within a range that feels comfortable, for example not as deep. Stop this exercise if the pain rises.`;
const physio = (j: J) => `Your ${joints[j]} has been on amber or red for more than two weeks. Consider seeing a physiotherapist, who can look at it with you. This app offers general guidance only and cannot tell what is causing it.`;
const dropped = (j: J) => `One exercise is left out today: every option here would load your ${joints[j]}, which you rated red.`;
const morning = (j: J) => `Your ${joints[j]}: how much pain now, from 0 to 10?`;

export const recoveryMedicalEn = {
  // ---- Alternative grips and variants for amber joints (engine reason codes)
  'engine.reason.session.amber.shoulder': amber('shoulder'),
  'engine.reason.session.amber.elbow': amber('elbow'),
  'engine.reason.session.amber.wrist': amber('wrist'),
  'engine.reason.session.amber.lumbar': amber('lumbar'),
  'engine.reason.session.amber.hip': amber('hip'),
  'engine.reason.session.amber.knee': amber('knee'),
  'engine.reason.session.amber.ankle': amber('ankle'),

  'engine.reason.session.s2.slot_dropped.shoulder': dropped('shoulder'),
  'engine.reason.session.s2.slot_dropped.elbow': dropped('elbow'),
  'engine.reason.session.s2.slot_dropped.wrist': dropped('wrist'),
  'engine.reason.session.s2.slot_dropped.lumbar': dropped('lumbar'),
  'engine.reason.session.s2.slot_dropped.hip': dropped('hip'),
  'engine.reason.session.s2.slot_dropped.knee': dropped('knee'),
  'engine.reason.session.s2.slot_dropped.ankle': dropped('ankle'),

  // ---- Pain check after the session
  'recovery.pain.after.title': 'How do your joints feel?',
  'recovery.pain.after.body': 'If something hurts, pick the joint and rate the pain from 0 (none) to 10 (worst you can imagine). If nothing hurts, you can skip this.',
  'recovery.pain.after.save': 'Save this rating',
  'recovery.pain.after.saveHint': 'Saves the pain rating for the joint you picked',
  'recovery.pain.after.skip': 'Nothing hurts',
  'recovery.pain.after.skipHint': 'Closes the pain check',
  'recovery.pain.after.saved': 'Saved. We will ask again tomorrow morning.',

  // ---- Next-morning check
  'recovery.pain.morning.title': 'Morning check',
  'recovery.pain.morning.body': 'Yesterday you rated some pain. A quick look at how it is this morning helps plan your next session.',
  'recovery.pain.morning.joint.shoulder': morning('shoulder'),
  'recovery.pain.morning.joint.elbow': morning('elbow'),
  'recovery.pain.morning.joint.wrist': morning('wrist'),
  'recovery.pain.morning.joint.lumbar': morning('lumbar'),
  'recovery.pain.morning.joint.hip': morning('hip'),
  'recovery.pain.morning.joint.knee': morning('knee'),
  'recovery.pain.morning.joint.ankle': morning('ankle'),
  'recovery.pain.morning.settled': 'Is it back to how it usually is?',
  'recovery.pain.morning.settledYes': 'Yes, it has settled',
  'recovery.pain.morning.settledNo': 'No, not yet',
  'recovery.pain.morning.save': 'Save my morning check',
  'recovery.pain.morning.saveHint': 'Saves how each joint feels this morning',
  'recovery.pain.morning.skip': 'Skip for today',
  'recovery.pain.morning.skipHint': 'Closes the morning check',

  // ---- Traffic light
  'recovery.pain.light.green': 'Green: carry on as planned.',
  'recovery.pain.light.amber': 'Amber: you can train; exercises that load it less are preferred. See how it feels tomorrow morning.',
  'recovery.pain.light.red': 'Red: exercises that load it are swapped in your next session.',

  // ---- Physiotherapist suggestion (> 2 weeks amber or red on the same joint)
  'recovery.physio.title': 'Consider seeing a physiotherapist',
  'recovery.physio.body.shoulder': physio('shoulder'),
  'recovery.physio.body.elbow': physio('elbow'),
  'recovery.physio.body.wrist': physio('wrist'),
  'recovery.physio.body.lumbar': physio('lumbar'),
  'recovery.physio.body.hip': physio('hip'),
  'recovery.physio.body.knee': physio('knee'),
  'recovery.physio.body.ankle': physio('ankle'),

  // ---- Red-flag check-in (with the readiness check)
  'recovery.redFlag.checkin.title': 'Before you train: any of these today?',
  'recovery.redFlag.checkin.body': 'If you have any of these, do not train today. Tap it to see what to do.',
  'recovery.redFlag.checkin.stopTitle': 'Please do not train today',
  'recovery.redFlag.checkin.symptomHint': 'Pauses training and shows what to do next',

  // ---- S3: the medical-review statement that lifts the lock (self-attestation, M05 decision; A1 and counsel to review)
  'recovery.s3.attest.title': 'Confirm your medical review',
  'recovery.s3.attest.statement': 'I confirm that a doctor or another qualified health professional has checked me since I reported these warning signs, and that they agree I can exercise again.',
  'recovery.s3.attest.confirm': 'I confirm',
  'recovery.s3.attest.confirmHint': 'Records your confirmation; sessions start again, lighter for a week',
  'recovery.s3.attest.cancel': 'Not yet',
  'recovery.s3.attest.cancelHint': 'Keeps sessions paused',
  'recovery.s3.attest.note': 'If you have not been checked yet, please contact a health professional. Sessions stay paused until then.',
} as const;

/** This whole catalogue awaits physician review (seat A1; A2 for pain and joints; counsel for the review statement). */
export const MEDICAL_REVIEW = Object.freeze({ status: 'requires physician review', seats: ['A1', 'A2'], counsel: true, keys: Object.keys(recoveryMedicalEn) });
