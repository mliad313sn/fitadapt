import type { Locale } from './locale.js';

/**
 * "No body-shaming" (CLAUDE.md rule 8, M04 Rules: "No judgemental language
 * about weight or body shape"). Words and phrases that judge, mock or rank a
 * body, sell a body ideal or treat body parts as problems. Used by the M04
 * copy test over every FR and EN catalogue message (goal condition 6).
 * Matching ignores case and accents and treats ’ as '; entries are matched as
 * whole words or phrases.
 *
 * "fat" on its own is judgemental; the neutral measure names "body fat",
 * "body-fat" and the goal "fat loss" are allowed (`ALLOWED_FAT_PHRASES`).
 * The list is the engineer's first draft; seat A6 (behavioural scientist)
 * and a native FR editor review it.
 */
export const BODY_SHAMING_DENYLIST: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: [
    'fatty',
    'fatso',
    'fatter',
    'fattest',
    'chubby',
    'pudgy',
    'plump',
    'podgy',
    'flabby',
    'flab',
    'blubber',
    'lardy',
    'porky',
    'jiggly',
    'jiggle',
    'wobbly bits',
    'saggy',
    'cellulite',
    'orange peel',
    'muffin top',
    'love handles',
    'spare tyre',
    'spare tire',
    'beer belly',
    'pot belly',
    'belly fat',
    'thunder thighs',
    'bingo wings',
    'dad bod',
    'mum tum',
    'skinny',
    'scrawny',
    'too thin',
    'too fat',
    'too big',
    'too heavy',
    'obese',
    'obesity',
    'overweight',
    'underweight',
    'excess weight',
    'extra pounds',
    'unwanted fat',
    'stubborn fat',
    'problem areas',
    'problem zones',
    'trouble spots',
    'bikini body',
    'beach body',
    'summer body',
    'body goals',
    'perfect body',
    'ideal body',
    'ideal weight',
    'dream body',
    'flawless body',
    'get your body back',
    'let yourself go',
    'ugly',
    'gross',
    'disgusting',
    'embarrassing body',
    'unflattering',
    'real women',
    'real men',
  ],
  fr: [
    'grassouillet',
    'grassouillette',
    'rondouillard',
    'gros lard',
    'grosse vache',
    'bouboule',
    'gras du bide',
    'bide',
    'bourrelet',
    'poignees d\'amour',
    'culotte de cheval',
    'peau d\'orange',
    'cellulite',
    'flasque',
    'ventre plat',
    'trop gros',
    'trop grosse',
    'trop maigre',
    'maigrichon',
    'maigrichonne',
    'squelettique',
    'obese',
    'obesite',
    'surpoids',
    'kilos en trop',
    'graisse tenace',
    'graisse disgracieuse',
    'zones a probleme',
    'zones problematiques',
    'corps parfait',
    'corps ideal',
    'poids ideal',
    'silhouette ideale',
    'corps de reve',
    'corps d\'ete',
    'retrouver votre corps',
    'se laisser aller',
    'moche',
    'degoutant',
    'disgracieux',
    'disgracieuse',
    'vraies femmes',
    'vrais hommes',
  ],
});

/** Neutral phrases that contain the word "fat" (EN): measures and a goal, not judgements. */
export const ALLOWED_FAT_PHRASES: readonly string[] = Object.freeze(['body fat', 'body-fat', 'fat loss', 'fat-loss']);

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[  ]/g, ' ')
    .toLowerCase();

const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);

/** Whole-word (or whole-phrase) occurrences of `phrase` in folded `text`. */
function containsWord(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
    if (!isLetter(text[at - 1]) && !isLetter(text[at + phrase.length])) return true;
  }
  return false;
}

/** The denylisted body-shaming terms found in `text` (empty = none). */
export function judgementalBodyTerms(text: string, locale: Locale): string[] {
  const folded = fold(text);
  const found = BODY_SHAMING_DENYLIST[locale].filter((term) => containsWord(folded, fold(term)));
  if (locale === 'en') {
    let masked = folded;
    for (const allowed of ALLOWED_FAT_PHRASES) masked = masked.split(allowed).join(' '.repeat(allowed.length));
    if (containsWord(masked, 'fat')) found.push('fat');
  }
  return found;
}
