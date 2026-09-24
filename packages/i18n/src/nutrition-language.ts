import type { Locale } from './locale.js';

/**
 * M10 nutrition copy (spec Rules: "No 'earn your food' mechanics linking
 * exercise calories to allowed intake"; CLAUDE.md rule 8: no body-shaming,
 * no guilt; disordered-eating guardrails, seats A4 and A6). Words and phrases
 * that make food something to earn, pay back, burn off or feel guilty about,
 * that sort foods into good and bad or "cheat", or that sell restriction.
 * Checked with the guilt and body-shaming denylists over every nutrition and
 * food message (packages/i18n `nutrition.*`, `food.*`, the nutrition reason
 * codes, the nutrition L3 notice). Matching ignores case and accents and
 * treats ’ as '; entries match whole words or phrases ("earn" does not match
 * "learn"). The list is the engineer's first draft for A4, A6 and a native
 * FR editor to review.
 */
export const NUTRITION_COPY_DENYLIST: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: [
    'earn',
    'earns',
    'earned',
    'earning',
    'earn your food',
    'burn it off',
    'burn off',
    'burned off',
    'burnt off',
    'burn calories',
    'burn those calories',
    'work it off',
    'work off',
    'pay for',
    'pay it back',
    'cheat',
    'cheat meal',
    'cheat meals',
    'cheat day',
    'guilt-free',
    'guilty',
    'guilty pleasure',
    'sinful',
    'naughty',
    'junk food',
    'bad food',
    'bad foods',
    'good food',
    'good foods',
    'forbidden',
    'off limits',
    'clean eating',
    'eat clean',
    'detox',
    'cleanse',
    'deserve',
    'deserved',
    'compensate',
    'compensation',
    'undo',
    'damage',
    'blow your diet',
    'fell off the wagon',
    'no excuses',
    'willpower',
    'empty calories',
    // FIX-B: additions from docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md (M10-25), AI pre-review, A6/A4 and a native FR editor to confirm.
    'eat back',
    'eat back your calories',
    'calorie budget',
    'calories left',
    'allowance',
    'treat yourself',
    'reward yourself',
    'indulge',
    'sin',
    'fat-burning',
    'fat burner',
    'boost your metabolism',
    'toxins',
    'starve',
    'skip a meal',
    'skip meals',
  ],
  fr: [
    'merite',
    'meriter',
    'meritez',
    'meritee',
    'merites',
    'gagner votre repas',
    'bruler',
    'brulez',
    'brule',
    'bruler des calories',
    'eliminer',
    'eliminez',
    'elimine',
    'repas de triche',
    'jour de triche',
    'triche',
    'tricher',
    'craquage',
    'craquer',
    'craque',
    'ecart',
    'ecarts',
    'faire un ecart',
    'malbouffe',
    'aliment interdit',
    'aliments interdits',
    'interdit',
    'mauvais aliment',
    'mauvais aliments',
    'bon aliment',
    'bons aliments',
    'manger propre',
    'detox',
    'coupable',
    'plaisir coupable',
    'sans culpabilite',
    'compenser',
    'compensez',
    'compensation',
    'rattraper',
    'volonte',
    'calories vides',
    'payer',
    // FIX-B: additions from docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md (M10-25), AI pre-review, A6/A4 and a native FR editor to confirm.
    'brule-graisse',
    'bruler les graisses',
    'recompense',
    'se recompenser',
    'se priver',
    'sauter un repas',
    'toxines',
    'booster le metabolisme',
    'calories restantes',
  ],
});

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ')
    .toLowerCase();

const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);

function containsWord(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
    if (!isLetter(text[at - 1]) && !isLetter(text[at + phrase.length])) return true;
  }
  return false;
}

/** The denylisted "earn / burn off / cheat / guilt" nutrition phrases found in `text` (empty = none). */
export function nutritionCopyPhrases(text: string, locale: Locale): string[] {
  const folded = fold(text);
  return NUTRITION_COPY_DENYLIST[locale].filter((phrase) => containsWord(folded, fold(phrase)));
}
