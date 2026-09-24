import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import {
  catalogues,
  cmToIn,
  createTranslator,
  en,
  formatDistance,
  formatLength,
  formatMass,
  fr,
  inToCm,
  isLocale,
  isMessageKey,
  kgToLb,
  kmToMi,
  lbToKg,
  miToKm,
  resolveLocale,
} from './index.js';

function argumentsOf(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) {
      out.add(el.value);
    } else if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.add(el.value);
      for (const option of Object.values(el.options)) argumentsOf(option.value, out);
    } else if (el.type === TYPE.tag) {
      argumentsOf(el.children, out);
    }
  }
  return out;
}

describe('catalogue parity', () => {
  it('FR and EN have exactly the same keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is valid ICU and uses the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const enArgs = [...argumentsOf(parse(en[key]))].sort();
      const frArgs = [...argumentsOf(parse(fr[key]))].sort();
      expect({ key, args: frArgs }).toEqual({ key, args: enArgs });
    }
  });

  it('no message is empty or left untranslated where wording is expected to differ', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(fr[key].trim().length).toBeGreaterThan(0);
      if (!key.startsWith('units.')) {
        expect({ key, same: fr[key] === en[key] }).toEqual({ key, same: false });
      }
    }
  });

  it('exposes both catalogues', () => {
    expect(catalogues.en).toBe(en);
    expect(catalogues.fr).toBe(fr);
  });
});

describe('translator', () => {
  const tEn = createTranslator('en');
  const tFr = createTranslator('fr');

  it('applies ICU plurals in English', () => {
    expect(tEn.t('home.syncStatus', { count: 0 })).toBe('Everything is synced');
    expect(tEn.t('home.syncStatus', { count: 1 })).toBe('1 change waiting to sync');
    expect(tEn.t('home.syncStatus', { count: 3 })).toBe('3 changes waiting to sync');
  });

  it('applies French plural rules (1 is singular, 2+ plural)', () => {
    expect(tFr.t('home.syncStatus', { count: 1 })).toBe('1 modification en attente de synchronisation');
    expect(tFr.t('home.syncStatus', { count: 2 })).toBe('2 modifications en attente de synchronisation');
  });

  it('interpolates values and caches formats', () => {
    expect(tEn.t('ui.stepper.increase', { label: 'Reps' })).toBe('Increase Reps');
    expect(tEn.t('ui.stepper.increase', { label: 'Sets' })).toBe('Increase Sets');
    expect(tFr.t('ui.stepper.decrease', { label: 'Séries' })).toBe('Diminuer Séries');
  });

  it('formats numbers per locale', () => {
    expect(tEn.formatNumber(1234.5)).toBe('1,234.5');
    expect(tFr.formatNumber(1234.5).replace(/\s/g, ' ')).toBe('1 234,5');
  });

  it('recognises message keys', () => {
    expect(isMessageKey('home.title')).toBe(true);
    expect(isMessageKey('nope')).toBe(false);
  });
});

describe('locale resolution', () => {
  it('picks the first supported language', () => {
    expect(resolveLocale(['de-DE', 'en-GB', 'fr-FR'])).toBe('en');
    expect(resolveLocale('fr-SN')).toBe('fr');
    expect(resolveLocale('EN_us')).toBe('en');
  });
  it('falls back to French', () => {
    expect(resolveLocale(undefined)).toBe('fr');
    expect(resolveLocale(null)).toBe('fr');
    expect(resolveLocale(['de'])).toBe('fr');
    expect(resolveLocale([])).toBe('fr');
  });
  it('validates locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(false);
  });
});

describe('units', () => {
  it('round-trips conversions', () => {
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
    expect(inToCm(cmToIn(180))).toBeCloseTo(180, 10);
    expect(miToKm(kmToMi(5))).toBeCloseTo(5, 10);
    expect(kgToLb(1)).toBeCloseTo(2.20462, 5);
  });

  it('formats mass, length and distance in the user unit system and locale', () => {
    const tEn = createTranslator('en');
    const tFr = createTranslator('fr');
    expect(formatMass(100, 'metric', tEn)).toBe('100 kg');
    expect(formatMass(100, 'imperial', tEn)).toBe('220.5 lb');
    expect(formatMass(62.5, 'metric', tFr)).toBe('62,5 kg');
    expect(formatLength(180, 'metric', tFr)).toBe('180 cm');
    expect(formatLength(2.54, 'imperial', tFr)).toBe('1 po');
    expect(formatLength(2.54, 'imperial', tEn)).toBe('1 in');
    expect(formatDistance(5, 'metric', tEn)).toBe('5 km');
    expect(formatDistance(1.609344, 'imperial', tEn, { maximumFractionDigits: 2 })).toBe('1 mi');
  });
});

describe('M01 screening content', () => {
  it('lives in content files marked "licence check pending", in FR and EN', async () => {
    const { SCREENING_CONTENT_STATUS } = await import('./index.js');
    expect(SCREENING_CONTENT_STATUS).toBe('licence check pending');
    const { readFileSync } = await import('node:fs');
    for (const file of ['screening.en.ts', 'screening.fr.ts']) {
      expect(readFileSync(new URL(`./catalogues/${file}`, import.meta.url), 'utf8')).toContain('licence check pending');
    }
    const keys = Object.keys(en).filter((k) => k.startsWith('screening.question.'));
    // 10 M01 questions + FIX-B: heart-rate medicine (CS-7) and eating disorder (A4 M10-20).
    expect(keys).toHaveLength(12);
    for (const k of keys) expect(fr[k as keyof typeof fr].length).toBeGreaterThan(0);
  });
});
