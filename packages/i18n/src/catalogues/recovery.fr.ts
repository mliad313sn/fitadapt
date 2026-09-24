import type { recoveryEn } from './recovery.en.js';

/**
 * Textes M05 (FR) : échauffement, retour au calme, auto-évaluation du jour,
 * semaines allégées déclenchées et séance mobilité et équilibre. Ton calme,
 * sans pression (L4) ; aucun résultat promis (L1) ; aucune culpabilisation.
 * Les textes liés à la santé sont dans recovery-medical.fr.ts (relecture
 * médicale requise). Relecture par un rédacteur natif à prévoir.
 */
export const recoveryFr: Record<keyof typeof recoveryEn, string> = {
  'engine.reason.warmup.general': 'D’abord un mouvement facile, pour vous échauffer progressivement.',
  'engine.reason.warmup.general.any_easy': 'D’abord un mouvement facile de votre choix, par exemple marcher sur place.',
  'engine.reason.warmup.mobility.for_patterns': 'De la mobilité pour les mouvements de la séance du jour.',
  'engine.reason.warmup.ramp_up': 'Quelques séries plus légères avant votre premier exercice chargé, jusqu’à la charge de travail.',
  'engine.reason.cooldown.after_session': 'Il reste du temps : la séance se termine par de la mobilité douce.',
  'engine.reason.cooldown.mobility': 'De la mobilité douce pour les zones travaillées.',

  'engine.reason.readiness.ok': 'Votre auto-évaluation indique que vous êtes en forme : la séance reste telle que prévue.',
  'engine.reason.readiness.low': 'Votre auto-évaluation indique que vous êtes moins en forme aujourd’hui : la séance est un peu plus légère.',
  'engine.reason.readiness.check_only': 'D’après vos réponses seulement. Aucune donnée de montre n’est nécessaire.',
  'engine.reason.readiness.hrv_below_baseline': 'Votre variabilité de fréquence cardiaque est plus basse que d’habitude.',
  'engine.reason.readiness.resting_hr_above_baseline': 'Votre fréquence cardiaque au repos est plus haute que d’habitude.',

  'engine.reason.session.deload.triggered.amber_weeks': 'Semaine allégée : vous avez signalé une douleur deux semaines différentes.',
  'engine.reason.session.deload.triggered.red_flag': 'Semaine allégée après les signes d’alerte que vous avez signalés.',
  'engine.reason.session.deload.triggered.performance_drop': 'Semaine allégée : vos deux dernières séances ont semblé plus difficiles qu’avant.',
  'engine.reason.session.deload.triggered.low_readiness': 'Semaine allégée : vous vous êtes senti moins en forme trois jours de suite.',
  'engine.reason.session.deload.volume_reduced': 'Environ la moitié des séries habituelles et aucune hausse de charge, pour récupérer.',
  'engine.reason.session.deload.in_deload_week': 'C’est déjà une semaine allégée de votre plan.',
  'engine.reason.session.deload.sets_reduced': 'Moins de séries que d’habitude cette semaine.',

  'engine.reason.session.mobility.standalone': 'Une séance mobilité et équilibre à la place de l’entraînement du jour.',
  'engine.reason.session.mobility.balance': 'Travail d’équilibre : tenez-vous à un appui stable quand vous le souhaitez.',
  'engine.reason.session.mobility.mobility': 'Mobilité douce, dans une amplitude confortable.',
  'engine.reason.session.mobility.easy_effort': 'Restez à un effort facile : arrêtez avec environ {rir} répétitions en réserve.',
  'engine.reason.session.unavailable.no_mobility_exercise': 'Aucun exercice de mobilité ou d’équilibre ne convient à votre lieu et à vos réponses aujourd’hui.',

  'recovery.mode.training': 'Entraînement',
  'recovery.mode.mobility': 'Mobilité et équilibre',
  'recovery.mode.hint': 'Choisit entre l’entraînement du jour et une séance douce de mobilité et d’équilibre',

  'recovery.warmup.title': 'Échauffement · {minutes} min',
  'recovery.warmup.general': '{exercise} pendant {seconds} s',
  'recovery.warmup.generalAny': 'Un mouvement facile de votre choix pendant {seconds} s',
  'recovery.warmup.ramp': 'Séries plus légères avant {exercise} :',
  'recovery.warmup.rampSet': '{reps} répétitions avec {load}',
  'recovery.warmup.rampSetNoLoad': '{reps} répétitions sans charge ajoutée',
  'recovery.warmup.drill': '{exercise} pendant {seconds} s',
  'recovery.cooldown.title': 'Retour au calme · {minutes} min',

  'recovery.readiness.title': 'Auto-évaluation rapide (facultative)',
  'recovery.readiness.intro': 'Quatre touches, environ 10 secondes. Vous pouvez la passer : elle peut seulement alléger la séance, jamais la durcir.',
  'recovery.readiness.sleep': 'Comment avez-vous dormi ?',
  'recovery.readiness.sleep.low': '1 = mal',
  'recovery.readiness.sleep.high': '5 = très bien',
  'recovery.readiness.soreness': 'Vos muscles sont-ils courbaturés ?',
  'recovery.readiness.soreness.low': '1 = pas du tout',
  'recovery.readiness.soreness.high': '5 = très courbaturés',
  'recovery.readiness.stress': 'Quel est votre niveau de stress ?',
  'recovery.readiness.stress.low': '1 = calme',
  'recovery.readiness.stress.high': '5 = très stressé',
  'recovery.readiness.energy': 'Comment est votre énergie ?',
  'recovery.readiness.energy.low': '1 = faible',
  'recovery.readiness.energy.high': '5 = pleine d’énergie',
  'recovery.readiness.chip': '{value} sur 5',
  'recovery.readiness.chipHint': 'Répond {value} sur 5',
  'recovery.readiness.save': 'Enregistrer',
  'recovery.readiness.saveHint': 'Enregistre vos réponses sur cet appareil',
  'recovery.readiness.skip': 'Passer l’auto-évaluation',
  'recovery.readiness.skipHint': 'Garde la séance du jour telle que prévue',
  'recovery.readiness.done.normal': 'Merci. La séance du jour reste telle que prévue.',
  'recovery.readiness.done.reduced': 'Merci. La séance du jour est un peu plus légère : une série de moins par exercice et plus de répétitions en réserve.',
  'recovery.readiness.noWearable': 'Pas de données de montre aujourd’hui : vos réponses suffisent.',

  'recovery.deload.title': 'Une semaine allégée',
  'recovery.deload.until': 'Jusqu’au {date}.',
  'recovery.deload.untilReview': 'Jusqu’à une semaine après la confirmation de votre avis médical.',
};
