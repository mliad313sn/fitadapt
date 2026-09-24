import { describe, expect, it } from 'vitest';
import { progressEn } from './catalogues/progress.en.js';
import { progressFr } from './catalogues/progress.fr.js';
import { ALLOWED_FAT_PHRASES, BODY_SHAMING_DENYLIST, createTranslator, en, fr, guiltPhrases, judgementalBodyTerms } from './index.js';

/** M04 wording: no body-shaming anywhere, forecasts labelled as estimates, no guilt. */
describe('M04 copy test: no judgemental body terms in the FR and EN catalogues (goal condition 6)', () => {
  it('scans every message of both catalogues and finds none of the denylisted terms', () => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThan(1500);
    const hits: string[] = [];
    for (const key of keys) {
      for (const term of judgementalBodyTerms(en[key], 'en')) hits.push(`en ${key}: ${term}`);
      for (const term of judgementalBodyTerms(fr[key], 'fr')) hits.push(`fr ${key}: ${term}`);
    }
    expect(hits).toEqual([]);
  });

  it('fails on a denylisted term, whatever the case, accents or apostrophes (mutation check)', () => {
    const tainted = { ...en, 'progress.body.trendNote': 'Say goodbye to those Love Handles and get a beach body!' };
    const hitsEn = Object.values(tainted).flatMap((m) => judgementalBodyTerms(m, 'en'));
    expect(hitsEn).toEqual(expect.arrayContaining(['love handles', 'beach body']));
    const taintedFr = { ...fr, 'progress.body.trendNote': 'Adieu les POIGNÉES D’AMOUR, bonjour le poids idéal.' };
    const hitsFr = Object.values(taintedFr).flatMap((m) => judgementalBodyTerms(m, 'fr'));
    expect(hitsFr).toEqual(expect.arrayContaining(["poignees d'amour", 'poids ideal']));
    expect(judgementalBodyTerms('You are overweight', 'en')).toEqual(['overweight']);
    expect(judgementalBodyTerms('Vous êtes en surpoids', 'fr')).toEqual(['surpoids']);
    expect(judgementalBodyTerms('Too fat for this?', 'en')).toEqual(expect.arrayContaining(['too fat', 'fat']));
    expect(judgementalBodyTerms('Burn that fat', 'en')).toEqual(['fat']);
  });

  it('allows the neutral measure and goal names, and whole words only', () => {
    expect(judgementalBodyTerms('Body-fat estimate (%), optional', 'en')).toEqual([]);
    expect(judgementalBodyTerms('Lose body fat', 'en')).toEqual([]);
    expect(judgementalBodyTerms('Your goal is fat loss: the plan keeps your strength work', 'en')).toEqual([]);
    // Whole words: "grossly" and "Fatima" are not "gross" and "fat"; "bidet" is not "bide".
    expect(judgementalBodyTerms('Fatima grossly underestimated the fatigue', 'en')).toEqual([]);
    expect(judgementalBodyTerms('Un bidet', 'fr')).toEqual([]);
    expect(ALLOWED_FAT_PHRASES).toContain('body fat');
    expect(BODY_SHAMING_DENYLIST.en.length).toBeGreaterThan(40);
    expect(BODY_SHAMING_DENYLIST.fr.length).toBeGreaterThan(30);
  });
});

describe('M04 progress copy', () => {
  it('FR and EN carry the same keys and the forecast label in both languages', () => {
    expect(Object.keys(progressFr).sort()).toEqual(Object.keys(progressEn).sort());
    expect(createTranslator('en').t('progress.forecast.label')).toBe('Estimate, not a guarantee');
    expect(createTranslator('fr').t('progress.forecast.label')).toBe('Estimation, pas une garantie');
  });

  it('has no guilt language about missed sessions or streaks', () => {
    const hits: string[] = [];
    for (const [key, text] of Object.entries(progressEn)) for (const p of guiltPhrases(text, 'en')) hits.push(`en ${key}: ${p}`);
    for (const [key, text] of Object.entries(progressFr)) for (const p of guiltPhrases(text, 'fr')) hits.push(`fr ${key}: ${p}`);
    expect(hits).toEqual([]);
  });
});
