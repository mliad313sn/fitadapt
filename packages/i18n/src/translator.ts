import { IntlMessageFormat } from 'intl-messageformat';
import { en, type MessageKey } from './catalogues/en.js';
import { fr } from './catalogues/fr.js';
import type { Locale } from './locale.js';

export type MessageValues = Record<string, string | number>;

export const catalogues: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, fr };

export interface Translator {
  readonly locale: Locale;
  t(key: MessageKey, values?: MessageValues): string;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
}

const formatCache = new Map<string, IntlMessageFormat>();

function getFormat(locale: Locale, key: MessageKey): IntlMessageFormat {
  const cacheKey = `${locale}\u0000${key}`;
  let format = formatCache.get(cacheKey);
  if (!format) {
    format = new IntlMessageFormat(catalogues[locale][key], locale);
    formatCache.set(cacheKey, format);
  }
  return format;
}

export function createTranslator(locale: Locale): Translator {
  return {
    locale,
    t(key, values) {
      const result = getFormat(locale, key).format(values);
      return typeof result === 'string' ? result : String(result);
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
  };
}

/** True if a string looks like an i18n key (for runtime guards on dynamic keys, e.g. API error codes). */
export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}
