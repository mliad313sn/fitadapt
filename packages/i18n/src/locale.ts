export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Primary launch markets are French-speaking, so French is the fallback. */
export const DEFAULT_LOCALE: Locale = 'fr';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Picks the first supported language from BCP-47 tags such as "fr-SN" or "en-GB". */
export function resolveLocale(preferred: readonly string[] | string | undefined | null): Locale {
  const tags = preferred == null ? [] : typeof preferred === 'string' ? [preferred] : preferred;
  for (const tag of tags) {
    const language = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}
