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
  /** M08 programs (inputs + generated program): append-only; a new program is a new record and the latest counts. */
  programs: Object.freeze({ appendOnly: true }),
  /** M08 reflows (a session the user could not do and what the engine decided): append-only, replayed in order. */
  program_reflows: Object.freeze({ appendOnly: true }),
  /** M02 started sessions (the executed prescription with its inputs): append-only. */
  workout_sessions: Object.freeze({ appendOnly: true }),
  /** M02 execution events (swaps, skips, pain flags, stops, S3 red flags and attestations): append-only. */
  execution_logs: Object.freeze({ appendOnly: true }),
  /** M05 readiness checks (sleep, soreness, stress, energy, optional wearable readings): append-only; the latest of a day counts. */
  readiness_checks: Object.freeze({ appendOnly: true }),
  /** M04 body weight and body-fat entries: append-only; a correction is a new entry naming the one it corrects. */
  body_metrics: Object.freeze({ appendOnly: true }),
  /** M04 circumferences: append-only, corrections as for body metrics. Progress photos are never synced (ADR-020). */
  measurements: Object.freeze({ appendOnly: true }),
});

export function policyFor(registry: CollectionRegistry, collection: string): CollectionPolicy | undefined {
  return Object.prototype.hasOwnProperty.call(registry, collection) ? registry[collection] : undefined;
}
