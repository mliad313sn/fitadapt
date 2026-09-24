import type { recoveryMedicalEn } from './recovery-medical.en.js';

/**
 * TEXTES M05 LIÉS À LA SANTÉ (FR) — RELECTURE MÉDICALE REQUISE.
 *
 * Brouillon rédigé par un assistant d’ingénierie (IA), pas par un
 * professionnel de santé. À relire par le siège A1 (médecin) et, pour la
 * douleur et les articulations, par le siège A2 (kinésithérapeute) ; la
 * déclaration d’avis médical aussi par un avocat. Conseils de bien-être
 * seulement : aucun diagnostic, aucun soin, aucun résultat promis (L1).
 * Relecture par un rédacteur natif à prévoir.
 */
const joints = { shoulder: 'Votre épaule', elbow: 'Votre coude', wrist: 'Votre poignet', lumbar: 'Le bas de votre dos', hip: 'Votre hanche', knee: 'Votre genou', ankle: 'Votre cheville' } as const;
type J = keyof typeof joints;
const upper = (j: J) => j === 'shoulder' || j === 'elbow' || j === 'wrist';
const amber = (j: J) =>
  upper(j)
    ? `${joints[j]} est à l’orange : une prise neutre (paumes face à face) ou une amplitude plus courte peut être plus confortable. Arrêtez l’exercice si la douleur augmente.`
    : `${joints[j]} est à l’orange : bougez dans une amplitude confortable, par exemple moins profond. Arrêtez l’exercice si la douleur augmente.`;
const physio = (j: J) => `${joints[j]} est à l’orange ou au rouge depuis plus de deux semaines. Pensez à consulter un kinésithérapeute, qui pourra regarder cela avec vous. Cette application donne des conseils généraux et ne peut pas en connaître la cause.`;
const morning = (j: J) => `${joints[j]} : quelle douleur maintenant, de 0 à 10 ?`;

export const recoveryMedicalFr: Record<keyof typeof recoveryMedicalEn, string> = {
  'engine.reason.session.amber.shoulder': amber('shoulder'),
  'engine.reason.session.amber.elbow': amber('elbow'),
  'engine.reason.session.amber.wrist': amber('wrist'),
  'engine.reason.session.amber.lumbar': amber('lumbar'),
  'engine.reason.session.amber.hip': amber('hip'),
  'engine.reason.session.amber.knee': amber('knee'),
  'engine.reason.session.amber.ankle': amber('ankle'),

  'recovery.pain.after.title': 'Comment vont vos articulations ?',
  'recovery.pain.after.body': 'Si quelque chose fait mal, choisissez l’articulation et notez la douleur de 0 (aucune) à 10 (la pire imaginable). Si rien ne fait mal, vous pouvez passer.',
  'recovery.pain.after.save': 'Enregistrer cette note',
  'recovery.pain.after.saveHint': 'Enregistre la note de douleur de l’articulation choisie',
  'recovery.pain.after.skip': 'Rien ne fait mal',
  'recovery.pain.after.skipHint': 'Ferme le point douleur',
  'recovery.pain.after.saved': 'Enregistré. Nous vous reposerons la question demain matin.',

  'recovery.pain.morning.title': 'Point du matin',
  'recovery.pain.morning.body': 'Hier, vous avez noté une douleur. Un rapide point ce matin aide à préparer votre prochaine séance.',
  'recovery.pain.morning.joint.shoulder': morning('shoulder'),
  'recovery.pain.morning.joint.elbow': morning('elbow'),
  'recovery.pain.morning.joint.wrist': morning('wrist'),
  'recovery.pain.morning.joint.lumbar': morning('lumbar'),
  'recovery.pain.morning.joint.hip': morning('hip'),
  'recovery.pain.morning.joint.knee': morning('knee'),
  'recovery.pain.morning.joint.ankle': morning('ankle'),
  'recovery.pain.morning.settled': 'Est-ce revenu à la normale ?',
  'recovery.pain.morning.settledYes': 'Oui, c’est passé',
  'recovery.pain.morning.settledNo': 'Non, pas encore',
  'recovery.pain.morning.save': 'Enregistrer le point du matin',
  'recovery.pain.morning.saveHint': 'Enregistre l’état de chaque articulation ce matin',
  'recovery.pain.morning.skip': 'Passer pour aujourd’hui',
  'recovery.pain.morning.skipHint': 'Ferme le point du matin',

  'recovery.pain.light.green': 'Vert : continuez comme prévu.',
  'recovery.pain.light.amber': 'Orange : vous pouvez vous entraîner ; les exercices qui la sollicitent moins sont privilégiés. Voyez comment elle va demain matin.',
  'recovery.pain.light.red': 'Rouge : les exercices qui la sollicitent sont remplacés à votre prochaine séance.',

  'recovery.physio.title': 'Pensez à consulter un kinésithérapeute',
  'recovery.physio.body.shoulder': physio('shoulder'),
  'recovery.physio.body.elbow': physio('elbow'),
  'recovery.physio.body.wrist': physio('wrist'),
  'recovery.physio.body.lumbar': physio('lumbar'),
  'recovery.physio.body.hip': physio('hip'),
  'recovery.physio.body.knee': physio('knee'),
  'recovery.physio.body.ankle': physio('ankle'),

  'recovery.redFlag.checkin.title': 'Avant de vous entraîner : l’un de ces signes aujourd’hui ?',
  'recovery.redFlag.checkin.body': 'Si c’est le cas, ne vous entraînez pas aujourd’hui. Touchez le signe concerné pour savoir quoi faire.',

  'recovery.s3.attest.title': 'Confirmer votre avis médical',
  'recovery.s3.attest.statement': 'Je confirme qu’un médecin ou un autre professionnel de santé qualifié m’a examiné depuis que j’ai signalé ces signes d’alerte, et qu’il est d’accord pour que je reprenne l’exercice.',
  'recovery.s3.attest.confirm': 'Je confirme',
  'recovery.s3.attest.confirmHint': 'Enregistre votre confirmation ; les séances reprennent, plus légères pendant une semaine',
  'recovery.s3.attest.cancel': 'Pas encore',
  'recovery.s3.attest.cancelHint': 'Garde les séances en pause',
  'recovery.s3.attest.note': 'Si vous n’avez pas encore été examiné, contactez un professionnel de santé. Les séances restent en pause jusque-là.',
};
