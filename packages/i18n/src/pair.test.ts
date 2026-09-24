import { describe, expect, it } from 'vitest';
import { en } from './catalogues/en.js';
import { fr } from './catalogues/fr.js';
import { pairEn } from './catalogues/pair.en.js';
import { judgementalBodyTerms } from './body-language.js';
import { guiltPhrases } from './guilt.js';
import { pairPressurePhrases } from './pair-language.js';
import { createTranslator } from './translator.js';

const pairKeys = Object.keys(pairEn) as (keyof typeof pairEn)[];

describe('M09 Fair Pair copy', () => {
  it('every pair message exists in FR and EN, and renders with sample values', () => {
    const values = { name: 'Awa', other: 'Ibrahima', exercise: 'Air squat', sets: 3, set: 1, seconds: 30, minutes: 40, points: 96, weight: '60 kg', load: '10 kg', title: 'Notice' };
    for (const locale of ['en', 'fr'] as const) {
      const t = createTranslator(locale).t;
      for (const key of pairKeys) {
        expect(key in (locale === 'en' ? en : fr)).toBe(true);
        expect(t(key, values).length).toBeGreaterThan(0);
      }
    }
  });

  it('no rivalry, age or pressure wording, no guilt and no body judgement, in either language', () => {
    for (const key of pairKeys) {
      expect({ key, pressure: pairPressurePhrases(en[key], 'en'), guilt: guiltPhrases(en[key], 'en'), body: judgementalBodyTerms(en[key], 'en') }).toEqual({ key, pressure: [], guilt: [], body: [] });
      expect({ key, pressure: pairPressurePhrases(fr[key], 'fr'), guilt: guiltPhrases(fr[key], 'fr'), body: judgementalBodyTerms(fr[key], 'fr') }).toEqual({ key, pressure: [], guilt: [], body: [] });
    }
    // The pair challenge notice and the partner-sharing consent text too (drafts owned by M20).
    for (const key of ['legal.notice.pairChallenge.v1.title', 'legal.notice.pairChallenge.v1.body', 'legal.consent.partner_sharing.v1.body'] as const) {
      expect(pairPressurePhrases(en[key], 'en')).toEqual([]);
      expect(pairPressurePhrases(fr[key], 'fr')).toEqual([]);
    }
  });

  it('catches rivalry, age and pressure language, whatever the case or accents (mutation check)', () => {
    expect(pairPressurePhrases('Awa is the WINNER today', 'en')).toEqual([' winner']);
    expect(pairPressurePhrases('Not bad for your age', 'en')).toContain('for your age');
    expect(pairPressurePhrases('Push through the pain', 'en')).toContain('push through');
    expect(pairPressurePhrases('Ibrahima est le gagnant', 'fr')).toEqual(['gagnant']);
    expect(pairPressurePhrases('Pas mal pour votre âge', 'fr')).toContain('pour votre age');
    expect(pairPressurePhrases('Ne vous arrêtez pas !', 'fr')).toContain('ne vous arretez pas');
    expect(pairPressurePhrases('Each of you against your own plan', 'en')).toEqual([]);
  });
});
