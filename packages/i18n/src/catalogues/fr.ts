import type { MessageKey } from './en.js';

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

  'ui.stepper.increase': 'Augmenter {label}',
  'ui.stepper.decrease': 'Diminuer {label}',
  'ui.stepper.value': '{label} : {value}',
  'ui.timer.start': 'Démarrer le minuteur',
  'ui.timer.pause': 'Mettre le minuteur en pause',
  'ui.timer.reset': 'Réinitialiser le minuteur',
  'ui.timer.remaining': '{minutes, plural, one {# minute} other {# minutes}} {seconds, plural, one {# seconde} other {# secondes}} restantes',
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
};
