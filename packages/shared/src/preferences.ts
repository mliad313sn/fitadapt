import { z } from 'zod';
import { LocaleSchema, UnitSystemSchema } from './common.js';
import { DisplayNameSchema } from './pair.js';

/**
 * A record of the `preferences` sync collection (per-user settings, mutable,
 * revision-checked). Strict: an unknown field is refused on the server
 * (API-12, PKG-06: sync validation fails closed), so no free text or health
 * value can enter the store and the other devices through it.
 */
export const PreferencesRecordSchema = z.strictObject({
  locale: LocaleSchema.optional(),
  units: UnitSystemSchema.optional(),
  /** Gym mode: larger touch targets. */
  gym: z.boolean().optional(),
  /** The name shown to a Fair Pair partner (never an account name; never logged). */
  displayName: DisplayNameSchema.optional(),
});
export type PreferencesRecord = z.infer<typeof PreferencesRecordSchema>;
