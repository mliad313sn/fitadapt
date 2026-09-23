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

export interface SyncServerOptions {
  store: ServerStore;
  collections?: CollectionRegistry;
}

/**
 * Revision-based sync (ADR-002). Push applies client mutations in order, each
 * exactly once (keyed by mutationId). Pull returns every change after a cursor.
 */
export class SyncServer {
  private readonly store: ServerStore;
  private readonly collections: CollectionRegistry;

  constructor({ store, collections = SYNC_COLLECTIONS }: SyncServerOptions) {
    this.store = store;
    this.collections = collections;
  }

  async push(userId: string, input: unknown): Promise<PushResponse> {
    const request = PushRequestSchema.parse(input);
    const results: PushResult[] = [];
    for (const mutation of request.mutations) {
      results.push(await this.store.transaction(userId, (tx) => this.applyOne(tx, userId, request.deviceId, mutation)));
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

  private async applyOne(tx: ServerTx, userId: string, deviceId: string, m: SyncMutation): Promise<PushResult> {
    const previous = await tx.findMutationResult(userId, m.mutationId);
    if (previous) {
      // Idempotent: replaying a mutation returns the original outcome and changes nothing.
      return { ...previous, status: previous.status === 'applied' ? 'duplicate' : previous.status };
    }
    const result = await this.decide(tx, userId, deviceId, m);
    await tx.saveMutationResult(userId, result);
    return result;
  }

  private async decide(tx: ServerTx, userId: string, deviceId: string, m: SyncMutation): Promise<PushResult> {
    const policy = policyFor(this.collections, m.collection);
    if (!policy) {
      return { mutationId: m.mutationId, status: 'rejected', reason: 'unknown_collection' };
    }
    if (m.op !== 'delete' && m.data === null) {
      return { mutationId: m.mutationId, status: 'rejected', reason: 'missing_data' };
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
