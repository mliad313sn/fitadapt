import type { Locale } from './locale.js';

/**
 * M09 Fair Pair: no rivalry, age or pressure wording (vision "no
 * body-shaming, no guilt messaging"; L4 "no mechanic pressures users to
 * continue through pain or fatigue"; seat A6 to review). Phrases that rank
 * partners against each other, mention age, or push someone to keep going.
 * Checked over every pair message and every string the pair screen shows,
 * with the guilt and body-language denylists. Matching ignores case and accents.
 */
export const PAIR_PRESSURE_DENYLIST: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: [' winner', ' loser', ' won ', ' lost ', ' beat ', ' beats ', 'you lose', 'defeat', 'weaker', 'stronger than', 'better than', 'worse than', ' too old', ' old ', 'for your age', 'at your age', 'at your weight', 'push through', 'keep going no matter', 'no excuses', 'don’t stop', "don't stop", 'toughen', 'man up', 'beat your partner', 'ahead of', 'behind your partner'],
  fr: ['gagnant', 'perdant', 'a gagne', 'a perdu', 'battre', 'battu', 'plus faible', 'plus fort que', 'meilleur que', 'moins bien que', 'trop vieux', 'trop vieille', ' vieux ', ' vieille ', 'pour votre age', 'pour ton age', 'a ton age', 'serrez les dents', 'sans excuse', 'ne vous arretez pas', 'ne t’arrete pas', "ne t'arrete pas", 'devant votre partenaire', 'derriere votre partenaire'],
});

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The denylisted rivalry, age or pressure phrases found in `text` (empty = none). */
export function pairPressurePhrases(text: string, locale: Locale): string[] {
  const folded = ` ${fold(text)} `;
  return PAIR_PRESSURE_DENYLIST[locale].filter((phrase) => folded.includes(fold(phrase)));
}
