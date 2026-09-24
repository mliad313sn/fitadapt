import type { deviceDataEn } from './device-data.en.js';

/** Cycle de vie des données locales (FR) : mêmes clés et mêmes variables que device-data.en.ts. */
export const deviceDataFr: Record<keyof typeof deviceDataEn, string> = {
  'photos.backup.checking': 'Recherche d’une sauvegarde existante sur votre compte…',
  'photos.backup.existing.title': 'Vous avez déjà une sauvegarde',
  'photos.backup.existing.body':
    'Votre compte contient déjà une sauvegarde chiffrée de photos, faite sur un autre téléphone. Saisissez son code de récupération : ce téléphone utilise alors la même sauvegarde, et vos photos d’ici y sont ajoutées. Aucun nouveau code n’est proposé, car il rendrait la sauvegarde existante impossible à ouvrir.',
  'photos.backup.existing.code': 'Code de récupération de votre sauvegarde',
  'photos.backup.existing.codeHint': 'Le code noté lorsque vous avez activé la sauvegarde la première fois',
  'photos.backup.existing.join': 'Utiliser ma sauvegarde existante',
  'photos.backup.existing.cancel': 'Plus tard',
  'photos.backup.joined': '{count, plural, =0 {Ce téléphone utilise maintenant votre sauvegarde existante.} one {Ce téléphone utilise maintenant votre sauvegarde existante. # photo restaurée.} other {Ce téléphone utilise maintenant votre sauvegarde existante. # photos restaurées.}}',
  'photos.restore.skipped': '{count, plural, one {# photo n’a pas pu être ouverte avec la clé de cette sauvegarde et a été ignorée.} other {# photos n’ont pas pu être ouvertes avec la clé de cette sauvegarde et ont été ignorées.}}',

  'signIn.otherAccount':
    'Ce téléphone contient les données d’un autre compte. Pour ne pas les mélanger, connectez-vous avec ce compte, ou supprimez d’abord les données de ce téléphone.',
  'signIn.otherAccount.erase': 'Supprimer les données de ce téléphone',
  'signIn.otherAccount.eraseHint': 'Retire les données de l’autre compte de ce téléphone uniquement. Les données déjà synchronisées restent dans ce compte.',
  'signIn.otherAccount.confirm': 'Oui, supprimer les données de ce téléphone',
  'signIn.otherAccount.erased': 'Les données de ce téléphone ont été supprimées. Vous pouvez maintenant vous connecter.',

  'pair.partner.exportFailed': 'L’export de {name} n’a pas pu être partagé. Rien n’a été envoyé. Réessayez.',

  'pair.consent.withdraw': 'Retirer mon consentement',
  'pair.consent.withdrawHint': 'Arrête cela dès maintenant. Vos données sur ce téléphone restent jusqu’à ce que vous les supprimiez.',
  'pair.consent.withdrawn': 'Consentement retiré.',

  'pair.guest.confirm.title': 'Donnez le téléphone à {name}',
  'pair.guest.confirm.body':
    '{name}, les étapes suivantes sont les vôtres : vos propres textes, consentements et questions de santé. Continuez seulement si vous êtes {name} et tenez vous-même le téléphone.',
  'pair.guest.confirm.toggle': 'Je suis {name} et je réponds pour moi-même',
  'pair.guest.confirm.required': 'Seul·e {name} peut confirmer cette étape.',
  'pair.guest.screening.again': 'Pour votre vie privée, les réponses précédentes ne sont pas réaffichées. Répondez de nouveau à chaque question.',

  'pair.done.together': '{count, plural, =0 {Vous vous êtes entraînés ensemble aujourd’hui.} one {Ensemble, vous avez fait # série.} other {Ensemble, vous avez fait # séries.}}',
  'pair.done.showEach': 'Afficher les séries de chacun',
  'pair.done.showEachHint': 'Seulement si vous voulez tous les deux les voir côte à côte',
};
