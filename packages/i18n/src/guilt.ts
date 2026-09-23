import type { Locale } from './locale.js';

/**
 * "No guilt messaging" (CLAUDE.md rule 8; M08: "no punitive messaging" after
 * a missed session). Phrases that blame, shame, pressure or ask the user to
 * make up for a missed session. Used by tests on the reflow copy and on the
 * calendar screen, in FR and EN. Matching ignores case and accents.
 */
export const NO_GUILT_DENYLIST: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: [
    'failed',
    'failure',
    'fail ',
    'lazy',
    'excuse',
    'should have',
    'shouldn’t have',
    "shouldn't have",
    'you missed',
    'missed out',
    'you skipped',
    'behind schedule',
    'fall behind',
    'fell behind',
    'catch up',
    'make up for',
    'make it up',
    'disappoint',
    'shame',
    'guilt',
    'no pain',
    'don’t give up',
    "don't give up",
    'streak lost',
    'lost your streak',
    'broke your streak',
    'slacking',
    'again?',
    'only you',
    'you let',
    'wasted',
    'penalty',
    'punish',
  ],
  fr: [
    'echec',
    'echoue',
    'rate ',
    'raté',
    'paresse',
    'paresseu',
    'excuse',
    'aurais du',
    'auriez du',
    'vous avez manque',
    'tu as manque',
    'en retard',
    'rattrap',
    'decevant',
    'decu',
    'honte',
    'culpabil',
    'n’abandonnez pas',
    "n'abandonnez pas",
    'serie perdue',
    'perdu votre serie',
    'encore une fois ?',
    'gache',
    'penalite',
    'punition',
    'puni',
  ],
});

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The denylisted phrases found in `text` (empty = no guilt language). */
export function guiltPhrases(text: string, locale: Locale): string[] {
  const folded = ` ${fold(text)} `;
  return NO_GUILT_DENYLIST[locale].filter((phrase) => folded.includes(fold(phrase)));
}
