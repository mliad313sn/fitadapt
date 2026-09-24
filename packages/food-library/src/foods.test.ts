import { M10_REASON_CODES } from '@fitadapt/engine';
import { FOOD_TEXT_IDS, createTranslator, en, foodLocalName, fr, type MessageKey } from '@fitadapt/i18n';
import { FOOD_DATA_LICENCES, FoodItemSchema, type FoodItem } from '@fitadapt/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOOD_SEED, FOOD_SEED_SOURCE_NOTE, estimateFood, estimateIntake, foodById, normaliseFoodText, searchFoods, seedProblems, type FoodNames } from './index.js';

/**
 * M10 goal conditions 4 and 7 (library side): a seed of ≥ 200 foods with
 * regional dishes, FR/EN names and typical portions, all validated:false;
 * every item records its source and licence (schema test); search works
 * with no network at all.
 */
const namesIn = (locale: 'en' | 'fr'): FoodNames => {
  const t = createTranslator(locale).t;
  return { name: (f) => t(`food.${f.id}.name` as MessageKey), local: (f) => foodLocalName(f.id) };
};
const EN = namesIn('en');
const FR = namesIn('fr');

describe('the food seed', () => {
  it('has at least 200 foods and every one is schema-valid', () => {
    expect(FOOD_SEED.length).toBeGreaterThanOrEqual(200);
    expect(seedProblems()).toEqual([]);
  });

  it('goal condition 7: every item records its source and its licence; every value is an estimate, validated:false', () => {
    for (const f of FOOD_SEED) {
      expect(f.source, f.id).toEqual({ kind: 'estimate', note: FOOD_SEED_SOURCE_NOTE });
      expect(FOOD_DATA_LICENCES, f.id).toContain(f.licence);
      expect(f.licence).toBe('Owned');
      expect(f.validated, f.id).toBe(false);
      expect(f.validatedBy).toBeUndefined();
    }
    expect(FOOD_SEED_SOURCE_NOTE).toMatch(/Estimated.*not copied from any database.*seat A4/);
  });

  it('the schema refuses an item without a source or a licence, a share-alike licence, or validated:true without a sign-off', () => {
    const item = FOOD_SEED[0]!;
    const { source: _s, ...noSource } = item;
    const { licence: _l, ...noLicence } = item;
    expect(FoodItemSchema.safeParse(noSource).success).toBe(false);
    expect(FoodItemSchema.safeParse(noLicence).success).toBe(false);
    expect(FoodItemSchema.safeParse({ ...item, licence: 'ODbL-1.0' }).success).toBe(false);
    expect(FoodItemSchema.safeParse({ ...item, licence: 'CC-BY-SA-4.0' }).success).toBe(false);
    expect(FoodItemSchema.safeParse({ ...item, validated: true }).success).toBe(false);
    expect(FoodItemSchema.safeParse({ ...item, source: { kind: 'public', citation: 'x' } }).success).toBe(false);
    expect(FoodItemSchema.safeParse({ ...item, defaultPortion: 'can' }).success).toBe(false);
    expect(seedProblems([item, item, { ...item, id: 'other', licence: 'ODbL-1.0' } as unknown as FoodItem])).toEqual([expect.stringContaining('duplicate'), expect.stringContaining('other:')]);
  });

  it('every food has an FR and an EN name in packages/i18n, and every name has a food', () => {
    expect(FOOD_SEED.map((f) => f.id).sort()).toEqual([...FOOD_TEXT_IDS].sort());
    for (const f of FOOD_SEED) {
      expect(en[`food.${f.id}.name` as keyof typeof en], f.id).toBeTruthy();
      expect(fr[`food.${f.id}.name` as keyof typeof fr], f.id).toBeTruthy();
      expect(f.hasLocalName, f.id).toBe(foodLocalName(f.id) !== null);
    }
  });

  it('carries regional dishes with typical portions (Senegal, West and Central Africa, North Africa, France)', () => {
    const dishes = FOOD_SEED.filter((f) => f.category === 'dishes');
    expect(dishes.length).toBeGreaterThanOrEqual(40);
    for (const region of ['senegal', 'west_africa', 'central_africa', 'north_africa', 'france'] as const) expect(dishes.filter((d) => d.regions.includes(region)).length, region).toBeGreaterThanOrEqual(5);
    const thieb = foodById('thieboudienne')!;
    expect(thieb).toMatchObject({ category: 'dishes', hasLocalName: true, defaultPortion: 'plate' });
    expect(thieb.portions).toContainEqual({ id: 'plate', grams: 400 });
    expect(FOOD_SEED.filter((f) => f.hasLocalName).length).toBeGreaterThanOrEqual(50);
    // Every food has a typical portion besides 100 g, except none.
    for (const f of FOOD_SEED) expect(f.portions.some((p) => p.id !== 'g100'), f.id).toBe(true);
  });
});

describe('offline food search (goal condition 4)', () => {
  const fetchSpy = vi.fn(() => {
    throw new Error('no network in airplane mode');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('finds foods by the name in either language, by the local name, ignoring accents and case — with the network gone', () => {
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', undefined);
    expect(searchFoods({ text: 'thieboudienne' }, FR).map((f) => f.id)).toEqual(['thieboudienne']);
    expect(searchFoods({ text: 'Ceebu jen' }, EN).map((f) => f.id)).toEqual(['thieboudienne']);
    expect(searchFoods({ text: 'fish and rice' }, EN).map((f) => f.id)).toContain('thieboudienne');
    expect(searchFoods({ text: 'ATTIÉKÉ' }, FR).map((f) => f.id)).toEqual(expect.arrayContaining(['attieke', 'garba']));
    expect(searchFoods({ text: 'riz' }, EN, FR).length).toBeGreaterThan(5);
    expect(searchFoods({ text: 'yaourt' }, FR)[0]!.category).toBe('dairy');
    expect(searchFoods({ text: 'mafe' }, EN, FR).map((f) => f.id)).toEqual(['mafe']);
    expect(searchFoods({ text: 'maafe' }, EN).map((f) => f.id)).toEqual(['mafe']);
    expect(searchFoods({ text: 'zzzz' }, EN)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters by category and region, puts names that start with the words first, and limits', () => {
    const senegal = searchFoods({ region: 'senegal', category: 'dishes' }, EN);
    expect(senegal.length).toBeGreaterThanOrEqual(10);
    expect(senegal.every((f) => f.regions.includes('senegal') && f.category === 'dishes')).toBe(true);
    const rice = searchFoods({ text: 'rice' }, EN);
    expect(EN.name(rice[0]!).toLowerCase().startsWith('rice')).toBe(true);
    expect(searchFoods({ text: 'rice', limit: 3 }, EN)).toHaveLength(3);
    expect(searchFoods({}, EN)).toHaveLength(FOOD_SEED.length);
    expect(normaliseFoodText('Ñebbe, niébé !')).toBe('nebbe niebe');
  });
});

describe('estimates on the seed', () => {
  it('a portion of a food and an intake entry', () => {
    expect(estimateFood('thieboudienne', 'plate', 1)).toEqual({ energyKcal: 640, proteinG: 32, reasonCode: 'nutrition.portion.food_estimate' });
    expect(estimateIntake({ kind: 'food', foodId: 'rice_white_cooked', portionId: 'cup', count: 1 }).energyKcal).toBe(208);
    expect(estimateIntake({ kind: 'hand_portion', portion: 'protein_palm', count: 1 }).proteinG).toBe(25);
    expect(() => estimateFood('nope', 'plate', 1)).toThrow(RangeError);
  });
});

describe('M10 reason codes in FR and EN', () => {
  it('every nutrition reason code has a sentence in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      const catalogue = locale === 'en' ? en : fr;
      for (const code of M10_REASON_CODES) expect(catalogue[`engine.reason.${code}` as keyof typeof catalogue], `${locale} ${code}`).toBeTruthy();
    }
  });
});
