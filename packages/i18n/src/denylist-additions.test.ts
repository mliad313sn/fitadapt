import { describe, expect, it } from 'vitest';
import { judgementalBodyTerms } from './body-language.js';
import { guiltPhrases } from './guilt.js';
import { nutritionCopyPhrases } from './nutrition-language.js';
import { pairPressurePhrases } from './pair-language.js';

/**
 * FIX-B: the denylist additions of the AI pre-review
 * docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md (M10-25, M09-3,
 * X-1, X-2). A pre-review, not a sign-off: seats A6 and A4 and a native FR
 * editor confirm the lists. Each sentence below is fictional copy that must
 * be caught; the shipped catalogues are checked by the existing tests.
 */
describe('FIX-B denylist additions (A4/A6 pre-review)', () => {
  it.each([
    ['Eat back your calories after the run', 'eat back your calories'],
    ['You have 300 calories left', 'calories left'],
    ['Your daily allowance', 'allowance'],
    ['Treat yourself tonight', 'treat yourself'],
    ['Reward yourself with dessert', 'reward yourself'],
    ['Go on, indulge', 'indulge'],
    ['A fat-burning breakfast', 'fat-burning'],
    ['Boost your metabolism', 'boost your metabolism'],
    ['Flush the toxins', 'toxins'],
    ['Skip a meal if you ate late', 'skip a meal'],
    ['Do not starve yourself', 'starve'],
  ])('nutrition EN (M10-25): "%s"', (text, phrase) => {
    expect(nutritionCopyPhrases(text, 'en')).toContain(phrase);
  });

  it.each([
    ['Un petit-déjeuner brûle-graisse', 'brule-graisse'],
    ['Une récompense après la séance', 'recompense'],
    ['Pas besoin de vous priver : ne sautez pas... sauter un repas', 'sauter un repas'],
    ['Éliminez les toxines', 'toxines'],
    ['Boostez... booster le métabolisme', 'booster le metabolisme'],
    ['Il vous reste des calories restantes', 'calories restantes'],
  ])('nutrition FR (M10-25): "%s"', (text, phrase) => {
    expect(nutritionCopyPhrases(text, 'fr')).toContain(phrase);
  });

  it.each([
    ['Can you keep up today?', 'can you keep up'],
    ['Who is first to finish?', ' first to'],
    ['See the leaderboard', ' leaderboard'],
    ['Your rank this week', ' rank '],
    ["Don't let your partner down", "don't let your partner down"],
    ['Your partner is waiting', 'your partner is waiting'],
    ['Strong for a woman', 'for a woman'],
  ])('pair EN (M09-3): "%s"', (text, phrase) => {
    expect(pairPressurePhrases(text, 'en')).toContain(phrase);
  });

  it.each([
    ['Arriverez-vous à tenir le rythme ?', 'tenir le rythme'],
    ['Votre place au classement', ' classement'],
    ['Votre partenaire vous attend', 'votre partenaire vous attend'],
    ['Fort pour une femme', 'pour une femme'],
  ])('pair FR (M09-3): "%s"', (text, phrase) => {
    expect(pairPressurePhrases(text, 'fr')).toContain(phrase);
  });

  it.each([
    ['We miss you! Come back', 'we miss you'],
    ['Your streak is at risk', 'your streak is at risk'],
    ['Last chance to keep it', 'last chance'],
    ['Everyone else trained today', 'everyone else'],
  ])('guilt EN (X-1): "%s"', (text, phrase) => {
    expect(guiltPhrases(text, 'en')).toContain(phrase);
  });

  it.each([
    ['Vous nous manquez', 'vous nous manquez'],
    ['Dernière chance', 'derniere chance'],
    ['Votre série est en danger', 'votre serie est en danger'],
  ])('guilt FR (X-1): "%s"', (text, phrase) => {
    expect(guiltPhrases(text, 'fr')).toContain(phrase);
  });

  it.each([
    ['Get a flat belly', 'flat belly'],
    ['Tone up for summer', 'tone up'],
    ['Lose the baby weight', 'baby weight'],
    ['Get shredded', 'shredded'],
  ])('body EN (X-2): "%s"', (text, phrase) => {
    expect(judgementalBodyTerms(text, 'en')).toContain(phrase);
  });

  it.each([
    ['Perdre du ventre en 4 semaines', 'perdre du ventre'],
    ['Mincir sans effort', 'mincir'],
    ['Une silhouette de rêve', 'silhouette de reve'],
  ])('body FR (X-2): "%s"', (text, phrase) => {
    expect(judgementalBodyTerms(text, 'fr')).toContain(phrase);
  });
});
