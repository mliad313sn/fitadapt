import {
  MAX_MUTATIONS_PER_PUSH,
  SyncMutationSchema,
  type Change,
  type OutboxItem,
  type PushResult,
  type RecordData,
  type SyncMutation,
} from '@fitadapt/shared';
import { policyFor, SYNC_COLLECTIONS, type CollectionRegistry } from '../collections.js';
import { syncValue } from '../config.js';
import { OfflineError, SyncPolicyError } from '../errors.js';
import type { LocalRecord, LocalStore, LocalTx } from '../local/types.js';
import { HttpError } from '../transport/http.js';
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
  /** Byte budget of one push request (PKG-02); defaults to syncConfig.pushBatchMaxBytes. */
  pushBatchMaxBytes?: number;
}

/**
 * A mutation the server refused for good (validation, safety re-check,
 * consent, size), with the data the device had written. Its record was
 * taken out of `get`/`list` (PKG-03); the UI tells the user.
 */
export interface RejectedMutation {
  readonly mutationId: string;
  readonly collection: string;
  readonly recordId: string;
  readonly op: SyncMutation['op'];
  readonly data: RecordData | null;
  /** The server's reason code (e.g. screening.profile_mismatch, privacy.consent_required, http_413). */
  readonly reason: string;
  readonly createdAt: string;
}

/** Outbox `lastError` values that are not a server rejection of the mutation itself. */
const NOT_A_REJECTION = new Set(['conflict']);

/**
 * HTTP statuses that refuse the request itself (bad schema, too large):
 * retrying the same batch can never succeed, so the batch is split until
 * the offending mutation is alone, then that one is quarantined (PKG-02).
 * 401 (sign-in), 403 (account state), 408 and 429 (transient) and 5xx are
 * retried as before.
 */
const REQUEST_REJECTIONS = new Set([400, 404, 409, 413, 414, 415, 422]);
const isRequestRejection = (error: unknown): error is HttpError => error instanceof HttpError && REQUEST_REJECTIONS.has(error.status);

/** UTF-8 size of the JSON of a value (no TextEncoder on older Hermes). */
function byteLength(value: unknown): number {
  const json = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00) bytes += 4; // high surrogate: the pair is 4 bytes
    else if (c < 0xdc00 || c >= 0xe000) bytes += 3; // low surrogates were counted with their pair
  }
  return bytes;
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
function nextBatch(pending: OutboxItem[], maxBytes: number): OutboxItem[] {
  const seen = new Set<string>();
  const batch: OutboxItem[] = [];
  let bytes = 0;
  for (const item of pending) {
    const key = `${item.mutation.collection}/${item.mutation.recordId}`;
    if (seen.has(key)) continue;
    // PKG-02: a byte budget as well as a count; a single larger mutation still goes alone.
    const size = byteLength(item.mutation) + 1;
    if (batch.length > 0 && bytes + size > maxBytes) break;
    seen.add(key);
    batch.push(item);
    bytes += size;
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
  private readonly pushBatchMaxBytes: number;
  private running: Promise<unknown> | null = null;

  constructor(options: SyncClientOptions) {
    this.deviceId = options.deviceId;
    this.store = options.store;
    this.transport = options.transport;
    this.collections = options.collections ?? SYNC_COLLECTIONS;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? defaultNewId;
    this.pushBatchMaxBytes = options.pushBatchMaxBytes ?? syncValue('pushBatchMaxBytes');
  }

  /** A fresh record id from the injected generator (a record that must name itself, ADR-023, uses it for both). */
  newRecordId(): string {
    return this.newId();
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

  /**
   * Mutations the server rejected (not conflicts), oldest first (PKG-03). Their
   * records no longer appear in `get`/`list`; the UI should say so.
   */
  rejectedMutations(): RejectedMutation[] {
    return this.outbox('rejected')
      .filter((item) => !NOT_A_REJECTION.has(item.lastError ?? ''))
      .map((item) => ({
        mutationId: item.id,
        collection: item.mutation.collection,
        recordId: item.mutation.recordId,
        op: item.mutation.op,
        data: item.mutation.data,
        reason: item.lastError ?? 'rejected',
        createdAt: item.createdAt,
      }));
  }

  rejectedCount(): number {
    return this.rejectedMutations().length;
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
      const batch = this.store.transaction((tx) => nextBatch(tx.listOutbox('pending'), this.pushBatchMaxBytes));
      if (batch.length === 0) return outcome;
      const settled = await this.pushItems(batch, outcome);
      if (settled === 'offline') return { ...outcome, offline: true };
      // A server that answers without settling anything would otherwise loop forever.
      if (settled === 0) return outcome;
    }
  }

  /**
   * Sends `items` and settles the results. A request-level refusal (PKG-02)
   * splits the items in halves, in order, until the offending mutation is
   * alone; that one is settled as rejected (`http_<status>`) and the others
   * go through, so one bad mutation never blocks the outbox.
   */
  private async pushItems(items: OutboxItem[], outcome: PushOutcome): Promise<number | 'offline'> {
    let results: PushResult[];
    try {
      ({ results } = await this.transport.push({ deviceId: this.deviceId, mutations: items.map((i) => i.mutation) }));
    } catch (error) {
      if (isRequestRejection(error)) {
        if (items.length === 1) {
          outcome.sent += 1;
          return this.settle(items, [{ mutationId: items[0]!.id, status: 'rejected', reason: `http_${error.status}` }], outcome);
        }
        const middle = Math.ceil(items.length / 2);
        const first = await this.pushItems(items.slice(0, middle), outcome);
        if (first === 'offline') return first;
        const second = await this.pushItems(items.slice(middle), outcome);
        // What the first half settled is already stored; the outcome keeps its counts.
        if (second === 'offline') return second;
        return first + second;
      }
      const message = error instanceof Error ? error.message : 'push failed';
      this.store.transaction((tx) => {
        for (const item of items) tx.updateOutbox(item.id, { attempts: item.attempts + 1, lastError: message });
      });
      if (error instanceof OfflineError) return 'offline';
      throw error;
    }
    outcome.sent += items.length;
    return this.settle(items, results, outcome);
  }

  private settle(items: OutboxItem[], results: PushResult[], outcome: PushOutcome): number {
    return this.store.transaction((tx) => {
      let count = 0;
      for (const result of results) {
        const item = items.find((i) => i.id === result.mutationId);
        if (!item) continue;
        this.applyPushResult(tx, item, result, outcome);
        count += 1;
      }
      return count;
    });
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
    const mutation: SyncMutation = { mutationId, collection, recordId, op, baseRevision: null, data, clientCreatedAt: timestamp };
    // PKG-02: validate on write. A mutation the wire schema refuses (a non-UUID id, a non-object payload)
    // would otherwise sit in the outbox, fail every push and, in SQLite, every outbox read.
    const checked = SyncMutationSchema.safeParse(mutation);
    if (!checked.success) {
      throw new SyncPolicyError('invalid_mutation', `${collection}: invalid ${checked.error.issues.map((i) => i.path.join('.') || 'mutation').join(', ')}`);
    }

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
        mutation: { ...mutation, baseRevision: op === 'insert' ? null : (existing?.revision ?? null) },
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
          // PKG-03: the rejection is final, so the local effect is reversed. The record leaves get/list (its data
          // stays in the outbox item, see rejectedMutations()), and pull restores the server's copy if there is
          // one: the revision is cleared and the cursor moves back to just before the revision the device had.
          tx.putRecord({ ...record, data: null, deleted: true, revision: null, pendingMutationId: null, updatedAt: this.now().toISOString() });
          if (record.revision !== null) tx.setCursor(Math.min(tx.getCursor(), record.revision - 1));
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
