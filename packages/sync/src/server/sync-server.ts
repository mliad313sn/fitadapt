import {
  PullRequestSchema,
  PushRequestSchema,
  type PullResponse,
  type PushResponse,
  type PushResult,
  type SyncMutation,
} from '@fitadapt/shared';
import { policyFor, SYNC_COLLECTIONS, type CollectionRegistry } from '../collections.js';
import type { ServerStore, ServerTx } from './types.js';

/**
 * Server-side check of a mutation before it is applied (schema, consent,
 * safety re-checks). Returns a stable reason code to reject it, or null.
 * A rejection is final for that mutation id (idempotency ledger).
 *
 * It runs INSIDE the sync transaction and receives its handle: every read it
 * makes must go through `tx` (same connection, under the per-user lock), never
 * through a second pooled connection — holding one connection while waiting
 * for another deadlocks the pool under concurrent pushes (API-1), and a read
 * outside the transaction can see a consent that is withdrawn before the
 * change commits (API-2).
 */
export type MutationValidator<TTx extends ServerTx = ServerTx> = (userId: string, mutation: SyncMutation, tx: TTx) => Promise<string | null> | string | null;

/**
 * Called once a mutation is applied, INSIDE the sync transaction, with the
 * store's transaction handle (e.g. to write defensibility events, L11). If it
 * throws, the whole transaction rolls back: the change, its idempotency
 * record and whatever the listener wrote are all discarded, and the push
 * fails so the client keeps the mutation in its outbox and retries. A change
 * can therefore never be stored without the records that describe it.
 */
export type MutationListener<TTx extends ServerTx = ServerTx> = (userId: string, mutation: SyncMutation, tx: TTx) => Promise<void> | void;

export interface SyncServerOptions<TTx extends ServerTx = ServerTx> {
  store: ServerStore<TTx>;
  collections?: CollectionRegistry;
  validate?: MutationValidator<TTx>;
  onApplied?: MutationListener<TTx>;
}

/**
 * Revision-based sync (ADR-002). Push applies client mutations in order, each
 * exactly once (keyed by mutationId). Pull returns every change after a cursor.
 */
export class SyncServer<TTx extends ServerTx = ServerTx> {
  private readonly store: ServerStore<TTx>;
  private readonly collections: CollectionRegistry;
  private readonly validate?: MutationValidator<TTx>;
  private readonly onApplied?: MutationListener<TTx>;

  constructor({ store, collections = SYNC_COLLECTIONS, validate, onApplied }: SyncServerOptions<TTx>) {
    this.store = store;
    this.collections = collections;
    this.validate = validate;
    this.onApplied = onApplied;
  }

  async push(userId: string, input: unknown): Promise<PushResponse> {
    const request = PushRequestSchema.parse(input);
    const results: PushResult[] = [];
    for (const mutation of request.mutations) {
      const result = await this.store.transaction(userId, async (tx) => {
        const outcome = await this.applyOne(tx, userId, request.deviceId, mutation);
        // Same transaction as the change (L11): both commit, or neither does.
        if (outcome.status === 'applied') await this.onApplied?.(userId, mutation, tx);
        return outcome;
      });
      results.push(result);
    }
    return { results };
  }

  async pull(userId: string, input: unknown): Promise<PullResponse> {
    const request = PullRequestSchema.parse(input);
    // Fetch one extra row to learn whether more remain.
    const rows = await this.store.listChanges(userId, request.since, request.limit + 1);
    const hasMore = rows.length > request.limit;
    const changes = hasMore ? rows.slice(0, request.limit) : rows;
    const last = changes[changes.length - 1];
    return { changes, cursor: last ? last.revision : request.since, hasMore };
  }

  private async applyOne(tx: TTx, userId: string, deviceId: string, m: SyncMutation): Promise<PushResult> {
    const previous = await tx.findMutationResult(userId, m.mutationId);
    if (previous) {
      // Idempotent: replaying a mutation returns the original outcome and changes nothing.
      return { ...previous, status: previous.status === 'applied' ? 'duplicate' : previous.status };
    }
    const result = await this.decide(tx, userId, deviceId, m);
    await tx.saveMutationResult(userId, result);
    return result;
  }

  private async decide(tx: TTx, userId: string, deviceId: string, m: SyncMutation): Promise<PushResult> {
    const policy = policyFor(this.collections, m.collection);
    if (!policy) {
      return { mutationId: m.mutationId, status: 'rejected', reason: 'unknown_collection' };
    }
    if (m.op !== 'delete' && m.data === null) {
      return { mutationId: m.mutationId, status: 'rejected', reason: 'missing_data' };
    }
    const invalid = this.validate ? await this.validate(userId, m, tx) : null;
    if (invalid !== null) {
      return { mutationId: m.mutationId, status: 'rejected', reason: invalid };
    }
    const current = await tx.latestChange(userId, m.collection, m.recordId);

    if (policy.appendOnly) {
      if (m.op !== 'insert') {
        return { mutationId: m.mutationId, status: 'rejected', reason: 'append_only' };
      }
      if (current) {
        // A different mutation already created this id: ids are client UUIDs, so this is a client bug.
        return { mutationId: m.mutationId, status: 'rejected', reason: 'record_exists' };
      }
    } else {
      const currentRevision = current && current.op !== 'delete' ? current.revision : null;
      const expected = m.op === 'insert' ? null : m.baseRevision;
      if (m.op === 'insert' ? currentRevision !== null : currentRevision !== expected) {
        return current
          ? { mutationId: m.mutationId, status: 'conflict', current }
          : { mutationId: m.mutationId, status: 'conflict' };
      }
    }

    const change = await tx.appendChange(userId, {
      collection: m.collection,
      recordId: m.recordId,
      op: m.op === 'delete' ? 'delete' : 'upsert',
      data: m.op === 'delete' ? null : m.data,
      originDeviceId: deviceId,
    });
    return { mutationId: m.mutationId, status: 'applied', revision: change.revision };
  }
}
