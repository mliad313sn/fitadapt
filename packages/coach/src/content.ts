import { EXERCISE_TEXT_IDS, catalogues, type MessageKey } from '@fitadapt/i18n';
import type { CoachContentId, Locale } from '@fitadapt/shared';
import { coachValue } from './config.js';
import { fold, words } from './text.js';

/**
 * The coach's knowledge registry: the only content a knowledge answer may be
 * grounded on and cite (spec: "grounded answers from committee-approved
 * content (M06 cues, articles) with inline source references").
 *
 * - `kb.*` entries: short articles whose FR/EN wording lives in
 *   packages/i18n (`coach.kb.<id>.title|body`), versioned, each with the
 *   seats that must approve it.
 * - `exercise.*` entries: the M06 exercise wording (name, two cues, one common
 *   mistake), whose review is tracked by the M06 content workflow.
 *
 * No entry is approved yet: every review is `pending`. A production build or
 * start refuses unapproved content (assertCoachContentReleaseReady), the same
 * rule as the legal texts (M20) and the exercise library (M06).
 *
 * Keywords are retrieval data, not user-facing copy: folded (no accents),
 * matched as whole words or phrases.
 */
export type Seat = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'B4';

export interface CoachContentReview {
  readonly seat: Seat;
  readonly status: 'pending' | 'approved';
  /** Sign-off record (docs/governance/sign-offs/…), required when approved. */
  readonly signOff?: string;
}

export interface KnowledgeEntry {
  readonly id: `kb.${string}`;
  readonly version: number;
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly keywords: Readonly<Record<Locale, readonly string[]>>;
  readonly reviews: readonly CoachContentReview[];
}

const pending = (...seats: Seat[]): CoachContentReview[] => seats.map((seat) => ({ seat, status: 'pending' as const }));

function entry(id: string, reviews: CoachContentReview[], en: string[], fr: string[]): KnowledgeEntry {
  return Object.freeze({
    id: `kb.${id}` as const,
    version: 1,
    title: `coach.kb.${id}.title` as MessageKey,
    body: `coach.kb.${id}.body` as MessageKey,
    keywords: Object.freeze({ en: Object.freeze(en.map(fold)), fr: Object.freeze(fr.map(fold)) }),
    reviews: Object.freeze(reviews),
  });
}

export const COACH_CONTENT: readonly KnowledgeEntry[] = Object.freeze([
  entry('rir', pending('A3', 'A5'), ['rir', 'reps in reserve', 'rep in reserve', 'in reserve', 'reserve', 'how many reps left'], ['rir', 'repetitions en reserve', 'en reserve', 'reserve']),
  entry('rpe', pending('A3', 'A5'), ['rpe', 'effort scale', 'effort', 'how hard', 'intensity', 'effort limit'], ['rpe', 'echelle d effort', 'effort', 'intensite', 'difficulte', 'limite d effort']),
  entry('warm_up', pending('A2', 'A3'), ['warm up', 'warm-up', 'warmup', 'warming up', 'ramp up', 'ramp-up'], ['echauffement', 'echauffer', 'echauffe', 'montee en charge']),
  entry('cool_down', pending('A2', 'A3'), ['cool down', 'cool-down', 'cooldown', 'stretch after', 'stretching'], ['retour au calme', 'etirement', 'etirements', 'etirer']),
  entry('rest_between_sets', pending('A3'), ['rest between sets', 'rest time', 'rest timer', 'how long rest', 'how long should i rest', 'rest between', 'timer'], ['repos entre', 'temps de repos', 'minuteur', 'combien de repos', 'recuperation entre']),
  entry('progression', pending('A3', 'A5'), ['progression', 'progress', 'progressive overload', 'double progression', 'add weight', 'heavier', 'increase the weight', 'next variant', 'when do i go up'], ['progression', 'progresser', 'double progression', 'ajouter du poids', 'plus lourd', 'augmenter la charge', 'variante suivante']),
  entry('deload', pending('A3', 'A5'), ['deload', 'lighter week', 'light week', 'easy week', 'recovery week'], ['decharge', 'semaine legere', 'semaine plus legere', 'semaine de recuperation', 'deload']),
  entry('load_ceiling', pending('A3'), ['load ceiling', '10%', '10 percent', 'why not heavier', 'go up faster', 'loads go up', 'weight go up', 'load increase', 'limit on weight'], ['plafond de charge', '10 %', '10%', 'pourquoi pas plus lourd', 'monter plus vite', 'augmentation de charge', 'limite de charge']),
  entry('pain_traffic_light', pending('A2'), ['pain scale', 'pain score', 'traffic light', 'amber', 'red joint', 'green', 'rate my pain', 'pain rating', 'joint pain'], ['echelle de douleur', 'feu tricolore', 'orange', 'articulation rouge', 'noter ma douleur', 'douleur articulaire', 'note de douleur']),
  entry('warning_signs', pending('A1'), ['warning signs', 'warning sign', 'red flags', 'red flag', 'when to stop', 'stop exercising', 'emergency'], ['signes d alerte', 'signe d alerte', 'quand arreter', 'arreter l exercice', 'urgence']),
  entry('screening', pending('A1'), ['health questions', 'screening', 'questionnaire', 'clearance', 'effort cap', 'why rpe 7', 'why is my effort limited', 'health answers'], ['questions de sante', 'questionnaire', 'depistage', 'limite d effort', 'reponses sante', 'autorisation']),
  entry('readiness', pending('A3', 'A5'), ['readiness', 'readiness check', 'how i feel today', 'daily check', 'check-in', 'check in'], ['point forme', 'forme du jour', 'comment je me sens', 'bilan du jour']),
  entry('missed_session', pending('A3', 'A6'), ['missed session', 'miss a session', 'missed a workout', 'skip a session', 'can not train', 'reflow', 'move a session'], ['seance manquee', 'rater une seance', 'rate une seance', 'si je rate', 'manquer une seance', 'manque une seance', 'deplacer une seance', 'sauter une seance']),
  entry('short_on_time', pending('A3'), ['short on time', 'not much time', 'time-boxing', 'shorter session', 'less time', 'quick session'], ['peu de temps', 'pas beaucoup de temps', 'seance courte', 'seance plus courte', 'moins de temps']),
  entry('equipment_switch', pending('A3'), ['equipment', 'different gym', 'travel', 'hotel', 'no equipment', 'another place', 'change place', 'at home'], ['materiel', 'autre salle', 'voyage', 'hotel', 'sans materiel', 'autre lieu', 'changer de lieu', 'a la maison']),
  entry('protein_range', pending('A4', 'B4'), ['protein', 'proteins', 'how much protein'], ['proteine', 'proteines', 'combien de proteines']),
  entry('energy_floors', pending('A4', 'B4'), ['calories', 'calorie', 'energy target', 'kcal', 'deficit', 'how much should i eat', 'lose weight', 'weight loss', 'pace of weight loss'], ['calories', 'calorie', 'objectif d energie', 'kcal', 'deficit', 'combien manger', 'perdre du poids', 'perte de poids', 'maigrir']),
  entry('sleep_recovery', pending('A3', 'A5'), ['rest day', 'rest days', 'recovery', 'day off', 'train every day'], ['jour de repos', 'jours de repos', 'recuperation', 'tous les jours']),
  entry('consistency', pending('A6'), ['routine', 'consistency', 'motivation', 'habit', 'stay consistent'], ['routine', 'regularite', 'motivation', 'habitude']),
  entry('form_cues', pending('A2', 'A3'), ['technique', 'form', 'how to do', 'cues', 'proper form'], ['technique', 'posture', 'comment faire', 'consignes', 'bonne execution']),
  entry('heart_rate_zones', pending('A5', 'B4'), ['heart rate', 'zones', 'zone 2', 'cardio zone', 'intervals', 'hiit', 'talk test'], ['frequence cardiaque', 'zones', 'zone 2', 'fractionne', 'hiit', 'test de la parole', 'cardio']),
  entry('fair_pair', pending('A3'), ['fair pair', 'partner', 'train together', 'with my partner', 'couple'], ['fair pair', 'partenaire', 'a deux', 'ensemble', 'en couple']),
  entry('offline', pending('A6'), ['offline', 'no internet', 'airplane mode', 'no connection', 'without internet'], ['hors ligne', 'sans internet', 'mode avion', 'sans connexion']),
  entry('ai_coach', pending('A1', 'B4'), ['what can you do', 'what can the coach do', 'what can the assistant do', 'ai coach'], ['que peux-tu faire', 'que pouvez-vous faire', 'que peut faire le coach', 'coach ia']),
  entry('soreness', pending('A2', 'A1'), ['sore', 'soreness', 'doms', 'aching muscles', 'stiff'], ['courbature', 'courbatures', 'raideur', 'muscles douloureux']),
]);

const byId = new Map<string, KnowledgeEntry>(COACH_CONTENT.map((e) => [e.id, e]));

export function knowledgeEntry(id: string): KnowledgeEntry | undefined {
  return byId.get(id);
}

/** Every content id the coach may cite: the registry and the M06 exercise wording. */
export function isCoachContentId(id: string): id is CoachContentId {
  if (byId.has(id)) return true;
  const m = /^exercise\.([a-z][a-z0-9_]{1,63})$/.exec(id);
  return m !== null && (EXERCISE_TEXT_IDS as readonly string[]).includes(m[1]!);
}

export interface Retrieved {
  readonly id: CoachContentId;
  readonly score: number;
  /** The grounding text (FR or EN), as the model receives it. */
  readonly text: string;
}

/** A keyword or phrase as whole words of the question (`text` is its words joined by single spaces, padded). */
const phrase = (text: string, raw: string, kw: string) => (kw.includes('%') ? raw.includes(kw) : text.includes(` ${words(kw).join(' ')} `));

function exerciseText(id: string, locale: Locale): string {
  const cat = catalogues[locale] as Readonly<Record<string, string>>;
  return [cat[`exercise.${id}.name`], cat[`exercise.${id}.cue.1`], cat[`exercise.${id}.cue.2`], cat[`exercise.${id}.mistake.1`]].filter(Boolean).join(' ');
}

/** M06 exercises named in the question (full name, in either language), longest names first. */
export function exercisesNamed(question: string): string[] {
  const text = fold(question);
  const hits: { id: string; len: number }[] = [];
  const tokens = new Set(words(question));
  const partial: { id: string; score: number }[] = [];
  for (const id of EXERCISE_TEXT_IDS) {
    for (const locale of ['en', 'fr'] as const) {
      const name = fold((catalogues[locale] as Readonly<Record<string, string>>)[`exercise.${id}.name`] ?? '');
      if (name.length >= 4 && text.includes(name)) {
        hits.push({ id, len: name.length });
        break;
      }
      // A shortened name ("bench press", "développé couché", "front plank"): most of its long words are in the question.
      const long = words(name).filter((w) => w.length >= 4);
      const found = long.filter((w) => tokens.has(w)).length;
      if (long.length >= 2 && found >= 2 && found / long.length >= 0.6) partial.push({ id, score: found / long.length + found });
    }
  }
  if (hits.length > 0) return hits.sort((a, b) => b.len - a.len || a.id.localeCompare(b.id)).map((h) => h.id);
  return partial.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((p) => p.id);
}

/**
 * Deterministic keyword retrieval over the registry (and exercise names).
 * A question is "covered" only if an entry reaches `retrievalMinScore`.
 */
export function retrieve(question: string, locale: Locale): Retrieved[] {
  const text = ` ${words(question).join(' ')} `;
  const raw = fold(question);
  const cat = catalogues[locale] as Readonly<Record<string, string>>;
  const scored: Retrieved[] = [];
  for (const e of COACH_CONTENT) {
    const kws = new Set([...e.keywords.en, ...e.keywords.fr]);
    let score = 0;
    // A phrase that matches counts as many times as it has words ("health questions" beats "effort").
    for (const kw of kws) if (phrase(text, raw, kw)) score += Math.max(1, words(kw).length);
    if (score >= coachValue('retrievalMinScore')) scored.push({ id: e.id, score, text: `${cat[e.title]}: ${cat[e.body]}` });
  }
  const exercises = exercisesNamed(question).slice(0, 2).map((id) => ({ id: `exercise.${id}` as CoachContentId, score: 10, text: exerciseText(id, locale) }));
  return [...exercises, ...scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))].slice(0, coachValue('retrievalMaxEntries'));
}

/** Content that is not approved by every seat it needs (all of it, today). */
export function unapprovedContent(content: readonly KnowledgeEntry[] = COACH_CONTENT): string[] {
  return content.filter((e) => e.reviews.length === 0 || e.reviews.some((r) => r.status !== 'approved' || !r.signOff)).map((e) => e.id);
}

/** Production refuses coach content that is not approved (the M20 / M06 release rule). */
export function assertCoachContentReleaseReady(profile: { production: boolean }, content: readonly KnowledgeEntry[] = COACH_CONTENT): void {
  if (!profile.production) return;
  const missing = unapprovedContent(content);
  if (missing.length > 0) throw new Error(`Production release refused: ${missing.length} coach knowledge entr${missing.length === 1 ? 'y lacks' : 'ies lack'} council approval`);
}
