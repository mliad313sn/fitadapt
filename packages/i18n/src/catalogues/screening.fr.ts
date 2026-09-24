import type { screeningEn } from './screening.en.js';

/**
 * Questionnaire de santé M01 (FR).
 *
 * STATUT DU CONTENU : licence check pending (vérification de licence en attente).
 * Formulation ORIGINALE, rédigée pour la société ; elle ne reprend ni
 * n’adapte le PAR-Q+ ni aucun autre questionnaire publié (risque RSK-08).
 * À faire revoir par le siège A1 (médecin du sport) ; A1 et l’avocat (B3)
 * décident si un instrument sous licence doit la remplacer. Aucune
 * formulation de diagnostic. Mêmes clés et mêmes variables que screening.en.ts.
 */
export const screeningFr: Record<keyof typeof screeningEn, string> = {
  'screening.title': 'Quelques questions de santé',
  'screening.intro': 'Vos réponses servent seulement à ajuster l’intensité des séances. Elles n’évaluent pas votre santé. En cas de doute, répondez oui.',
  'screening.contentStatus': 'Questions provisoires, vérification de licence en attente, à faire revoir par un médecin.',
  'screening.yes': 'Oui',
  'screening.no': 'Non',
  'screening.answerHint': 'Choisissez oui ou non',
  'screening.question.heart_or_blood_pressure': 'Un professionnel de santé vous a-t-il déjà dit que vous aviez un problème cardiaque ou circulatoire, ou une tension artérielle élevée ?',
  'screening.question.chest_discomfort': 'Au cours des {months} derniers mois, avez-vous ressenti une douleur, une pression ou une oppression dans la poitrine, ou qui s’étend au bras, à la mâchoire ou au cou, en activité ou au repos ?',
  'screening.question.fainting_or_dizziness': 'Au cours des {months} derniers mois, avez-vous perdu connaissance, ou eu des vertiges au point de perdre l’équilibre ?',
  'screening.question.unusual_breathlessness': 'Êtes-vous essoufflé·e bien plus vite que les personnes de votre âge, par exemple en montant un étage ?',
  'screening.question.ongoing_condition': 'Un professionnel de santé vous suit-il en ce moment pour une affection de longue durée, une maladie récente ou une opération récente ?',
  'screening.question.medication_affecting_effort': 'Prenez-vous un médicament régulier dont un professionnel vous a dit qu’il peut modifier la réaction de votre corps à l’effort ?',
  'screening.question.advised_to_limit_activity': 'Un professionnel de santé vous a-t-il demandé de limiter ou d’éviter l’activité physique ?',
  'screening.question.bone_joint_back': 'Avez-vous un problème d’os, d’articulation ou de dos qui s’aggrave quand vous bougez ?',
  'screening.question.pregnancy_or_recent_birth': 'Êtes-vous enceinte, ou avez-vous accouché au cours des {months} derniers mois ?',
  'screening.question.advised_against_calorie_restriction': 'Un professionnel de santé vous a-t-il conseillé de ne pas restreindre vos calories ou de ne pas suivre de régime amincissant ?',
  'screening.question.medication_affecting_heart_rate': 'Prenez-vous un médicament régulier qui peut ralentir votre cœur ou l’empêcher d’accélérer comme d’habitude pendant l’effort (par exemple, certains médicaments pour le cœur ou la tension) ?',
  'screening.question.eating_disorder': 'Avez-vous, ou avez-vous eu, un trouble du comportement alimentaire ?',
  'screening.clearance.label': 'Un professionnel de santé m’a autorisé·e à faire de l’exercice',
  'screening.clearance.description': 'Activez seulement si vous en avez parlé avec un professionnel pour les points auxquels vous avez répondu oui.',
  'screening.hold.notice': 'Certaines de vos réponses mettent l’entraînement en pause jusqu’à ce qu’un professionnel de santé vous ait examiné·e et soit d’accord pour que vous fassiez de l’exercice.',
  'screening.continue': 'Voir mon résultat',
  'screening.incomplete': 'Merci de répondre à chaque question. En cas de doute, répondez oui.',
};
