import { describe, expect, it } from 'vitest';
import { en } from './catalogues/en.js';
import { FOOD_TEXT, FOOD_TEXT_IDS, foodLocalName } from './catalogues/foods.js';
import { fr } from './catalogues/fr.js';
import { nutritionEn } from './catalogues/nutrition.en.js';
import { nutritionFr } from './catalogues/nutrition.fr.js';
import { judgementalBodyTerms } from './body-language.js';
import { guiltPhrases } from './guilt.js';
import { fatBurnClaims } from './honest-physiology.js';
import { NUTRITION_COPY_DENYLIST, nutritionCopyPhrases } from './nutrition-language.js';
import { createTranslator } from './translator.js';
import type { Locale } from './locale.js';

/**
 * M10 goal condition 5: a copy test over the nutrition catalogues that fails
 * on "earn", "burn it off", "cheat meal" and their French equivalents — with
 * the M08 no-guilt and M04 body-shaming denylists and the C9 fat-burn guard
 * over the same messages.
 */
type Catalogue = Readonly<Record<string, string>>;

/** Every nutrition message of a catalogue: screens, reason codes, food names, the nutrition L3 notice. */
function nutritionMessages(catalogue: Catalogue): [string, string][] {
  return Object.entries(catalogue).filter(([k]) => k.startsWith('nutrition.') || k.startsWith('engine.reason.nutrition.') || k.startsWith('food.') || k.startsWith('legal.notice.nutritionDeficit.'));
}

/** The copy check: every finding of the four denylists in the nutrition messages of a catalogue. */
function nutritionCopyFindings(catalogue: Catalogue, locale: Locale): { key: string; found: string[] }[] {
  return nutritionMessages(catalogue)
    .map(([key, text]) => ({ key, found: [...nutritionCopyPhrases(text, locale), ...guiltPhrases(text, locale), ...judgementalBodyTerms(text, locale), ...fatBurnClaims(text, locale)] }))
    .filter((f) => f.found.length > 0);
}

describe('M10 nutrition copy', () => {
  it('every nutrition message exists in FR and EN and renders with sample values', () => {
    const values = { kcal: 2270, min: 125, max: 175, protein: 60, percent: '0.5', count: 2, name: 'Thiéboudienne', local: 'Ceebu jën', portion: 'Plate', grams: 400, unit: 'kg', weight: '58.7 kg' };
    for (const locale of ['en', 'fr'] as const) {
      const t = createTranslator(locale).t;
      for (const key of Object.keys(nutritionEn) as (keyof typeof nutritionEn)[]) {
        expect(key in (locale === 'en' ? en : fr), key).toBe(true);
        expect(t(key, values).length, key).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(nutritionFr).sort()).toEqual(Object.keys(nutritionEn).sort());
  });

  it('goal condition 5: the nutrition catalogues have no earn / burn-off / cheat wording, no guilt, no body judgement, no fat-burn claim', () => {
    expect(nutritionMessages(en).length).toBeGreaterThan(300);
    expect(nutritionCopyFindings(en, 'en')).toEqual([]);
    expect(nutritionCopyFindings(fr, 'fr')).toEqual([]);
  });

  it('the copy test fails on "earn", "burn it off", "cheat meal" and the French equivalents (mutation check)', () => {
    const mutated = (catalogue: Catalogue, key: string, text: string) => ({ ...catalogue, [key]: text });
    const cases: [Locale, string, string][] = [
      ['en', 'Great session! You earned a bigger dinner.', 'earned'],
      ['en', 'Had pizza? Burn it off tomorrow.', 'burn it off'],
      ['en', 'Saturday is your cheat meal.', 'cheat meal'],
      ['en', 'EARN your food', 'earn'],
      ['fr', 'Bravo, vous avez mérité ce dessert.', 'merite'],
      ['fr', 'Une séance pour éliminer le repas d’hier.', 'eliminer'],
      ['fr', 'Samedi, c’est votre repas de triche.', 'repas de triche'],
      ['fr', 'Brûlez les calories du week-end.', 'brulez'],
    ];
    for (const [locale, text, expected] of cases) {
      const base = locale === 'en' ? en : fr;
      const findings = nutritionCopyFindings(mutated(base, 'nutrition.intro', text), locale);
      expect(findings.map((f) => f.key), text).toEqual(['nutrition.intro']);
      expect(findings[0]!.found, text).toContain(expected);
    }
    // Food names are nutrition copy too.
    expect(nutritionCopyFindings(mutated(en, 'food.cookie.name', 'Guilt-free cookie'), 'en')[0]!.found).toEqual(expect.arrayContaining(['guilt-free']));
    expect(nutritionCopyFindings(mutated(fr, 'food.cookie.name', 'Biscuit sans culpabilité'), 'fr')[0]!.found).toEqual(expect.arrayContaining(['sans culpabilite']));
  });

  it('matches whole words only, ignoring case and accents', () => {
    expect(nutritionCopyPhrases('Learn how portions work', 'en')).toEqual([]);
    expect(nutritionCopyPhrases('Heartburn', 'en')).toEqual([]);
    expect(nutritionCopyPhrases('Une pêche bien mûre', 'fr')).toEqual([]);
    expect(nutritionCopyPhrases('Crème brûlée', 'fr')).toEqual([]);
    expect(nutritionCopyPhrases('ÉLIMINEZ ce repas', 'fr')).toEqual(['eliminez']);
    expect(NUTRITION_COPY_DENYLIST.en).toEqual(expect.arrayContaining(['earn', 'burn it off', 'cheat meal']));
    expect(NUTRITION_COPY_DENYLIST.fr).toEqual(expect.arrayContaining(['merite', 'eliminer', 'repas de triche']));
  });
});

describe('M10 food names', () => {
  it('at least 200 foods, each with a FR and an EN name; local names are the same in both languages', () => {
    expect(FOOD_TEXT_IDS.length).toBeGreaterThanOrEqual(200);
    for (const id of FOOD_TEXT_IDS) {
      const text = FOOD_TEXT[id] as { en: string; fr: string; local?: string };
      expect(text.en.trim().length, id).toBeGreaterThan(1);
      expect(text.fr.trim().length, id).toBeGreaterThan(1);
      expect(en[`food.${id}.name` as keyof typeof en], id).toBe(text.en);
      expect(fr[`food.${id}.name` as keyof typeof fr], id).toBe(text.fr);
      expect(foodLocalName(id)).toBe(text.local ?? null);
      if (text.local) expect(nutritionCopyPhrases(text.local, 'en').concat(nutritionCopyPhrases(text.local, 'fr'), guiltPhrases(text.local, 'fr'), judgementalBodyTerms(text.local, 'en'))).toEqual([]);
    }
  });

  it('includes regional dishes with a local name (Senegal, West and Central Africa, North Africa, France)', () => {
    for (const id of ['thieboudienne', 'yassa_chicken', 'mafe', 'attieke', 'ndole', 'harira', 'boeuf_bourguignon'] as const) expect(FOOD_TEXT_IDS).toContain(id);
    expect(foodLocalName('thieboudienne')).toBe('Ceebu jën');
    expect(foodLocalName('nope')).toBeNull();
    expect(FOOD_TEXT_IDS.filter((id) => 'local' in FOOD_TEXT[id]).length).toBeGreaterThanOrEqual(50);
  });
});
