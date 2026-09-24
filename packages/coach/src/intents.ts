import { catalogues } from '@fitadapt/i18n';
import { COACH_TOOL_BOUNDS, type CoachContext, type CoachToolName, type Joint } from '@fitadapt/shared';
import { coachValue } from './config.js';
import { exercisesNamed } from './content.js';
import { anyMatch, fold } from './text.js';

/**
 * Deterministic intent parser, FR/EN. It turns a plain request into the tool
 * call a model would make: the offline coach uses it (no model), the server
 * uses it to route simple requests, and the eval harness's mock model uses it
 * to behave like a well-behaved model. It never invents a prescription: it
 * only names the tool and what the user said (a joint, a score, minutes, an
 * exercise position).
 */
export type Intent =
  | { readonly kind: 'tool'; readonly tool: CoachToolName; readonly input: Record<string, unknown> }
  | { readonly kind: 'ask_pain_score'; readonly joint: Joint }
  | { readonly kind: 'greeting' }
  | { readonly kind: 'thanks' };

const JOINT_WORDS: readonly (readonly [Joint, RegExp])[] = [
  ['knee', /\b(knee|knees|genou|genoux)\b/],
  ['shoulder', /\b(shoulder|shoulders|epaule|epaules)\b/],
  ['elbow', /\b(elbow|elbows|coude|coudes)\b/],
  ['wrist', /\b(wrist|wrists|poignet|poignets)\b/],
  ['lumbar', /\b(lower back|low back|back|lumbar|bas du dos|lombaire|lombaires|lombaires|dos|reins)\b/],
  ['hip', /\b(hip|hips|hanche|hanches)\b/],
  ['ankle', /\b(ankle|ankles|cheville|chevilles)\b/],
];
const PAIN_WORDS = [/\b(hurt|hurts|hurting|pain|painful|sore|ache|aches|aching|twinge|tweak|tweaked)\b/, /\b(douleur|douleurs|mal|douloureux|douloureuse|fait mal|me lance)\b/];
const SCORE = /\b(10|[0-9]) ?(\/ ?10|out of 10|sur 10)\b/;
const BARE_SCORE = /^(10|[0-9])( \/10| \/ 10|\/10|\/ 10| out of 10| sur 10|)[.!]?$/;
const TIME_WORDS = [/\b(shorter|short on time|less time|quick(er)? session|not much time|pressed for time|in a hurry|only have)\b/, /\b(plus court|plus courte|moins de temps|pas beaucoup de temps|peu de temps|seance courte|raccourci|presse|pressee)\b/];
const MINUTES = /\b(\d{1,3}) ?(min|mins|minutes|mn|minute)\b/;
const HOURS = /\b(an|one|1|une) (hour|heure)\b/;
const LIGHTER = [/\b(lighter|easier|easy day|go easy|take it easy|tired|exhausted|low energy|drained|wiped out|not feeling (it|great|good))\b/, /\b(plus leger|plus legere|plus facile|allege|alleger|fatigue|fatiguee|crevee?|epuisee?|pas en forme|doucement|tranquille)\b/];
const SWAP = [/\b(swap|replace|switch|substitute|instead of|alternative|change the|change my|another exercise|different exercise|skip the)\b/, /\b(remplace|remplacer|echange|echanger|change le|change la|change l|changer le|changer la|changer l|changer d|a la place|autre exercice|alternative)\b/];
const EQUIPMENT = [/\b(no (bench|rack|bar|barbell|machine|cable|dumbbells?|pull-? ?up bar)|(bench|rack|machine|station) (is )?(taken|busy|occupied|broken)|don'?t have)\b/, /\b(pas de (banc|rack|barre|machine|poulie|halteres?)|(banc|rack|machine) (est )?(pris|occupee?|cassee?)|je n'ai pas)\b/];
const RESCHEDULE = [/\b(can'?t|cannot|won'?t be able to|unable to|not able to) (train|make it|do (it|this|that|today|the session|my session)|work ?out|come)\b/, /\b(move|reschedule|push back|postpone) (my |the |todays |today's )?(session|workout|training)\b/, /\b(another day|skip today|not today)\b/, /\b(je ne peux pas|je peux pas|impossible de) (m'entrainer|faire (la|ma) seance|venir|aujourd'hui)\b/, /\b(deplacer|reporter|decaler) (la |ma )?(seance|entrainement)\b/, /\b(pas aujourd'hui|un autre jour|pas possible aujourd'hui)\b/];
const EXPLAIN = [/\b(why|explain|reason|how come|what does .{1,30} mean)\b/, /\b(pourquoi|explique|expliquer|raison|que veut dire)\b/];
const PLAN_WORDS = [/\b(plan|session|workout|today|sets?|reps?|load|weight|kg|exercise|program|rest)\b/, /\b(plan|seance|aujourd'hui|series?|repetitions?|charge|poids|kg|exercice|programme|repos)\b/];
const EXPLAIN_VERB = [/\b(explain|explique|expliquer|expliquez)\b/];
const DEFINITIONAL = [/^(what is|what's|whats|what are|what does|how does|define|what do you mean by)\b/, /^(c'est quoi|qu'est-ce qu|que veut dire|comment fonctionne|comment marche|a quoi sert|a quoi servent|que signifie)/];
/** Words too common to name an exercise by themselves ("avant" is in "avant-bras"). */
const COMMON_WORDS = new Set(['avant', 'apres', 'pendant', 'pourquoi', 'seance', 'exercice', 'exercise', 'session', 'workout', 'today', 'first', 'second', 'third', 'fourth', 'fifth', 'premier', 'deuxieme', 'troisieme', 'dernier', 'derniere', 'please', 'instead', 'place', 'other', 'autre', 'avec', 'without', 'sans', 'light', 'leger', 'legere', 'heavy', 'lourd', 'lourde', 'explain', 'explique']);
/** The user's own plan or session (explain today's plan), not a general "why" about a rule. */
const OWN_PLAN = [/\b(my|today|todays|this|these|tonight)\b/, /\b(mon|ma|mes|aujourd'hui|ce|cette|ces|ce soir)\b/];
const GREETING = /^(hi|hello|hey|good (morning|evening|afternoon)|bonjour|salut|bonsoir|coucou)\b[\s!.,]*$/;
const THANKS = /^(thanks|thank you|thx|cheers|thanks a lot|thank you so much|thanks so much|many thanks|merci|merci beaucoup|merci bien|super merci|top merci)\b[\s!.,]*$/;
const ORDINALS: readonly (readonly [RegExp, number])[] = [
  [/\b(first|1st|premier|premiere|exercise 1|exercice 1)\b/, 0],
  [/\b(second|2nd|deuxieme|second|exercise 2|exercice 2)\b/, 1],
  [/\b(third|3rd|troisieme|exercise 3|exercice 3)\b/, 2],
  [/\b(fourth|4th|quatrieme|exercise 4|exercice 4)\b/, 3],
  [/\b(fifth|5th|cinquieme|exercise 5|exercice 5)\b/, 4],
  [/\b(last|dernier|derniere)\b/, -1],
];

export function jointIn(text: string): Joint | null {
  for (const [joint, re] of JOINT_WORDS) if (re.test(text)) return joint;
  return null;
}

function nameOf(id: string, locale: 'en' | 'fr'): string {
  return fold((catalogues[locale] as Readonly<Record<string, string>>)[`exercise.${id}.name`] ?? id);
}

/** The plan exercise the user means: by position, or by name (the plan's exercise named in the message). */
function exerciseIndexIn(text: string, raw: string, context: CoachContext): { index: number; preferred: string | null } | null {
  const plan = context.today?.plan;
  if (!plan || plan.exercises.length === 0) return null;
  const named = exercisesNamed(raw);
  const inPlan = named.map((id) => plan.exercises.findIndex((e) => e.exerciseId === id)).find((i) => i >= 0);
  const preferred = named.find((id) => !plan.exercises.some((e) => e.exerciseId === id)) ?? null;
  if (inPlan !== undefined) return { index: inPlan, preferred };
  for (const [re, index] of ORDINALS) if (re.test(text)) return { index: index < 0 ? plan.exercises.length - 1 : Math.min(index, plan.exercises.length - 1), preferred };
  // A name in the user's locale that partly matches (e.g. "squat" for "goblet squat"): the first plan exercise whose name contains a word of 5+ letters of the message.
  const tokens = text.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !COMMON_WORDS.has(w));
  const partial = plan.exercises.findIndex((e) => tokens.some((w) => nameOf(e.exerciseId, 'en').includes(w) || nameOf(e.exerciseId, 'fr').includes(w)));
  return partial >= 0 ? { index: partial, preferred } : null;
}

/**
 * The intents of a message, in the order they should run. `previous` is the
 * user's previous message (a bare score answers a pain question about the
 * joint named there).
 */
export function parseIntents(message: string, context: CoachContext, previous: string | null = null): Intent[] {
  const text = fold(message);
  if (GREETING.test(text)) return [{ kind: 'greeting' }];
  // "What is a deload week?" asks for knowledge, not for a lighter session.
  const definitional = anyMatch(text, DEFINITIONAL);
  if (THANKS.test(text)) return [{ kind: 'thanks' }];
  const out: Intent[] = [];

  // Pain: a joint with a pain word (and a score), or a bare score after a pain question.
  const joint = jointIn(text);
  const pain = joint !== null && anyMatch(text, PAIN_WORDS);
  const score = SCORE.exec(text) ?? (pain ? /\b(10|[0-9])\b/.exec(text.replace(MINUTES, '')) : null);
  if (pain && joint) {
    if (score) out.push({ kind: 'tool', tool: 'logPain', input: { joint, score: Number(score[1]) } });
    else out.push({ kind: 'ask_pain_score', joint });
  } else if (BARE_SCORE.test(text) && previous) {
    const pj = jointIn(fold(previous));
    if (pj && anyMatch(fold(previous), PAIN_WORDS)) out.push({ kind: 'tool', tool: 'logPain', input: { joint: pj, score: Number(BARE_SCORE.exec(text)![1]) } });
  }

  if (definitional) return out;

  // Swap an exercise of today's plan.
  if (anyMatch(text, SWAP)) {
    const target = exerciseIndexIn(text, message, context);
    if (target) {
      const reason = pain ? 'pain' : anyMatch(text, EQUIPMENT) ? 'equipment' : 'user';
      out.push({ kind: 'tool', tool: 'swapExercise', input: { exerciseIndex: target.index, reason, ...(target.preferred ? { preferredExerciseId: target.preferred } : {}) } });
    }
  }

  // Minutes available.
  const minutes = MINUTES.exec(text);
  const hour = HOURS.test(text);
  if ((minutes || hour || anyMatch(text, TIME_WORDS)) && !anyMatch(text, [/\brest(ing)?\b/, /\brepos\b/])) {
    const current = context.today?.input.minutesAvailable ?? null;
    const asked = minutes ? Number(minutes[1]) : hour ? 60 : current !== null ? Math.max(COACH_TOOL_BOUNDS.minutesMin.value, current - coachValue('shorterByMinutes')) : null;
    if (asked !== null) out.push({ kind: 'tool', tool: 'adjustSessionTime', input: { minutes: asked } });
  }

  if (anyMatch(text, LIGHTER)) out.push({ kind: 'tool', tool: 'requestDeload', input: {} });
  if (anyMatch(text, RESCHEDULE)) out.push({ kind: 'tool', tool: 'reschedule', input: {} });

  if (out.length === 0 && anyMatch(text, EXPLAIN)) {
    const target = exerciseIndexIn(text, message, context);
    if (target || (anyMatch(text, PLAN_WORDS) && (anyMatch(text, OWN_PLAN) || anyMatch(text, EXPLAIN_VERB)))) out.push({ kind: 'tool', tool: 'explainPrescription', input: target ? { exerciseIndex: target.index } : {} });
  }
  return out;
}

/** A message that talks about training at all (else an uncovered question is out of scope). */
export function aboutTraining(message: string): boolean {
  return anyMatch(fold(message), [
    /\b(train|training|workout|work out|exercise|exercises|session|set|sets|rep|reps|plan|program|programme|cardio|warm|stretch|mobility|pain|sore|rest|deload|muscle|strength|squat|push|pull|lift|lifting|gym|run|running|walk|fitness|coach|weight|load|protein|calorie)\b/,
    /\b(entrainement|entrainer|seance|exercice|exercices|serie|series|repetition|repetitions|plan|programme|cardio|echauffement|etirement|mobilite|douleur|repos|muscle|force|squat|pompe|traction|salle|course|marche|forme|coach|poids|charge|proteine|calorie)\b/,
  ]);
}
