import type { Locale } from '@fitadapt/i18n';
import type { IsoDate } from '@fitadapt/shared';

/** A calendar date for display in the user's language (month names from the platform's Intl data, not the app's copy). */
export function formatIsoDate(date: IsoDate, locale: Locale): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
