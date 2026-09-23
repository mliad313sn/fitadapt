import type { Change, PushResult } from '@fitadapt/shared';

export type NewChange = Omit<Change, 'revision'>;

/** Server-side storage for one user's sync log. Implemented in memory (tests) and PostgreSQL (apps/api). */
export interface ServerTx {
  /** Stored result of a mutation already processed for this user, if any. */
  findMutationResult(userId: string, mutationId: string): Promise<PushResult | undefined>;
  saveMutationResult(userId: string, result: PushResult): Promise<void>;
  /** Latest change for a record (the record's current state), if any. */
  latestChange(userId: string, collection: string, recordId: string): Promise<Change | undefined>;
  /** Appends a change and assigns the next per-user revision (strictly increasing, gap-free). */
  appendChange(userId: string, change: NewChange): Promise<Change>;
}

/**
 * `TTx` lets a store hand its own transaction handle (e.g. the PostgreSQL
 * transaction in apps/api) to `onApplied`, so records that describe a change
 * (defensibility events, L11) commit or roll back with it.
 */
export interface ServerStore<TTx extends ServerTx = ServerTx> {
  /** Runs `fn` atomically and serialised per user, so revisions are assigned in commit order. */
  transaction<T>(userId: string, fn: (tx: TTx) => Promise<T>): Promise<T>;
  listChanges(userId: string, since: number, limit: number): Promise<Change[]>;
}
