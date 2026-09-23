import {
  MAX_MUTATIONS_PER_PUSH,
  type Change,
  type OutboxItem,
  type PushResult,
  type RecordData,
  type SyncMutation,
} from '@fitadapt/shared';
import { policyFor, SYNC_COLLECTIONS, type CollectionRegistry } from '../collections.js';
import { OfflineError, SyncPolicyError } from '../errors.js';
import type { LocalRecord, LocalStore, LocalTx } from '../local/types.js';
import type { SyncTransport } from '../transport/types.js';

export interface SyncClientOptions {
  deviceId: string;
  store: LocalStore;
  transport: SyncTransport;
  collections?: CollectionRegistry;
  /** Injected clock (ISO strings); defaults to the system clock. */
  now?: () => Date;
  /** Injected id generator; on React Native pass expo-crypto's randomUUID. */
  newId?: () => string;
}

export interface PushOutcome {
  offline: boolean;
  sent: number;
  acked: number;
  conflicts: number;
  rejected: number;
}

export interface PullOutcome {
  offline: boolean;
  applied: number;
  cursor: number;
}

/**
 * At most one mutation per record per round, in outbox order, so a later edit is
 * never sent before the earlier one is acknowledged and it can be rebased.
 */
function nextBatch(pending: OutboxItem[]): OutboxItem[] {
  const seen = new Set<string>();
  const batch: OutboxItem[] = [];
  for (const item of pending) {
    const key = `${item.mutation.collection}/${item.mutation.recordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.push(item);
    if (batch.length === MAX_MUTATIONS_PER_PUSH) break;
  }
  return batch;
}

function defaultNewId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error('No UUID generator available; pass newId to SyncClient');
  }
  return cryptoApi.randomUUID();
}

/**
 * Local-first client (ADR-002). Every write goes to the local store and the
 * outbox in one transaction, so it works offline; push/pull move changes when
 * the network is back.
 */
export class SyncClient {
  readonly deviceId: string;
  private readonly store: LocalStore;
  private readonly transport: SyncTransport;
  private readonly collections: CollectionRegistry;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private running: Promise<unknown> | null = null;

  constructor(options: SyncClientOptions) {
    this.deviceId = options.deviceId;
    this.store = options.store;
    this.transport = options.transport;
    this.collections = options.collections ?? SYNC_COLLECTIONS;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? defaultNewId;
  }

  /** Creates a record. For append-only collections this is the only allowed operation. */
  insert(collection: string, data: RecordData, recordId: string = this.newId()): string {
    this.write(collection, recordId, 'insert', data);
    return recordId;
  }

  update(collection: string, recordId: string, data: RecordData): void {
    this.write(collection, recordId, 'upsert', data);
  }

  remove(collection: string, recordId: string): void {
    this.write(collection, recordId, 'delete', null);
  }

  get(collection: string, recordId: string): LocalRecord | undefined {
    const record = this.store.transaction((tx) => tx.getRecord(collection, recordId));
    return record && !record.deleted ? record : undefined;
  }

  list(collection: string): LocalRecord[] {
    return this.store
      .transaction((tx) => tx.listRecords(collection))
      .filter((r) => !r.deleted)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt.localeCompare(b.updatedAt)));
  }

  outbox(status?: OutboxItem['status']): OutboxItem[] {
    return this.store.transaction((tx) => tx.listOutbox(status));
  }

  pendingCount(): number {
    return this.outbox('pending').length;
  }

  cursor(): number {
    return this.store.transaction((tx) => tx.getCursor());
  }

  /** Push then pull. Safe to call repeatedly; concurrent calls share one run. */
  sync(): Promise<{ push: PushOutcome; pull: PullOutcome }> {
    if (!this.running) {
      this.running = (async () => {
        try {
          const push = await this.push();
          const pull = await this.pull();
          return { push, pull };
        } finally {
          this.running = null;
        }
      })();
    }
    return this.running as Promise<{ push: PushOutcome; pull: PullOutcome }>;
  }

  /** Call from the connectivity listener (e.g. NetInfo). Syncs when the device comes back online. */
  async handleConnectivityChange(isOnline: boolean): Promise<void> {
    if (isOnline) {
      await this.sync();
    }
  }

  async push(): Promise<PushOutcome> {
    const outcome: PushOutcome = { offline: false, sent: 0, acked: 0, conflicts: 0, rejected: 0 };
    for (;;) {
      const batch = this.store.transaction((tx) => nextBatch(tx.listOutbox('pending')));
      if (batch.length === 0) return outcome;
      let results: PushResult[];
      try {
        ({ results } = await this.transport.push({ deviceId: this.deviceId, mutations: batch.map((i) => i.mutation) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'push failed';
        this.store.transaction((tx) => {
          for (const item of batch) tx.updateOutbox(item.id, { attempts: item.attempts + 1, lastError: message });
        });
        if (error instanceof OfflineError) return { ...outcome, offline: true };
        throw error;
      }
      outcome.sent += batch.length;
      const settled = this.store.transaction((tx) => {
        let count = 0;
        for (const result of results) {
          const item = batch.find((i) => i.id === result.mutationId);
          if (!item) continue;
          this.applyPushResult(tx, item, result, outcome);
          count += 1;
        }
        return count;
      });
      // A server that answers without settling anything would otherwise loop forever.
      if (settled === 0) return outcome;
    }
  }

  async pull(): Promise<PullOutcome> {
    let applied = 0;
    for (;;) {
      const since = this.cursor();
      let response;
      try {
        response = await this.transport.pull({ deviceId: this.deviceId, since });
      } catch (error) {
        if (error instanceof OfflineError) return { offline: true, applied, cursor: since };
        throw error;
      }
      this.store.transaction((tx) => {
        for (const change of response.changes) {
          if (this.applyRemoteChange(tx, change)) applied += 1;
        }
        tx.setCursor(response.cursor);
      });
      if (!response.hasMore || response.changes.length === 0) {
        return { offline: false, applied, cursor: response.cursor };
      }
    }
  }

  private write(collection: string, recordId: string, op: SyncMutation['op'], data: RecordData | null): void {
    const policy = policyFor(this.collections, collection);
    if (!policy) throw new SyncPolicyError('unknown_collection', collection);
    if (policy.appendOnly && op !== 'insert') throw new SyncPolicyError('append_only', collection);
    const timestamp = this.now().toISOString();
    const mutationId = this.newId();

    this.store.transaction((tx) => {
      const existing = tx.getRecord(collection, recordId);
      const live = existing && !existing.deleted;
      if (op === 'insert' && (policy.appendOnly ? existing : live)) {
        throw new SyncPolicyError('record_exists', recordId);
      }
      if (op !== 'insert' && !live) throw new SyncPolicyError('record_missing', recordId);

      tx.putRecord({
        collection,
        id: recordId,
        data,
        deleted: op === 'delete',
        revision: existing?.revision ?? null,
        pendingMutationId: mutationId,
        updatedAt: timestamp,
      });
      tx.addOutbox({
        id: mutationId,
        status: 'pending',
        attempts: 0,
        createdAt: timestamp,
        lastError: null,
        mutation: {
          mutationId,
          collection,
          recordId,
          op,
          baseRevision: op === 'insert' ? null : (existing?.revision ?? null),
          data,
          clientCreatedAt: timestamp,
        },
      });
    });
  }

  private applyPushResult(tx: LocalTx, item: OutboxItem, result: PushResult, outcome: PushOutcome): void {
    const { collection, recordId } = item.mutation;
    const record = tx.getRecord(collection, recordId);
    switch (result.status) {
      case 'applied':
      case 'duplicate': {
        tx.updateOutbox(item.id, { status: 'acked', lastError: null });
        outcome.acked += 1;
        if (record && result.revision !== undefined) {
          const settled = record.pendingMutationId === item.id;
          tx.putRecord({
            ...record,
            revision: result.revision,
            pendingMutationId: settled ? null : record.pendingMutationId,
          });
          if (!settled) this.rebasePending(tx, collection, recordId, result.revision);
        }
        return;
      }
      case 'conflict': {
        // Server wins for mutable records (ADR-002); the local edit is dropped and recorded.
        tx.updateOutbox(item.id, { status: 'rejected', lastError: 'conflict' });
        outcome.conflicts += 1;
        this.dropPending(tx, collection, recordId);
        if (result.current) {
          this.overwriteWithServer(tx, result.current);
        } else if (record) {
          tx.putRecord({ ...record, deleted: true, data: null, pendingMutationId: null });
        }
        return;
      }
      case 'rejected': {
        tx.updateOutbox(item.id, { status: 'rejected', lastError: result.reason ?? 'rejected' });
        outcome.rejected += 1;
        if (record && record.pendingMutationId === item.id) {
          tx.putRecord({ ...record, pendingMutationId: null });
        }
        return;
      }
    }
  }

  /**
   * Follow-up edits of the same record were queued against a stale revision.
   * They have never been sent (see nextBatch), so rebasing them in place is safe.
   */
  private rebasePending(tx: LocalTx, collection: string, recordId: string, revision: number): void {
    for (const pending of tx.listOutbox('pending')) {
      const m = pending.mutation;
      if (m.collection === collection && m.recordId === recordId && m.op !== 'insert') {
        tx.updateOutbox(pending.id, { mutation: { ...m, baseRevision: revision } });
      }
    }
  }

  private dropPending(tx: LocalTx, collection: string, recordId: string): void {
    for (const pending of tx.listOutbox('pending')) {
      if (pending.mutation.collection === collection && pending.mutation.recordId === recordId) {
        tx.updateOutbox(pending.id, { status: 'rejected', lastError: 'conflict' });
      }
    }
  }

  private overwriteWithServer(tx: LocalTx, change: Change): void {
    tx.putRecord({
      collection: change.collection,
      id: change.recordId,
      data: change.data,
      deleted: change.op === 'delete',
      revision: change.revision,
      pendingMutationId: null,
      updatedAt: this.now().toISOString(),
    });
  }

  /** Returns true if the change was applied to the local store. */
  private applyRemoteChange(tx: LocalTx, change: Change): boolean {
    const local = tx.getRecord(change.collection, change.recordId);
    if (local?.pendingMutationId) {
      // Unsynced local edit wins locally until its push resolves (applied or conflict).
      return false;
    }
    if (local && local.revision !== null && local.revision >= change.revision) {
      return false;
    }
    this.overwriteWithServer(tx, change);
    return true;
  }
}
