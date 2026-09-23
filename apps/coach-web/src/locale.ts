import { resolveLocale, type Locale } from '@fitadapt/i18n';

/** Picks FR or EN from an Accept-Language header (quality values ignored beyond order). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  const tags = (header ?? '')
    .split(',')
    .map((part) => part.replace(/;.*$/, '').trim())
    .filter(Boolean);
  return resolveLocale(tags);
}
