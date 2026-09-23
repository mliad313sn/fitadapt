import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from './locale.js';
import { createTranslator, type Translator } from './translator.js';
import type { UnitSystem } from './units.js';

export interface I18nContextValue extends Translator {
  unitSystem: UnitSystem;
  setLocale(locale: Locale): void;
  setUnitSystem(system: UnitSystem): void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale: Locale;
  initialUnitSystem?: UnitSystem;
  children?: ReactNode;
}

export function I18nProvider({ initialLocale, initialUnitSystem = 'metric', children }: I18nProviderProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initialUnitSystem);
  const value = useMemo<I18nContextValue>(() => {
    const translator = createTranslator(locale);
    return { ...translator, unitSystem, setLocale, setUnitSystem };
  }, [locale, unitSystem]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return ctx;
}
