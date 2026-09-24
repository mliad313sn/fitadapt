import type { Locale } from './locale.js';

/**
 * Honest physiology copy (C9, M03 Rules: "The terms 'fat-burning zone' and
 * 'maximum lipolysis' never appear in UI copy"). Fat oxidation does peak at
 * moderate intensity, but fat loss is driven by energy balance and
 * sustainable volume, so no copy may promise a "fat-burning zone" or
 * lipolysis. Matching ignores case, accents, hyphens and repeated spaces.
 * `pnpm legal:claims` enforces the same rule over every catalogue, store
 * text and prompt (packages/legal CLAIM_DENYLIST); this list is the i18n
 * package's own guard over its catalogues.
 */
export const FAT_BURN_DENYLIST: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: ['fat burning zone', 'fat burn zone', 'fatburning zone', 'fat burning heart rate', 'maximum lipolysis', 'maximal lipolysis', 'lipolysis zone', 'lipolysis', 'fat loss zone', 'fat melting zone'],
  fr: [
    'zone de combustion des graisses',
    'zone de combustion de graisses',
    'zone brule graisse',
    'zone brule graisses',
    'zone de brulage des graisses',
    'zone de perte de graisse',
    'zone de fonte des graisses',
    'zone lipolytique',
    'lipolyse maximale',
    'lipolyse maximum',
    'zone de lipolyse',
    'lipolyse',
  ],
});

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-‐‑–—_’']/g, ' ')
    .replace(/\s+/g, ' ');

/** The denied phrases found in a text (both languages' lists by default: copy can mix languages). */
export function fatBurnClaims(text: string, locale?: Locale): string[] {
  const folded = fold(text);
  const lists = locale ? FAT_BURN_DENYLIST[locale] : [...FAT_BURN_DENYLIST.en, ...FAT_BURN_DENYLIST.fr];
  return lists.filter((phrase) => folded.includes(fold(phrase)));
}
