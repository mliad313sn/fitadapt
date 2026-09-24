import { guiltPhrases, judgementalBodyTerms } from '@fitadapt/i18n';
import { lintClaims } from '@fitadapt/legal';
import type { CoachContentId, Locale } from '@fitadapt/shared';
import { isCoachContentId } from './content.js';
import { anyMatch, fold } from './text.js';

/**
 * Runtime output guard for every model reply (L1, L5, S6), on top of the
 * system prompt. A reply that fails any check is never shown: the user gets
 * the fixed fallback reply and the failure is logged as an S6 safety event.
 *
 * Checks, in order:
 * - the L1 claims linter (packages/legal, FR and EN rules: diagnose, treat,
 *   cure, guarantee, "lose N kg in N weeks", fat-burning…);
 * - no claim to be a human or a licensed professional (L5);
 * - no naming or suspecting a condition ("sounds like tendinitis");
 * - no encouragement to train through pain or ignore symptoms (S2/S3);
 * - no medicine or supplement advice;
 * - no promise of results;
 * - no body-shaming or guilt wording (the app's denylists);
 * - every load, energy, percentage, set or rep number must come from the
 *   engine (the context or a tool result) or the cited content: the model
 *   never prescribes a number of its own (S6);
 * - citations: only ids of retrieved content, and at least one when the
 *   answer is a knowledge answer.
 */

export type GuardFailure =
  | 'coach.guard.empty'
  | 'coach.guard.claim'
  | 'coach.guard.impersonation'
  | 'coach.guard.diagnosis'
  | 'coach.guard.unsafe_encouragement'
  | 'coach.guard.medication'
  | 'coach.guard.results_promise'
  | 'coach.guard.body_or_guilt'
  | 'coach.guard.ungrounded_number'
  | 'coach.guard.unknown_reference'
  | 'coach.guard.no_reference'
  | 'coach.guard.too_long';

export interface GuardOptions {
  readonly locale: Locale;
  /** Content ids the answer may cite (what retrieval returned). */
  readonly allowedReferences: ReadonlySet<string>;
  /** Numbers the engine or the cited content produced (loads, minutes, sets, reps, percentages). */
  readonly groundedNumbers: ReadonlySet<number>;
  /** A knowledge answer must cite at least one reference. */
  readonly requireReference: boolean;
}

export type GuardResult = { readonly ok: true; readonly text: string; readonly references: readonly CoachContentId[] } | { readonly ok: false; readonly reason: GuardFailure };

const MAX_CHARS = 4000;

const IMPERSONATION = [
  /\b(i am|i'm|im) (a |an |your )?(real )?(human|person|man|woman|doctor|physician|physio|physiotherapist|physical therapist|dietitian|dietician|nutritionist|nurse|therapist|surgeon|licensed|certified|qualified|registered)\b/,
  /\bas (a|an|your) (doctor|physician|physio|physiotherapist|physical therapist|dietitian|nutritionist|nurse|medical professional|health professional)\b/,
  /\bmy name is [a-z]/,
  /\b(je suis|en tant que) (un |une |votre |ton |ta )?(vrai |vraie )?(humain|humaine|personne|homme|femme|medecin|docteur|kine|kinesitherapeute|physiotherapeute|dieteticien|dieteticienne|nutritionniste|infirmier|infirmiere|professionnel de sante|professionnelle de sante|diplome|diplomee)\b/,
  /\bje m'appelle [a-z]/,
];

// Literal patterns (no dynamic RegExp): a condition named or suspected.
const DIAGNOSIS = [
  /\b(you|it|this|that) (probably |likely |might |may |could |seem to |must )?(have|has|are suffering from|is suffering from|got|be) (a |an )?(tendin[a-z]*|sprain|strain|tear|torn [a-z]+|fracture|hernia|arthritis|bursitis|meniscus|acl|rotator cuff|sciatica|herniated disc|slipped disc|a condition|an injury|a disease|an infection|inflammation|shin splints|plantar fasciitis|impingement)\b/,
  /\b(sounds|looks|seems) like (a |an |you have |you've got )?(tendin[a-z]*|sprain|strain|tear|torn [a-z]+|fracture|hernia|arthritis|bursitis|meniscus|acl|rotator cuff|sciatica|herniated disc|slipped disc|a condition|an injury|a disease|an infection|inflammation|shin splints|plantar fasciitis|impingement)\b/,
  /\b(sounds|looks|seems) like (a |an |you have |you've got )?[a-z]+ (tendin[a-z]*|sprain|strain|tear|torn [a-z]+|fracture|hernia|arthritis|bursitis|meniscus|acl|rotator cuff|sciatica|herniated disc|slipped disc|a condition|an injury|a disease|an infection|inflammation|shin splints|plantar fasciitis|impingement)\b/,
  /\b(vous avez|tu as|c'est|il s'agit d') (probablement |sans doute |surement |peut-etre |certainement )?(une |un |d'une |d'un )?(tendinite|entorse|elongation|dechirure|fracture|hernie|arthrose|bursite|menisque|lesion|sciatique|inflammation|infection|periostite|aponevrosite|conflit)\b/,
  /\b(ca|cela) (ressemble|fait penser) a (une |un )?(tendinite|entorse|elongation|dechirure|fracture|hernie|arthrose|bursite|menisque|lesion|sciatique|inflammation|infection|periostite|aponevrosite|conflit)\b/,
];

const UNSAFE = [
  /\b(push|train|work|power|keep going|continue) (right )?through (the |it|your |that )?(pain|hurt|discomfort)/,
  /\bignore (the |your |any )?(pain|symptoms?|warning|chest)/,
  /\bno pain,? no gain\b/,
  /\b(keep going|continue|carry on) (even )?(if|though|when) (it hurts|you feel pain|there is pain|you feel chest)/,
  /\b(it'?s|that'?s) (probably )?(nothing|fine|normal) to (have|feel) (chest|palpitations|fainting)/,
  /\bmalgre la douleur\b/,
  /\bignore(z|r)? (la |les |vos |tes )?(douleur|symptomes?|signes?)/,
  /\b(continue|continuez|continuer) (meme )?(si|quand) (ca|cela) (fait mal|te fait mal|vous fait mal)/,
  /\bpas de douleur,? pas de (gain|progres)\b/,
];

const MEDICATION = [
  /\b(take|try|use|have) (some |an |a )?(ibuprofen|paracetamol|acetaminophen|aspirin|painkillers?|anti-? ?inflammator[a-z]*|creatine|steroids?|testosterone|sarms?|supplements?)\b/,
  /\b(prenez|prends|prendre|essayez|essaie) (du |de l'|de la |un |une |des )?(ibuprofene|paracetamol|doliprane|aspirine|anti-? ?inflammatoires?|antidouleurs?|creatine|complements?|steroides?)\b/,
];

const PROMISES = [
  /\byou('ll| will) (definitely |surely |certainly )?(lose|drop|burn|see results|get (lean|shredded|ripped|abs)|reach your goal)/,
  /\bin (\d+|a few|two|three) (days|weeks) you('ll| will)\b/,
  /\b(vous allez|tu vas|vous perdrez|tu perdras) (perdre|maigrir|voir des resultats|obtenir|atteindre)/,
];

const NUMBER_UNIT = /(\d+[.,]\d+|\d+) ?(kg|kgs|kilos?|kilogrammes?|lbs?|pounds|livres|kcal|calories|%|percent|pour ?cent|sets?|series|reps?|repetitions?|rounds?|rir|rpe)(?![a-z])/g;
const TIMES_PATTERN = /(\d+) ?[x×] ?(\d+)/g;
const REF_PATTERN = /\[(?:ref|source|src)?:? ?((?:kb|exercise)\.[a-z][a-z0-9_]{1,63})\]/g;

/** Numbers of a text, as the guard compares them (commas as decimal points). */
export function numbersIn(text: string): number[] {
  return [...fold(text).matchAll(/\d+[.,]\d+|\d+/g)].map((m) => Number(m[0].replace(',', '.')));
}

export function guardModelText(raw: string, options: GuardOptions): GuardResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'coach.guard.empty' };
  if (trimmed.length > MAX_CHARS) return { ok: false, reason: 'coach.guard.too_long' };

  // Citations first: they are stripped from what the user reads.
  const references: CoachContentId[] = [];
  for (const m of trimmed.matchAll(REF_PATTERN)) {
    const id = m[1]!;
    if (!options.allowedReferences.has(id) || !isCoachContentId(id)) return { ok: false, reason: 'coach.guard.unknown_reference' };
    if (!references.includes(id)) references.push(id);
  }
  const text = trimmed.replace(REF_PATTERN, '').replace(/[ \t]{2,}/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim();
  if (!text) return { ok: false, reason: 'coach.guard.empty' };

  const folded = fold(text);
  if (lintClaims([{ source: 'coach.model', locale: 'any', text }]).length > 0) return { ok: false, reason: 'coach.guard.claim' };
  if (anyMatch(folded, IMPERSONATION)) return { ok: false, reason: 'coach.guard.impersonation' };
  if (anyMatch(folded, DIAGNOSIS)) return { ok: false, reason: 'coach.guard.diagnosis' };
  if (anyMatch(folded, UNSAFE)) return { ok: false, reason: 'coach.guard.unsafe_encouragement' };
  if (anyMatch(folded, MEDICATION)) return { ok: false, reason: 'coach.guard.medication' };
  if (anyMatch(folded, PROMISES)) return { ok: false, reason: 'coach.guard.results_promise' };
  // The denylists of the reply's language (a French list on English text flags "rated" as "raté").
  if (guiltPhrases(text, options.locale).length > 0 || judgementalBodyTerms(text, options.locale).length > 0) {
    return { ok: false, reason: 'coach.guard.body_or_guilt' };
  }
  for (const m of folded.matchAll(NUMBER_UNIT)) {
    if (!options.groundedNumbers.has(Number(m[1]!.replace(',', '.')))) return { ok: false, reason: 'coach.guard.ungrounded_number' };
  }
  for (const m of folded.matchAll(TIMES_PATTERN)) {
    if (!options.groundedNumbers.has(Number(m[1])) || !options.groundedNumbers.has(Number(m[2]))) return { ok: false, reason: 'coach.guard.ungrounded_number' };
  }
  // Last: a knowledge answer must be grounded (checked after the content checks, so a dangerous answer is reported as such).
  if (options.requireReference && references.length === 0) return { ok: false, reason: 'coach.guard.no_reference' };
  return { ok: true, text, references };
}
