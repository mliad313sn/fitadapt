import type { OutboxItem } from '@fitadapt/shared';
import type { LocalRecord, LocalStore, LocalTx } from './types.js';

interface State {
  records: Map<string, LocalRecord>;
  outbox: OutboxItem[];
  cursor: number;
  kv: Record<string, string>;
}

/** JSON clone: records and outbox items are plain JSON data (no structuredClone on older Hermes). */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const recordKey = (collection: string, id: string) => `${collection}/${id}`;

/** In-memory LocalStore for tests and previews. Transactions roll back on throw. */
export class MemoryLocalStore implements LocalStore {
  private state: State = { records: new Map(), outbox: [], cursor: 0, kv: {} };

  transaction<T>(fn: (tx: LocalTx) => T): T {
    const working: State = {
      records: new Map([...this.state.records].map(([k, v]) => [k, clone(v)])),
      outbox: clone(this.state.outbox),
      cursor: this.state.cursor,
      kv: { ...this.state.kv },
    };
    const result = fn(this.txFor(working));
    this.state = working;
    return result;
  }

  private txFor(state: State): LocalTx {
    return {
      getRecord: (collection, id) => {
        const r = state.records.get(recordKey(collection, id));
        return r ? clone(r) : undefined;
      },
      putRecord: (record) => {
        state.records.set(recordKey(record.collection, record.id), clone(record));
      },
      listRecords: (collection) =>
        [...state.records.values()].filter((r) => r.collection === collection).map((r) => clone(r)),
      addOutbox: (item) => {
        if (state.outbox.some((o) => o.id === item.id)) {
          throw new Error(`duplicate outbox id ${item.id}`);
        }
        state.outbox.push(clone(item));
      },
      listOutbox: (status, limit) => {
        const items = state.outbox.filter((o) => status === undefined || o.status === status);
        return clone(limit === undefined ? items : items.slice(0, limit));
      },
      updateOutbox: (id, patch) => {
        const item = state.outbox.find((o) => o.id === id);
        if (!item) throw new Error(`unknown outbox id ${id}`);
        Object.assign(item, patch);
      },
      getCursor: () => state.cursor,
      setCursor: (revision) => {
        state.cursor = revision;
      },
      getState: (key) => state.kv[key],
      setState: (key, value) => {
        state.kv[key] = value;
      },
    };
  }
}
