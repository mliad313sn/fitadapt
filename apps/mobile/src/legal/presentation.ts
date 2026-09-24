import type { Jurisdiction } from '@fitadapt/shared';
import { z } from 'zod';
import type { KeyValueStore } from '../storage/app-state';

/**
 * FIX-B (B pre-review §1.5 items 1-3): the version of the legal screens a user
 * saw, recorded with every acceptance ("<screen>@<flow version>"). Raise it
 * whenever a legal screen's layout or wording around the texts changes, and
 * archive a template of each screen per release (docs/legal/defensibility-file.md).
 * 2: country of residence asked on the health-consent screen; Privacy Policy
 * "read", not "accepted"; exercise-risk statements ticked one by one.
 */
export const LEGAL_FLOW_VERSION = 2;
export type LegalScreen = 'onboarding.terms' | 'onboarding.exercise_risk' | 'pair.guest_legal';
export const presentationOf = (screen: LegalScreen) => `${screen}@${LEGAL_FLOW_VERSION}`;

/** The countries offered for "Where do you live?" (the jurisdiction matrix); anything else is "another country" (ZZ, strictest defaults). */
export const RESIDENCE_CHOICES = ['FR', 'GB', 'US', 'SN', 'CI', 'ZZ'] as const;
export type ResidenceChoice = (typeof RESIDENCE_CHOICES)[number];

const RESIDENCE_KEY = 'legal_residence';
const ResidenceSchema = z.strictObject({ jurisdiction: z.enum(RESIDENCE_CHOICES), source: z.literal('user_confirmed'), confirmedAt: z.iso.datetime({ offset: true }) });

/** The country of residence the user confirmed on this device, or null (then only the device locale is known). */
export function readResidence(kv: KeyValueStore): { jurisdiction: Jurisdiction; confirmedAt: string } | null {
  const raw = kv.get(RESIDENCE_KEY);
  if (!raw) return null;
  try {
    const parsed = ResidenceSchema.parse(JSON.parse(raw));
    return { jurisdiction: parsed.jurisdiction, confirmedAt: parsed.confirmedAt };
  } catch {
    // Unreadable: the user is asked again (fail closed to "not confirmed").
    return null;
  }
}

export function writeResidence(kv: KeyValueStore, jurisdiction: ResidenceChoice, at: Date): void {
  kv.set(RESIDENCE_KEY, JSON.stringify({ jurisdiction, source: 'user_confirmed', confirmedAt: at.toISOString() }));
}

export function forgetResidence(kv: KeyValueStore): void {
  kv.remove(RESIDENCE_KEY);
}
