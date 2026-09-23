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
});

export function policyFor(registry: CollectionRegistry, collection: string): CollectionPolicy | undefined {
  return Object.prototype.hasOwnProperty.call(registry, collection) ? registry[collection] : undefined;
}
