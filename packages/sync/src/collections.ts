/**
 * Sync policy per collection. Append-only collections (workout set logs) only
 * accept inserts of new record ids, so two devices can never conflict on them.
 */
export interface CollectionPolicy {
  readonly appendOnly: boolean;
}

export type CollectionRegistry = Readonly<Record<string, CollectionPolicy>>;

export const SYNC_COLLECTIONS: CollectionRegistry = Object.freeze({
  /** Workout set logs: append-only (CLAUDE.md conventions). Corrections are new entries. */
  set_logs: Object.freeze({ appendOnly: true }),
  /** Per-user settings (locale, units, gym mode): mutable, revision-checked. */
  preferences: Object.freeze({ appendOnly: false }),
  /** M01 profile (one record per user, PROFILE_RECORD_ID): mutable, revision-checked, server wins. */
  profile: Object.freeze({ appendOnly: false }),
  /** M01 equipment profiles (one per location): mutable, revision-checked. */
  equipment_profiles: Object.freeze({ appendOnly: false }),
  /** M01 screenings: append-only history; a re-screen is a new record and the latest counts. */
  screenings: Object.freeze({ appendOnly: true }),
  /** M07 assessments (result + CapacityModel): append-only history; a re-assessment is a new record and the latest counts. */
  assessments: Object.freeze({ appendOnly: true }),
});

export function policyFor(registry: CollectionRegistry, collection: string): CollectionPolicy | undefined {
  return Object.prototype.hasOwnProperty.call(registry, collection) ? registry[collection] : undefined;
}
