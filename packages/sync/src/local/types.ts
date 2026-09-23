import type { OutboxItem, OutboxStatus, RecordData } from '@fitadapt/shared';

/** A record as the device sees it: the last known server state plus any local, unsynced change. */
export interface LocalRecord {
  collection: string;
  id: string;
  data: RecordData | null;
  deleted: boolean;
  /** Last server revision applied to this record, or null if never synced. */
  revision: number | null;
  /** The newest local mutation not yet acknowledged by the server. */
  pendingMutationId: string | null;
  updatedAt: string;
}

export type OutboxPatch = Partial<Pick<OutboxItem, 'status' | 'attempts' | 'lastError' | 'mutation'>>;

/** Operations available inside a local transaction. All synchronous (expo-sqlite sync API). */
export interface LocalTx {
  getRecord(collection: string, id: string): LocalRecord | undefined;
  putRecord(record: LocalRecord): void;
  listRecords(collection: string): LocalRecord[];
  addOutbox(item: OutboxItem): void;
  /** Outbox items in creation order. */
  listOutbox(status?: OutboxStatus, limit?: number): OutboxItem[];
  updateOutbox(id: string, patch: OutboxPatch): void;
  getCursor(): number;
  setCursor(revision: number): void;
  /** Small key/value slots for sync metadata (e.g. the device id). */
  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
}

/** Device-side storage. A transaction either fully applies or leaves nothing behind. */
export interface LocalStore {
  transaction<T>(fn: (tx: LocalTx) => T): T;
}
