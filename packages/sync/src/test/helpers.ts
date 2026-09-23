import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import {
  DrizzleLocalStore,
  InMemoryTransport,
  MemoryLocalStore,
  MemoryServerStore,
  SyncClient,
  SyncServer,
  type LocalStore,
} from '../index.js';

export const USER = '7d1f3c62-0000-4000-8000-000000000001';

/** Deterministic, strictly increasing clock for tests. */
export function testClock(start = Date.UTC(2026, 8, 23, 8, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000));
}

export async function sqliteStore(): Promise<DrizzleLocalStore> {
  const SQL = await initSqlJs();
  const store = new DrizzleLocalStore(drizzle(new SQL.Database()));
  store.migrate();
  return store;
}

export type StoreKind = 'memory' | 'sqlite';

export async function makeStore(kind: StoreKind): Promise<LocalStore> {
  return kind === 'memory' ? new MemoryLocalStore() : sqliteStore();
}

export function makeServer() {
  const store = new MemoryServerStore();
  return { store, server: new SyncServer({ store }) };
}

export async function makeDevice(server: SyncServer, kind: StoreKind = 'memory', userId = USER) {
  const transport = new InMemoryTransport(server, userId);
  const client = new SyncClient({
    deviceId: randomUUID(),
    store: await makeStore(kind),
    transport,
    now: testClock(),
    newId: randomUUID,
  });
  return { client, transport };
}
