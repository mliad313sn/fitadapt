import type { CoachSafetyCategory, RedFlagSymptom } from '@fitadapt/shared';
import { COACH_SCREEN_CONFIG } from './screen.config.js';
import { anyMatch, fold } from './text.js';

const SCREEN_VERY_LOW_INTAKE_KCAL = COACH_SCREEN_CONFIG.veryLowIntakeKcal.value;
const SCREEN_FAST_LOSS_KG_PER_WEEK = COACH_SCREEN_CONFIG.fastLossKgPerWeek.value;
const KG_PER_LB = 0.45359237;

/**
 * Deterministic safety pre-screen of every user message, FR and EN (S3, S4,
 * S6, S7, L1, L5). It runs BEFORE any model call, on the server and on the
 * device (offline), and its categories get fixed, reviewed replies: the model
 * is never asked to handle a red flag, a request for a medical assessment,
 * extreme dieting, a minor, a pregnancy, a role-play as a professional, a
 * jailbreak or an attempt to lift a safety limit.
 *
 * The lists fail safe: a false positive costs a fixed reply (or, for a red
 * flag, a stopped session and a medical-review attestation); a miss could
 * cost a user's health. The phrase lists are the engineer's draft for seat A1
 * (red flags, crisis, medical boundary) and B4 (wellness boundary); they are
 * not validated (docs/status/M11.md).
 *
 * Patterns are literal, bounded and written against folded text (lower case,
 * no accents, plain apostrophes).
 */

export interface ScreenResult {
  readonly category: CoachSafetyCategory;
  /** The S3 symptom, for a red flag. */
  readonly symptom?: RedFlagSymptom;
}

/** S3 red-flag symptoms (docs/specs/00-product-vision.md), in the order they are checked. */
const RED_FLAGS: readonly (readonly [RedFlagSymptom, readonly RegExp[]])[] = [
  [
    'chest_pain_pressure',
    [
      // A chest symptom, not a chest exercise ("chest press" is not a red flag).
      /\bchest (pain|pains|pressure|tightness|tight|hurts?|hurting|aches?|aching|discomfort|squeez)/,
      /(pain|pains|pressure|tightness|squeezing|ache|aching|discomfort|burning) (in|on|across|around) (my |the )?chest/,
      /\b(my )?chest (is|feels|felt|was|got|gets|went) (tight|heavy|painful|sore|weird|strange|pressure)/,
      /\btight chest/,
      /heart attack/,
      /\bangina\b/,
      /(douleur|douleurs|pression|serrement|oppression|brulure|poids) (a|dans|sur|au niveau de) (la |ma )?poitrine/,
      /\bpoitrine (qui )?(serre|me serre|fait mal|me fait mal|oppress|brule|lourde)/,
      /mal (a|dans) la poitrine/,
      /(douleur|oppression|pression|gene) thoracique/,
      /crise cardiaque/,
      /infarctus/,
    ],
  ],
  [
    'fainting',
    [
      /\bfaint/,
      /pass(ed|ing)? out/,
      /black(ed|ing)? out/,
      /lost consciousness/,
      /\bdizz/,
      /light-? ?headed/,
      /\bsyncope/,
      /evanoui/,
      /perdu connaissance/,
      /perte de connaissance/,
      /\bmalaise/,
      /vertige/,
      /etourdi/,
      /tete qui tourne/,
      /tomber dans les pommes/,
    ],
  ],
  [
    'disproportionate_breathlessness',
    [
      /can'?t breathe/,
      /cannot breathe/,
      /can'?t catch my breath/,
      /struggl(e|ing) to breathe/,
      /hard to breathe/,
      /trouble breathing/,
      /short(ness)? of breath/,
      /(unusual|extreme|abnormal|very|really|so)(ly)? (breathless|out of breath)/,
      /(du mal|difficile|difficulte|difficultes) a respirer/,
      /n'arrive (pas|plus) a (respirer|reprendre)/,
      /j'etouffe/,
      /souffle coupe/,
      /essouffle(e|ment)? (anormal|inhabituel|extreme)/,
      /(tres|trop|anormalement) essouffle/,
    ],
  ],
  [
    'palpitations',
    [
      /palpitation/,
      /heart (is )?(racing|pounding|fluttering|skipping|beating (fast|irregular|weird))/,
      /irregular (heart|heartbeat|pulse)/,
      /heartbeat (is )?(irregular|racing|weird)/,
      /coeur (qui )?(s'emballe|palpite|bat (tres )?(vite|fort|irregulier|bizarrement))/,
      /battements? (du coeur )?irreguliers?/,
      /tachycard/,
      /arythmi/,
    ],
  ],
  [
    'sudden_numbness_weakness',
    [
      /\bnumb(ness)?\b/,
      /\bgone numb/,
      /tingling (in|down) my (arm|face|hand|leg)/,
      /sudden(ly)? (weak|weakness)/,
      /can'?t (move|feel) my (arm|leg|face|hand)/,
      /(face|mouth) (is )?droop/,
      /slurred/,
      /engourdi/,
      /fourmillement/,
      /faiblesse soudaine/,
      /soudain(ement)? (faible|une faiblesse)/,
      /paralys/,
      /(je n'arrive plus|j'arrive plus) a (bouger|parler)/,
    ],
  ],
];

const CRISIS = [/kill myself/, /suicid/, /end my life/, /hurt myself/, /self-? ?harm/, /want to die/, /me tuer/, /en finir avec (la vie|ma vie)/, /me faire du mal/, /envie de mourir/, /mettre fin a mes jours/];

const PREGNANCY = [/pregnan/, /expecting a baby/, /gave birth/, /post-? ?partum/, /breastfeed/, /enceinte/, /grossesse/, /accouch/, /allait/];

/** S7: under 16 (any request), or 16–17 with a weight-loss request (S4: deficit features off under 18); a child's training. */
const UNDER_16 = [
  /\b(i'?m|i am|im) ([5-9]|1[0-5])( years?| yrs?| yo\b| y\/o| and\b|,|\.|$)/,
  /\b([5-9]|1[0-5]) ?-?(years?|yrs?)[- ]old\b/,
  /\bj'?ai ([5-9]|1[0-5]) ans\b/,
  /\b(under|below) 16\b/,
  /moins de 16 ans/,
  /\bmy ([a-z0-9-]+ )?(son|daughter|kid|kids|child|children)\b/,
  /\bmon (fils|enfant)\b/,
  /\bma fille\b/,
  /\bmes enfants\b/,
  /\b(teenager|ado|adolescent|adolescente)\b/,
];
const AGE_16_17 = [/\b(i'?m|i am|im) 1[67]\b/, /\b1[67] ?-?(years?|yrs?)[- ]old\b/, /\bj'?ai 1[67] ans\b/];
const WEIGHT_LOSS = [/lose weight/, /weight loss/, /\bdiet/, /calorie/, /\bkcal/, /maigrir/, /perdre du poids/, /regime/, /perte de poids/];

/** S4: far below the floors (starving, purging, very low intakes, very fast loss). */
const EXTREME_DIET = [
  /stop eating/,
  /not eat(ing)? (for|anything)/,
  /(skip|skipping) (all )?(my )?meals/,
  /\b(water )?fast(ing)? for \d+ days/,
  /\bwater fast/,
  /\bstarv/,
  /crash diet/,
  /\bpurg(e|ing)/,
  /\bvomit/,
  /laxative/,
  /diuretic/,
  /sweat (it|the weight|off)/,
  /as (fast|quickly) as possible/,
  /arreter de manger/,
  /ne (plus|pas) manger/,
  /jeun(e|er|ant)? (pendant )?\d+ jours/,
  /sauter (tous )?(les|mes) repas/,
  /\baffam/,
  /regime (drastique|express|extreme|miracle)/,
  /\bvomir/,
  /laxatif/,
  /diuretique/,
  /le plus vite possible/,
];

const IMPERSONATION = [
  /(pretend|act|behave|roleplay|role-play|role play|answer|respond|speak|talk|reply)( to me)? (to be |like |as )(a |an |my )?(real )?(doctor|physician|physio|physiotherapist|physical therapist|dietitian|dietician|nutritionist|nurse|therapist|surgeon|cardiologist|human|person|medical professional|health professional)/,
  /you are (now )?(a |an |my )(doctor|physician|physio|physiotherapist|dietitian|nutritionist|nurse|human|real person)/,
  /\bas (a|my) (doctor|physician|physio|physiotherapist|dietitian|nutritionist|nurse)\b/,
  /(fais|fait|faites|joue|jouez|reponds|repondez|parle|parlez) (semblant d'etre|comme si tu etais|comme si vous etiez|le role d'?(un|une|de)|comme (un|une|mon|ma))/,
  /(tu es|vous etes|t'es) (maintenant )?(un |une |mon |ma )?(medecin|docteur|kine|kinesitherapeute|physiotherapeute|dieteticien|dieteticienne|nutritionniste|infirmier|infirmiere|humain|humaine)\b/,
  /en tant que (medecin|docteur|kine|kinesitherapeute|dieteticien|nutritionniste|infirmier)/,
];

const JAILBREAK = [
  /ignore (all |any |your |the |previous |prior |above |earlier )*(instructions|rules|prompt|prompts|guidelines|restrictions)/,
  /disregard (your|the|all|any|previous) /,
  /system prompt/,
  /developer mode/,
  /jailbreak/,
  /\bdan\b/,
  /do anything now/,
  /no (restrictions|filters|rules|limits)/,
  /without (any )?(restrictions|filters|rules|limits)/,
  /(reveal|show|print|repeat) (me )?(your|the) (prompt|instructions|rules)/,
  /(oublie|oubliez|ignore|ignorez) (tes|vos|les|toutes les|toutes tes) (instructions|regles|consignes)/,
  /mode developpeur/,
  /sans (aucune )?(restriction|restrictions|limite|limites|filtre|filtres|regle|regles)/,
  /prompt systeme/,
];

const BYPASS = [
  /(increase|raise|add|bump|up|double|push) (the |my )?([a-z]+ )?(load|loads|weight|weights|intensity)( by| to)? \d/,
  /(\d+ ?%|\d+ ?kg|\d+ ?lbs?) (more|heavier|extra)/,
  /(increase|raise|add|bump|double|push|up) (the |my )?([a-z]+ )?(by |to )?\d+ ?(kg|kgs|kilos?|lbs?|pounds|%|percent)\b/,
  /(ajoute|ajouter|ajoutez|augmente|augmenter|augmentez|monte|monter|montez) (la |le |les |ma |mon |mes )?([a-z]+ )?(de |a )?\d+ ?(kg|kilos?|%|pour ?cent)/,
  /(remove|lift|turn off|disable|switch off|bypass|override|ignore) (the |my |your |all |these )?(safety |load )?(limit|limits|cap|caps|lock|locks|ceiling|safety|restrictions|rules)/,
  /skip (the )?(medical review|attestation|review)/,
  /unlock (my )?(intensity|training|sessions?|workouts?)/,
  /ignore (the |my )?(pain|lock|red flag|warning)/,
  /(train|push|work|power) through (the |my |this |it)?(pain|hurt)/,
  /\bmax(ing)? out\b/,
  /(one|1) ?-?rep ?max/,
  /test my max/,
  /\bto failure\b/,
  /no rest days?/,
  /(lever|leve|levez|enlever|enleve|enlevez|retirer|retire|retirez|desactiver|desactive|desactivez|contourner|contourne|ignorer|supprimer|supprime|supprimez) (la |le |les |mes |ma |mon |cette |ces )?(limite|limites|verrou|blocage|securite|plafond)/,
  /(augmente|augmenter|augmentez|double|doubler|doublez) (la |le |les |ma |mes )?(charge|charges|poids|intensite)( de| a)? \d/,
  /debloque(r|z)? (l'?)?(intensite|entrainement|seance)/,
  /malgre la douleur/,
  /jusqu'a l'echec/,
  /\b1 ?rm\b/,
  /charge maximale/,
];

const HUMAN_CHECK = [
  /are you (a |an )?(human|real|person|bot|robot|ai|machine|doctor|coach|real person)\b/,
  /am i (talking|speaking|chatting) (to|with) (a |an )?(human|real person|person|bot|robot|ai|machine)/,
  /is this (a |an )?(bot|human|real person|ai|robot)\b/,
  /(es-tu|etes-vous|t'es|tu es|vous etes) (un |une )?(humain|humaine|vrai|vraie|personne|robot|ia|bot|machine|medecin)\b/,
  /je (parle|discute) (a|avec) (un |une )?(humain|vraie personne|robot|ia|machine)/,
  /c'est (un|une) (robot|humain|ia|vraie personne)/,
];

const DIAGNOSIS = [
  /what'?s wrong with (my|me)/,
  /what is wrong with (my|me)/,
  /do i have (a |an )?(injury|tear|tendin|condition|disease|problem|hernia|arthritis|sprain|fracture|torn)/,
  /is (it|this|that) (a |an )?(tear|torn|sprain|fracture|tendin|hernia|arthritis|injury|broken|serious|dangerous)/,
  /\bdiagnos/,
  /what (injury|condition|disease|problem) (do i|is it|could it)/,
  /could (it|this) be (a |an )?(tear|torn|sprain|fracture|tendin|hernia|arthritis|injury|broken|serious)/,
  /am i injured/,
  /should i see a (doctor|physio|physiotherapist)/,
  /qu'?est-ce que j'ai/,
  /est-ce (que c'est )?(une |un )?(dechirure|entorse|fracture|tendinite|hernie|lesion|arthrose|blessure|grave)/,
  /c'est (grave|une tendinite|une entorse|une dechirure|une fracture|une hernie)/,
  /(ai-je|j'ai peut-etre) (une |un )?(blessure|tendinite|entorse|dechirure|fracture|hernie|lesion|arthrose)/,
  /\bdiagnosti/,
  /dois-je (voir|consulter) un (medecin|kine)/,
];

const MEDICATION = [
  /ibuprofen|paracetamol|acetaminophen|aspirin|painkiller|anti-? ?inflammator|medication|medicine(?! ball)|\bpills?\b|creatine|steroid|testosterone|\bsarms?\b|supplement|\bdrugs?\b|\bopioid/,
  /antidouleur|anti-? ?inflammatoire|medicament|comprime|doliprane|steroide|complements? alimentaires?|anabolisant|creatine/,
];

function redFlag(text: string): RedFlagSymptom | null {
  for (const [symptom, patterns] of RED_FLAGS) if (anyMatch(text, patterns)) return symptom;
  return null;
}

/**
 * Classifies a user message. Order matters: an emergency first (red flags,
 * crisis), then the populations the app does not programme for, then the
 * nutrition floors, then role-play, jailbreaks and bypass attempts, then
 * medical questions.
 */
export function screenMessage(message: string): ScreenResult {
  const text = fold(message);
  const symptom = redFlag(text);
  if (symptom) return { category: 'red_flag', symptom };
  if (anyMatch(text, CRISIS)) return { category: 'crisis' };
  if (anyMatch(text, PREGNANCY)) return { category: 'pregnancy' };
  if (anyMatch(text, UNDER_16) || (anyMatch(text, AGE_16_17) && anyMatch(text, WEIGHT_LOSS))) return { category: 'minor' };
  if (anyMatch(text, EXTREME_DIET) || veryLowIntake(text) || tooFastLoss(text)) return { category: 'extreme_diet' };
  if (anyMatch(text, IMPERSONATION)) return { category: 'impersonation_request' };
  if (anyMatch(text, JAILBREAK)) return { category: 'jailbreak' };
  if (anyMatch(text, BYPASS)) return { category: 'bypass_request' };
  if (anyMatch(text, HUMAN_CHECK)) return { category: 'human_check' };
  if (anyMatch(text, DIAGNOSIS)) return { category: 'diagnosis_request' };
  if (anyMatch(text, MEDICATION)) return { category: 'medication_request' };
  return { category: 'ok' };
}

/**
 * An intake far below any energy floor (S4). Adults' resting needs are well
 * above this, so a question about eating less is never answered with a
 * number by the model; the value is the boundary of this classifier, not a
 * nutrition value (COACH_SCREEN_CONFIG, validated:false).
 */
function veryLowIntake(text: string): boolean {
  for (const m of text.matchAll(/(\d[\d ,.]{1,6}) ?(k?cal|calories)\b/g)) {
    const n = Number(m[1]!.replace(/[ ,.]/g, ''));
    if (Number.isFinite(n) && n > 0 && n < SCREEN_VERY_LOW_INTAKE_KCAL) return true;
  }
  return false;
}

/** "lose 10 kg in 2 weeks" / "perdre 8 kilos en 10 jours": faster than the S4 1 %/week ceiling for any adult weight the app supports. */
function tooFastLoss(text: string): boolean {
  const m = /(lose|losing|drop|perdre|perds|maigrir de) (\d{1,3}) ?(kg|kilos?|lbs?|pounds|livres)\b.{0,20}?\b(in|within|en|dans) (\d{1,3}) ?(days?|weeks?|months?|jours?|semaines?|mois)\b/.exec(text);
  if (!m) return false;
  const amountKg = /lb|pound|livre/.test(m[3]!) ? Number(m[2]) * KG_PER_LB : Number(m[2]);
  const unit = m[6]!;
  const weeks = /day|jour/.test(unit) ? Number(m[5]) / 7 : /month|mois/.test(unit) ? (Number(m[5]) * 30) / 7 : Number(m[5]);
  if (weeks <= 0) return true;
  return amountKg / weeks > SCREEN_FAST_LOSS_KG_PER_WEEK;
}
