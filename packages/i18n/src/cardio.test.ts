import { describe, expect, it } from 'vitest';
import { cardioEn } from './catalogues/cardio.en.js';
import { cardioFr } from './catalogues/cardio.fr.js';
import { createTranslator, en, fatBurnClaims, FAT_BURN_DENYLIST, fr, guiltPhrases } from './index.js';

/** M03 wording: honest physiology (C9), FR and EN, no guilt or pressure. */
describe('M03 honest physiology: no "fat-burning zone" and no lipolysis claim (goal condition 6)', () => {
  it('scans every message of the FR and EN catalogues and finds none of the phrases, in either language', () => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThan(1500);
    const hits: string[] = [];
    for (const key of keys) {
      for (const phrase of fatBurnClaims(en[key])) hits.push(`en ${key}: ${phrase}`);
      for (const phrase of fatBurnClaims(fr[key])) hits.push(`fr ${key}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });

  it('catches the phrases and their French equivalents, whatever the case, accents, hyphens or spacing (mutation check)', () => {
    expect(fatBurnClaims('Stay in the Fat-Burning   Zone!', 'en')).toContain('fat burning zone');
    expect(fatBurnClaims('Reach maximum lipolysis today', 'en')).toEqual(expect.arrayContaining(['maximum lipolysis', 'lipolysis']));
    expect(fatBurnClaims('Restez dans la zone de combustion des graisses', 'fr')).toContain('zone de combustion des graisses');
    expect(fatBurnClaims('La zone brûle-graisses', 'fr')).toContain('zone brule graisses');
    expect(fatBurnClaims('Atteignez la LIPOLYSE MAXIMALE', 'fr')).toEqual(expect.arrayContaining(['lipolyse maximale', 'lipolyse']));
    // Mixed-language copy is scanned with both lists.
    expect(fatBurnClaims('fat burning zone / zone de brûlage des graisses')).toEqual(expect.arrayContaining(['fat burning zone', 'zone de brulage des graisses']));
    // A catalogue carrying one of them would fail the scan above.
    const tainted = { ...en, 'cardio.zone.moderate': 'Moderate (fat-burning zone)' };
    expect(Object.values(tainted).flatMap((m) => fatBurnClaims(m))).toContain('fat burning zone');
    const taintedFr = { ...fr, 'cardio.zone.moderate': 'Modéré (lipolyse maximale)' };
    expect(Object.values(taintedFr).flatMap((m) => fatBurnClaims(m))).toContain('lipolyse maximale');
    // Honest wording is not flagged.
    expect(fatBurnClaims(en['cardio.zone.moderate'])).toEqual([]);
    expect(fatBurnClaims('Moderate effort: you can still talk in short sentences.')).toEqual([]);
    expect(FAT_BURN_DENYLIST.en).toEqual(expect.arrayContaining(['fat burning zone', 'maximum lipolysis']));
    expect(FAT_BURN_DENYLIST.fr).toEqual(expect.arrayContaining(['zone de combustion des graisses', 'lipolyse maximale']));
  });
});

describe('M03 cardio copy', () => {
  it('exists in both languages with the same placeholders and renders', () => {
    expect(Object.keys(cardioFr).sort()).toEqual(Object.keys(cardioEn).sort());
    const tEn = createTranslator('en');
    const tFr = createTranslator('fr');
    expect(tEn.t('cardio.cue.work', { exercise: 'Burpee', round: 3, rounds: 8 })).toBe('Go: Burpee. Round 3 of 8.');
    expect(tFr.t('cardio.cue.work', { exercise: 'Burpee', round: 3, rounds: 8 })).toBe('C’est parti : Burpee. Tour 3 sur 8.');
    expect(tEn.t('cardio.ledger.summary', { minutes: 95, min: 150, max: 300 })).toBe('95 of the 150–300 minute weekly range');
    expect(tFr.t('cardio.preview.blocks', { blocks: 2, rounds: 8, work: 20, rest: 10 })).toBe('2 blocs de 8 tours : 20 s d’effort, 10 s faciles.');
    expect(tEn.t('cardio.cue.countdown', { count: 3 })).toBe('Three');
    expect(tFr.t('cardio.cue.countdown', { count: 1 })).toBe('Un');
  });

  it('no guilt or pressure, and no health or weight-loss promise, in English and in French', () => {
    const promise = /lose weight|weight loss|slim|perdre du poids|perte de poids|maigri|healthy heart|cœur en bonne santé/i;
    for (const key of Object.keys(cardioEn) as (keyof typeof cardioEn)[]) {
      expect({ key, hits: guiltPhrases(en[key], 'en') }).toEqual({ key, hits: [] });
      expect({ key, hits: guiltPhrases(fr[key], 'fr') }).toEqual({ key, hits: [] });
      expect({ key, en: promise.test(en[key]), fr: promise.test(fr[key]) }).toEqual({ key, en: false, fr: false });
    }
  });
});
