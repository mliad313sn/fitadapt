import { randomUUID } from 'node:crypto';
import { PreferencesRecordSchema, SetLogSchema, type PushRequest, type PushResponse } from '@fitadapt/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  HttpError,
  HttpTransport,
  INVALID_LOCAL_MUTATION,
  InMemoryTransport,
  MemoryLocalStore,
  MemoryServerStore,
  OfflineError,
  recordDataIssue,
  SYNC_COLLECTIONS,
  SYNC_UNVALIDATED,
  syncConfig,
  SyncClient,
  SyncPolicyError,
  SyncServer,
  type CollectionPolicy,
  type SyncTransport,
} from '../index.js';
import { makeDevice, makeServer, makeStore, sqliteStore, testClock, USER, type StoreKind } from './helpers.js';

// Regression tests for the packages/tooling review: PKG-02, PKG-03, PKG-06 (package side), PKG-07.

const kinds: StoreKind[] = ['memory', 'sqlite'];

/** A transport over a SyncServer that refuses, at request level, any push containing a marked mutation. */
class RefusingTransport implements SyncTransport {
  readonly requests: PushRequest[] = [];
  constructor(
    private readonly inner: SyncTransport,
    private readonly refuse: (req: PushRequest) => number | null,
  ) {}
  async push(req: PushRequest): Promise<PushResponse> {
    this.requests.push(req);
    const status = this.refuse(req);
    if (status !== null) throw new HttpError(status, status === 413 ? undefined : 'validation.failed');
    return this.inner.push(req);
  }
  pull = (req: Parameters<SyncTransport['pull']>[0]) => this.inner.pull(req);
}

async function clientWith(transport: SyncTransport, kind: StoreKind = 'memory', extra: { pushBatchMaxBytes?: number } = {}) {
  return new SyncClient({ deviceId: randomUUID(), store: await makeStore(kind), transport, now: testClock(), newId: randomUUID, ...extra });
}

describe.each(kinds)('PKG-02: validate on write — %s', (kind) => {
  it('a record id that is not a UUID is refused locally and never reaches the outbox', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server, kind);
    expect(() => a.client.insert('set_logs', {}, 'not-a-uuid')).toThrow(SyncPolicyError);
    try {
      a.client.insert('set_logs', {}, 'not-a-uuid');
    } catch (error) {
      expect((error as SyncPolicyError).code).toBe('invalid_mutation');
    }
    expect(() => a.client.insert('set_logs', ['not', 'an', 'object'] as unknown as Record<string, unknown>)).toThrow(SyncPolicyError);
    expect(a.client.outbox()).toEqual([]);
    expect(a.client.pendingCount()).toBe(0);
    const ok = a.client.insert('set_logs', { reps: 5 });
    expect((await a.client.sync()).push).toMatchObject({ acked: 1 });
    expect(a.client.get('set_logs', ok)?.revision).toBe(1);
  });
});

describe('PKG-02: a request-level refusal quarantines the offending mutation', () => {
  it('a 400 for one mutation: the batch is split, the others are acked, that one is rejected, and the outbox moves on', async () => {
    const { server } = makeServer();
    const inner = new InMemoryTransport(server, USER);
    const refusing = new RefusingTransport(inner, (req) => (req.mutations.some((m) => (m.data as { poison?: boolean } | null)?.poison) ? 400 : null));
    const client = await clientWith(refusing);
    const good = [client.insert('set_logs', { i: 1 }), client.insert('set_logs', { i: 2 })];
    const bad = client.insert('set_logs', { poison: true });
    good.push(client.insert('set_logs', { i: 3 }), client.insert('set_logs', { i: 4 }));
    const first = await client.sync();
    expect(first.push).toMatchObject({ acked: 4, rejected: 1, offline: false });
    expect(client.pendingCount()).toBe(0);
    expect(client.outbox('rejected')).toMatchObject([{ lastError: 'http_400', mutation: { recordId: bad } }]);
    for (const id of good) expect(client.get('set_logs', id)?.revision).not.toBeNull();
    // PKG-03 applies to it too: it left get/list and is reported.
    expect(client.get('set_logs', bad)).toBeUndefined();
    expect(client.rejectedMutations().map((r) => [r.recordId, r.reason])).toEqual([[bad, 'http_400']]);
    // Later writes sync normally.
    const later = client.insert('set_logs', { i: 5 });
    expect((await client.sync()).push).toMatchObject({ acked: 1, rejected: 0 });
    expect(client.get('set_logs', later)?.revision).not.toBeNull();
  });

  it('a 413 for large batches: halves until each request fits, nothing is lost', async () => {
    const { server } = makeServer();
    const refusing = new RefusingTransport(new InMemoryTransport(server, USER), (req) => (req.mutations.length > 2 ? 413 : null));
    const client = await clientWith(refusing);
    for (let i = 0; i < 7; i++) client.insert('set_logs', { i });
    expect((await client.sync()).push).toMatchObject({ acked: 7, rejected: 0 });
    expect(refusing.requests.filter((r) => r.mutations.length <= 2).length).toBeGreaterThanOrEqual(4);
  });

  it('transient errors (401, 429, 5xx) are retried, never quarantined', async () => {
    for (const status of [401, 403, 408, 429, 500, 503]) {
      const { server } = makeServer();
      const refusing = new RefusingTransport(new InMemoryTransport(server, USER), () => status);
      const client = await clientWith(refusing);
      client.insert('set_logs', { i: 1 });
      await expect(client.push()).rejects.toBeInstanceOf(HttpError);
      expect(client.pendingCount()).toBe(1);
      expect(client.outbox('rejected')).toEqual([]);
    }
  });

  it('an offline error while halves are sent keeps what was settled and reports offline', async () => {
    const { server } = makeServer();
    const inner = new InMemoryTransport(server, USER);
    let calls = 0;
    const flaky: SyncTransport = {
      push: async (req) => {
        calls += 1;
        if (calls === 1) throw new HttpError(400, 'validation.failed');
        if (calls === 3) throw new OfflineError();
        return inner.push(req);
      },
      pull: (req) => inner.pull(req),
    };
    const client = await clientWith(flaky);
    for (let i = 0; i < 4; i++) client.insert('set_logs', { i });
    const out = await client.push();
    expect(out).toMatchObject({ offline: true, acked: 2 });
    expect(client.pendingCount()).toBe(2);
    const onlyOffline: SyncTransport = { push: async () => Promise.reject(new HttpError(400, undefined)), pull: (req) => inner.pull(req) };
    let n = 0;
    const firstHalfOffline: SyncTransport = {
      push: async (req) => {
        n += 1;
        if (n === 1) return onlyOffline.push(req);
        throw new OfflineError();
      },
      pull: (req) => inner.pull(req),
    };
    const c2 = await clientWith(firstHalfOffline);
    c2.insert('set_logs', { a: 1 });
    c2.insert('set_logs', { a: 2 });
    expect(await c2.push()).toMatchObject({ offline: true, acked: 0 });
    expect(c2.pendingCount()).toBe(2);
  });

  it('a push request stays within the byte budget (a single larger mutation still goes alone)', async () => {
    const { server } = makeServer();
    const recording = new RefusingTransport(new InMemoryTransport(server, USER), () => null);
    const client = await clientWith(recording, 'memory', { pushBatchMaxBytes: 2_000 });
    for (let i = 0; i < 10; i++) client.insert('set_logs', { i, pad: 'x'.repeat(300) });
    client.insert('set_logs', { big: 'y'.repeat(5_000) });
    client.insert('set_logs', { accent: 'é'.repeat(100), emoji: '💪'.repeat(50) });
    expect((await client.sync()).push).toMatchObject({ acked: 12 });
    for (const req of recording.requests) {
      const bytes = new TextEncoder().encode(JSON.stringify(req.mutations)).length;
      expect(req.mutations.length === 1 || bytes <= 2_000).toBe(true);
    }
    expect(recording.requests.length).toBeGreaterThan(2);
    expect(syncConfig.pushBatchMaxBytes).toMatchObject({ validated: false });
    expect(SYNC_UNVALIDATED).toEqual(['pushBatchMaxBytes', 'requestTimeoutMs']);
  });

  it('the SQLite store quarantines a stored row that no longer parses instead of failing every read', async () => {
    const store = await sqliteStore();
    const { server } = makeServer();
    const client = new SyncClient({ deviceId: randomUUID(), store, transport: new InMemoryTransport(server, USER), now: testClock(), newId: randomUUID });
    const good = client.insert('set_logs', { ok: true });
    // A row written by an older build, before validation on write.
    const db = (store as unknown as { db: { run: (q: unknown) => void } }).db;
    const legacy = JSON.stringify({ mutationId: randomUUID(), collection: 'set_logs', recordId: 'not-a-uuid', op: 'insert', baseRevision: null, data: {}, clientCreatedAt: new Date().toISOString() });
    db.run(sql`INSERT INTO sync_outbox (id, mutation, status, attempts, created_at, last_error) VALUES (${randomUUID()}, ${legacy}, 'pending', 0, ${new Date().toISOString()}, NULL)`);
    expect(client.pendingCount()).toBe(1);
    expect((await client.sync()).push).toMatchObject({ acked: 1 });
    expect(client.get('set_logs', good)?.revision).toBe(1);
    const raw = store.transaction(() => (store as unknown as { db: { all: (q: unknown) => { status: string; last_error: string }[] } }).db.all(sql`SELECT status, last_error FROM sync_outbox WHERE mutation LIKE '%not-a-uuid%'`));
    expect(raw).toEqual([{ status: 'rejected', last_error: INVALID_LOCAL_MUTATION }]);
    // A second read does not rewrite it.
    expect(client.outbox('rejected')).toEqual([]);
  });
});

describe.each(kinds)('PKG-03: a server-rejected record is reversed on the device — %s', (kind) => {
  it('a screening the validator rejects leaves get/list, is reported, and never comes back', async () => {
    const server = new SyncServer({
      store: new MemoryServerStore(),
      validate: (_user, m) => ((m.data as { safetyProfile?: string } | null)?.safetyProfile === 'looser' ? 'screening.profile_mismatch' : null),
    });
    const a = await makeDevice(server, kind);
    const kept = a.client.insert('screenings', { safetyProfile: 'strict' });
    const rejected = a.client.insert('screenings', { safetyProfile: 'looser' });
    expect(a.client.list('screenings')).toHaveLength(2);
    const res = await a.client.sync();
    expect(res.push).toMatchObject({ acked: 1, rejected: 1 });
    expect(a.client.get('screenings', rejected)).toBeUndefined();
    expect(a.client.list('screenings').map((r) => r.id)).toEqual([kept]);
    expect(a.client.rejectedMutations()).toMatchObject([{ recordId: rejected, collection: 'screenings', reason: 'screening.profile_mismatch', op: 'insert', data: { safetyProfile: 'looser' } }]);
    expect(a.client.rejectedCount()).toBe(1);
    await a.client.sync();
    expect(a.client.get('screenings', rejected)).toBeUndefined();
    // Conflicts are not rejections of the data itself.
    expect(a.client.rejectedMutations().every((r) => r.reason !== 'conflict')).toBe(true);
  });

  it('a rejected edit of a synced mutable record: pull restores the server copy', async () => {
    const server = new SyncServer({ store: new MemoryServerStore(), validate: (_user, m) => ((m.data as { units?: string } | null)?.units === 'cubits' ? 'preferences.invalid' : null) });
    const a = await makeDevice(server, kind);
    const id = a.client.insert('preferences', { units: 'metric' });
    for (let i = 0; i < 3; i++) a.client.insert('set_logs', { i });
    await a.client.sync();
    expect(a.client.cursor()).toBe(4);
    a.client.update('preferences', id, { units: 'cubits' });
    expect(a.client.get('preferences', id)?.data).toEqual({ units: 'cubits' });
    const res = await a.client.sync();
    expect(res.push.rejected).toBe(1);
    // The server's copy is back after the same sync's pull (the cursor was moved back before it).
    expect(a.client.get('preferences', id)).toMatchObject({ data: { units: 'metric' }, revision: 1, pendingMutationId: null });
    expect(a.client.cursor()).toBe(4);
  });

  it('a rejected mutation that is no longer the latest local edit leaves the record to that edit', async () => {
    const server = new SyncServer({ store: new MemoryServerStore(), validate: (_user, m) => ((m.data as { v?: number } | null)?.v === 2 ? 'preferences.invalid' : null) });
    const a = await clientWith(new InMemoryTransport(server, USER), kind);
    const id = a.insert('preferences', { v: 1 });
    await a.sync();
    a.update('preferences', id, { v: 2 });
    a.update('preferences', id, { v: 3 });
    const res = await a.sync();
    expect(res.push).toMatchObject({ rejected: 1, acked: 1 });
    expect(a.get('preferences', id)).toMatchObject({ data: { v: 3 }, revision: 2, pendingMutationId: null });
  });
});

describe('PKG-06 (package side): every collection policy carries a schema', () => {
  it('each registered collection has a zod schema; a policy without one does not type-check', () => {
    for (const [name, p] of Object.entries(SYNC_COLLECTIONS)) {
      expect({ name, parse: typeof p.schema.safeParse }).toEqual({ name, parse: 'function' });
    }
    // @ts-expect-error — `schema` is required (PKG-06).
    const missing: CollectionPolicy = { appendOnly: true };
    expect(missing.appendOnly).toBe(true);
    expect(SYNC_COLLECTIONS.set_logs!.schema).toBe(SetLogSchema);
  });

  it('recordDataIssue and the server option reject a set log with a free-text note', async () => {
    const setLog = { schemaVersion: 1, planId: randomUUID(), exerciseIndex: 0, exerciseId: 'goblet_squat', set: { index: 1, status: 'done', reps: 8, seconds: null, loadKg: 20, rir: 2 }, loggedAt: '2026-09-23T10:00:00.000Z', correctionOf: null };
    expect(SetLogSchema.safeParse(setLog).success).toBe(true);
    expect(recordDataIssue(SYNC_COLLECTIONS, 'set_logs', setLog)).toBeNull();
    expect(recordDataIssue(SYNC_COLLECTIONS, 'set_logs', { ...setLog, note: 'knee pain after the fall' })).toBe('set_logs.invalid');
    expect(recordDataIssue(SYNC_COLLECTIONS, 'nope', {})).toBe('unknown_collection');
    const server = new SyncServer({ store: new MemoryServerStore(), enforceCollectionSchemas: true });
    const m = (data: Record<string, unknown>) => ({ mutationId: randomUUID(), collection: 'set_logs', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data, clientCreatedAt: new Date().toISOString() });
    const res = await server.push(USER, { deviceId: randomUUID(), mutations: [m(setLog), m({ ...setLog, note: 'knee pain after the fall' }), m({ ...setLog, set: { ...setLog.set, loadKg: 1e308 } })] });
    expect(res.results.map((r) => [r.status, r.reason])).toEqual([
      ['applied', undefined],
      ['rejected', 'set_logs.invalid'],
      ['rejected', 'set_logs.invalid'],
    ]);
    // Off by default (the API turns it on, FIX-C).
    const lenient = new SyncServer({ store: new MemoryServerStore() });
    expect((await lenient.push(USER, { deviceId: randomUUID(), mutations: [m({ free: 'form' })] })).results[0]!.status).toBe('applied');
  });

  it('integration FIX-E × FIX-C: preferences use the one strict PreferencesRecordSchema (no free field enters through sync)', () => {
    expect(SYNC_COLLECTIONS.preferences!.schema).toBe(PreferencesRecordSchema);
    expect(recordDataIssue(SYNC_COLLECTIONS, 'preferences', { locale: 'fr', units: 'metric', gym: true })).toBeNull();
    expect(recordDataIssue(SYNC_COLLECTIONS, 'preferences', { locale: 'fr', note: 'knee pain' })).toBe('preferences.invalid');
    expect(recordDataIssue(SYNC_COLLECTIONS, 'preferences', { theme: 'dark' })).toBe('preferences.invalid');
  });
});

describe('PKG-07: a hung request cannot stall sync', () => {
  const hangingFetch = (): typeof fetch => (async (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;

  it('HttpTransport aborts after the timeout and reports OfflineError, for headers and for the body', async () => {
    const transport = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: hangingFetch(), timeoutMs: 30 });
    await expect(transport.push({ deviceId: randomUUID(), mutations: [] })).rejects.toMatchObject({ name: 'OfflineError', message: 'timeout' });
    // A fetch that ignores the abort signal is still cut off.
    const deaf = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: (async () => new Promise<Response>(() => undefined)) as typeof fetch, timeoutMs: 30 });
    await expect(deaf.pull({ deviceId: randomUUID(), since: 0 })).rejects.toBeInstanceOf(OfflineError);
    // Headers arrive, the body never does.
    const stalledBody = { ok: true, status: 200, json: () => new Promise(() => undefined) } as unknown as Response;
    const slow = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: (async () => stalledBody) as typeof fetch, timeoutMs: 30 });
    await expect(slow.pull({ deviceId: randomUUID(), since: 0 })).rejects.toBeInstanceOf(OfflineError);
    expect(syncConfig.requestTimeoutMs).toMatchObject({ validated: false });
  });

  it('sign-in and response errors keep their previous mapping; a fast response is not affected by the timer', async () => {
    const noToken = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => { throw new Error('not signed in'); }, fetch: hangingFetch(), timeoutMs: 1_000 });
    await expect(noToken.push({ deviceId: randomUUID(), mutations: [] })).rejects.toMatchObject({ name: 'OfflineError', message: 'not signed in' });
    const badJson = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 't', fetch: (async () => new Response('not json', { status: 502 })) as typeof fetch, timeoutMs: 1_000 });
    await expect(badJson.push({ deviceId: randomUUID(), mutations: [] })).rejects.toMatchObject({ status: 502 });
    const fast = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 't', fetch: (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch, timeoutMs: 20 });
    await expect(fast.push({ deviceId: randomUUID(), mutations: [] })).resolves.toEqual({ results: [] });
    await new Promise((r) => setTimeout(r, 40));
  });

  it('SyncClient.sync settles offline within the timeout, and the next sync is a new run', async () => {
    const transport = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: hangingFetch(), timeoutMs: 40 });
    const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport, now: testClock(), newId: randomUUID });
    client.insert('set_logs', { reps: 1 });
    const started = Date.now();
    const first = client.sync();
    await expect(first).resolves.toMatchObject({ push: { offline: true }, pull: { offline: true } });
    expect(Date.now() - started).toBeLessThan(2_000);
    const second = client.sync();
    expect(second).not.toBe(first);
    await second;
    expect(client.pendingCount()).toBe(1);
    expect(client.outbox('pending')[0]).toMatchObject({ lastError: 'timeout' });
  });
});
