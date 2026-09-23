import type { Translator } from './translator.js';

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/*
 * Exact definitional constants (international yard and pound agreement, 1959).
 * They are unit definitions, not coefficients, so they need no expert validation.
 */
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const KM_PER_MI = 1.609344;

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inches: number): number => inches * CM_PER_IN;
export const kmToMi = (km: number): number => km / KM_PER_MI;
export const miToKm = (mi: number): number => mi * KM_PER_MI;

export interface FormatOptions {
  maximumFractionDigits?: number;
}

function formatWith(
  translator: Translator,
  key: 'units.kg' | 'units.lb' | 'units.cm' | 'units.in' | 'units.km' | 'units.mi',
  value: number,
  options: FormatOptions,
): string {
  const formatted = translator.formatNumber(value, {
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
  });
  return translator.t(key, { value: formatted });
}

/** Values are stored metric internally and converted only for display. */
export function formatMass(kg: number, system: UnitSystem, translator: Translator, options: FormatOptions = {}): string {
  return system === 'metric'
    ? formatWith(translator, 'units.kg', kg, options)
    : formatWith(translator, 'units.lb', kgToLb(kg), options);
}

export function formatLength(cm: number, system: UnitSystem, translator: Translator, options: FormatOptions = {}): string {
  return system === 'metric'
    ? formatWith(translator, 'units.cm', cm, options)
    : formatWith(translator, 'units.in', cmToIn(cm), options);
}

export function formatDistance(km: number, system: UnitSystem, translator: Translator, options: FormatOptions = {}): string {
  return system === 'metric'
    ? formatWith(translator, 'units.km', km, options)
    : formatWith(translator, 'units.mi', kmToMi(km), options);
}
