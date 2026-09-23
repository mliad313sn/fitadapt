import { UNKNOWN_JURISDICTION, type Jurisdiction } from '@fitadapt/shared';

/**
 * Maps a device region (e.g. expo-localization `regionCode`) to the
 * jurisdiction recorded with a consent. Unknown or malformed → "ZZ", which
 * receives the default (strictest) consent texts.
 */
export function resolveJurisdiction(regionCode: string | null | undefined): Jurisdiction {
  const code = (regionCode ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : UNKNOWN_JURISDICTION;
}
