import type { MessageKey } from './en.js';
import { assessmentFr } from './assessment.fr.js';
import { programFr } from './program.fr.js';
import { sessionFr } from './session.fr.js';
import { recoveryFr } from './recovery.fr.js';
import { recoveryMedicalFr } from './recovery-medical.fr.js';
import { legalFr } from './legal.fr.js';
import { libraryFr } from './library.fr.js';
import { onboardingFr } from './onboarding.fr.js';
import { screeningFr } from './screening.fr.js';

/** Catalogue français (ICU MessageFormat). Mêmes clés et mêmes variables que en.ts. */
export const fr: Record<MessageKey, string> = {
  'home.title': 'Bienvenue',
  'home.subtitle': 'Vos séances fonctionnent hors ligne, en français ou en anglais.',
  'home.syncStatus':
    '{count, plural, =0 {Tout est synchronisé} one {# modification en attente de synchronisation} other {# modifications en attente de synchronisation}}',
  'home.language.switch': 'Passer en anglais',
  'home.language.switchHint': 'Change la langue de toute l’application',
  'home.gymMode.enable': 'Activer le mode salle',
  'home.gymMode.disable': 'Désactiver le mode salle',
  'home.gymMode.hint': 'Boutons et chiffres plus grands, lisibles à bout de bras',
  'home.units.metric': 'Unités : métriques (kg, cm)',
  'home.units.imperial': 'Unités : impériales (lb, po)',
  'home.units.switchHint': 'Bascule entre unités métriques et impériales',
  'home.offlineCard.title': 'Fonctionne hors ligne',
  'home.offlineCard.body': 'Les modifications sont enregistrées sur cet appareil et envoyées dès le retour du réseau.',

  'home.privacy.open': 'Confidentialité',
  'home.privacy.openHint': 'Choisissez les données que vous partagez, téléchargez-les ou supprimez votre compte',

  'ui.toggle.on': 'Activé',
  'ui.toggle.off': 'Désactivé',

  // Vérification d’âge M17 (S7). Texte d’interface, pas de texte juridique.
  'ageGate.title': 'Avant de commencer',
  'ageGate.body': 'Indiquez votre date de naissance. Elle sert uniquement à vérifier que cette application vous convient et n’est pas conservée.',
  'ageGate.day': 'Jour',
  'ageGate.month': 'Mois',
  'ageGate.year': 'Année',
  'ageGate.dayHint': 'Jour de naissance, par exemple 7',
  'ageGate.monthHint': 'Mois de naissance, de 1 à 12',
  'ageGate.yearHint': 'Année de naissance, quatre chiffres',
  'ageGate.continue': 'Continuer',
  'ageGate.error.not_a_date': 'Veuillez saisir une date valide.',
  'ageGate.error.in_future': 'Cette date est dans le futur.',
  'ageGate.blocked.title': 'Cette application ne vous est pas encore accessible',
  'ageGate.blocked.body': 'Il faut avoir 16 ans ou plus pour utiliser cette application. Merci de votre intérêt.',

  // Réglages de confidentialité M17. Libellés seulement : les textes de consentement sont
  // des BROUILLONS gérés par M20 (packages/legal), à faire relire par un avocat.
  'privacy.title': 'Confidentialité',
  'privacy.intro': 'Choisissez ce que vous partagez. Rien n’est activé tant que vous ne l’activez pas, et chaque réglage peut être modifié à tout moment.',
  'privacy.consentHint': 'Active ou désactive l’utilisation de ces données',
  'privacy.consent.health.label': 'Données de santé',
  'privacy.consent.health.description': 'Réponses au questionnaire de santé et suivi des douleurs',
  'privacy.consent.photos.label': 'Photos de progression',
  'privacy.consent.photos.description': 'Photos de progression et leur sauvegarde facultative',
  'privacy.consent.wearables.label': 'Objets connectés et applis santé',
  'privacy.consent.wearables.description': 'Données importées depuis des appareils connectés et des applis santé',
  'privacy.consent.ai_coach.label': 'Coach IA',
  'privacy.consent.ai_coach.description': 'Conversations avec le coach IA, un assistant automatisé',
  'privacy.consent.analytics.label': 'Statistiques d’utilisation',
  'privacy.consent.analytics.description': 'Statistiques sur l’utilisation de l’application, sans votre nom ni votre e-mail',
  'privacy.consent.renewal': 'Les conditions de ce réglage ont changé. Réactivez-le pour continuer à l’utiliser.',
  'privacy.export.button': 'Télécharger mes données',
  'privacy.export.hint': 'Prépare une copie de toutes vos données à enregistrer ou partager',
  'privacy.export.done': 'Vos données sont prêtes.',
  'privacy.delete.button': 'Supprimer mon compte',
  'privacy.delete.hint': 'Affiche une confirmation avant toute suppression',
  'privacy.delete.confirmTitle': 'Supprimer votre compte ?',
  'privacy.delete.confirmBody': 'Votre compte et ses données sont supprimés maintenant, sur cet appareil et sur nos serveurs. Les copies de nos sauvegardes sont effacées sous {days, plural, one {# jour} other {# jours}}.',
  'privacy.delete.confirm': 'Supprimer définitivement',
  'privacy.delete.cancel': 'Garder mon compte',
  'privacy.delete.done': 'Votre compte a été supprimé.',
  'privacy.signedOut': 'Connectez-vous pour télécharger vos données ou supprimer votre compte.',

  'ui.stepper.increase': 'Augmenter {label}',
  'ui.stepper.decrease': 'Diminuer {label}',
  'ui.stepper.value': '{label} : {value}',
  'ui.timer.start': 'Démarrer le minuteur',
  'ui.timer.pause': 'Mettre le minuteur en pause',
  'ui.timer.reset': 'Réinitialiser le minuteur',
  'ui.timer.remaining': '{minutes, plural, one {# minute} other {# minutes}} {seconds, plural, one {# seconde} other {# secondes}} restantes',
  'ui.numberDisplay.value': '{label} : {value}',
  'ui.sheet.close': 'Fermer',
  'ui.toast.dismiss': 'Fermer la notification',

  'units.kg': '{value} kg',
  'units.lb': '{value} lb',
  'units.cm': '{value} cm',
  'units.in': '{value} po',
  'units.km': '{value} km',
  'units.mi': '{value} mi',

  'errors.auth.invalid_code': 'Ce code est incorrect ou a expiré. Demandez-en un nouveau.',
  'errors.auth.rate_limited': 'Trop de tentatives. Patientez quelques minutes puis réessayez.',
  'errors.auth.invalid_refresh_token': 'Votre session a pris fin. Veuillez vous reconnecter.',
  'errors.auth.refresh_token_reused': 'Par sécurité, votre session a été fermée. Veuillez vous reconnecter.',
  'errors.auth.unauthorized': 'Connectez-vous pour continuer.',
  'errors.auth.provider_not_configured': 'Ce mode de connexion n’est pas encore disponible.',
  'errors.generic': 'Une erreur est survenue. Veuillez réessayer.',

  'coachWeb.title': 'Portail coach',
  'coachWeb.placeholder': 'Le portail coach est en construction. Rien à faire ici pour l’instant.',

  // Fiche magasin (M20 : vérifiée par `pnpm legal:claims` ; store/metadata est généré depuis ces clés).
  'store.listing.name': 'Companion (titre provisoire)',
  'store.listing.subtitle': 'Un entraînement de force qui s’adapte à vous',
  'store.listing.description': 'Un compagnon d’entraînement bilingue qui construit chaque séance à partir de vos objectifs, de votre matériel et de votre forme du jour. Chaque recommandation s’explique. Les séances fonctionnent hors ligne. Entraînez-vous seul ou avec un partenaire d’un autre niveau sur le même téléphone. Conseils généraux de forme physique uniquement, pas un avis médical.',
  'store.listing.keywords': 'entraînement,musculation,force,forme,hors ligne,partenaire,poids du corps',
  'store.listing.promotionalText': 'Des plans d’entraînement expliqués, hors ligne, en français et en anglais.',

  // Textes juridiques M20 : PROJETS à faire revoir par un avocat (voir legal.fr.ts).
  ...legalFr,
  ...libraryFr,
  ...onboardingFr,
  ...screeningFr,
  ...assessmentFr,
  ...programFr,

  // M02 : codes de raison des séances et écrans de séance (sans pression ni culpabilisation).
  ...sessionFr,

  // M05 : récupération, échauffement, auto-évaluation, semaines allégées, mobilité.
  ...recoveryFr,

  // M05 : textes liés à la santé — RELECTURE MÉDICALE REQUISE (sièges A1, A2 ; avocat pour la déclaration).
  ...recoveryMedicalFr,
};
