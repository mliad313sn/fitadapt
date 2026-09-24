/** Thrown by transports when the network is unavailable; the outbox keeps the change. */
export class OfflineError extends Error {
  constructor(message = 'offline') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** Thrown locally when a mutation violates a collection policy (e.g. editing an append-only log). */
export class SyncPolicyError extends Error {
  constructor(
    /** invalid_mutation (PKG-02): the mutation does not match the wire schema (e.g. a record id that is not a UUID). */
    readonly code: 'unknown_collection' | 'append_only' | 'record_exists' | 'record_missing' | 'invalid_mutation',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SyncPolicyError';
  }
}
