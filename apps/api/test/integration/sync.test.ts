import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { PullRequest, PushRequest } from '@fitadapt/shared';
import { HttpTransport, MemoryLocalStore, OfflineError, SyncClient, type SyncTransport } from '@fitadapt/sync';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

let h: Harness;
let baseUrl: string;

beforeAll(async () => {
  h = await createHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(h.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h);
});

/** Real HTTP transport with a switch to simulate airplane mode. */
class SwitchableTransport implements SyncTransport {
  online = true;
  constructor(private readonly inner: SyncTransport) {}
  push(r: PushRequest) {
    return this.online ? this.inner.push(r) : Promise.reject(new OfflineError());
  }
  pull(r: PullRequest) {
    return this.online ? this.inner.pull(r) : Promise.reject(new OfflineError());
  }
}

async function device(email: string) {
  const session = await signIn(h, email);
  const transport = new SwitchableTransport(new HttpTransport({ baseUrl, getAccessToken: () => session.tokens.accessToken }));
  const client = new SyncClient({ deviceId: session.deviceId, store: new MemoryLocalStore(), transport, newId: randomUUID });
  return { client, transport, session };
}

async function changeCount(): Promise<number> {
  const result = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sync_changes`);
  return result.rows[0]!.n;
}

describe('sync over HTTP with PostgreSQL', () => {
  it('offline record → outbox → pushed on reconnect → pulled by a second device', async () => {
    const email = uniqueEmail();
    const a = await device(email);
    const b = await device(email);
    a.transport.online = false;
    const id = a.client.insert('set_logs', { reps: 8 });
    expect((await a.client.sync()).push.offline).toBe(true);
    expect(a.client.pendingCount()).toBe(1);
    expect(await changeCount()).toBe(0);

    a.transport.online = true;
    await a.client.handleConnectivityChange(true);
    expect(a.client.pendingCount()).toBe(0);
    expect(await changeCount()).toBe(1);

    await b.client.sync();
    expect(b.client.get('set_logs', id)?.data).toEqual({ reps: 8 });
  });

  it('duplicate pushes are idempotent', async () => {
    const a = await device(uniqueEmail());
    a.client.insert('set_logs', { reps: 5 });
    const mutation = a.client.outbox('pending')[0]!.mutation;
    const push = () =>
      h.app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: bearer(a.session.tokens.accessToken),
        payload: { deviceId: a.session.deviceId, mutations: [mutation] },
      });
    const [first, second] = await Promise.all([push(), push()]);
    const statuses = [first.json().results[0].status, second.json().results[0].status].sort();
    expect(statuses).toEqual(['applied', 'duplicate']);
    expect(first.json().results[0].revision).toBe(second.json().results[0].revision);
    const third = await push();
    expect(third.json().results[0].status).toBe('duplicate');
    expect(await changeCount()).toBe(1);
  });

  it('concurrent append-only set logs from two devices both survive', async () => {
    const email = uniqueEmail();
    const a = await device(email);
    const b = await device(email);
    a.transport.online = false;
    b.transport.online = false;
    const ids = [a.client.insert('set_logs', { by: 'a' }), a.client.insert('set_logs', { by: 'a' }), b.client.insert('set_logs', { by: 'b' })];
    a.transport.online = true;
    b.transport.online = true;
    await Promise.all([a.client.sync(), b.client.sync()]);
    await Promise.all([a.client.sync(), b.client.sync()]);
    expect(await changeCount()).toBe(3);
    for (const d of [a, b]) expect(d.client.list('set_logs').map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it('revisions are per user: another user sees nothing', async () => {
    const a = await device(uniqueEmail());
    const stranger = await device(uniqueEmail());
    a.client.insert('set_logs', { reps: 1 });
    await a.client.sync();
    const pulled = await stranger.client.pull();
    expect(pulled.applied).toBe(0);
  });

  it('mutable records: server wins on conflict', async () => {
    const email = uniqueEmail();
    const a = await device(email);
    const b = await device(email);
    const id = a.client.insert('preferences', { units: 'metric' });
    await a.client.sync();
    await b.client.sync();
    a.client.update('preferences', id, { units: 'imperial' });
    b.client.update('preferences', id, { units: 'metric', gym: true });
    await a.client.sync();
    expect((await b.client.sync()).push.conflicts).toBe(1);
    expect(b.client.get('preferences', id)?.data).toEqual({ units: 'imperial' });
  });

  it('requires auth and the session device', async () => {
    const a = await device(uniqueEmail());
    const noAuth = await h.app.inject({ method: 'POST', url: '/v1/sync/pull', payload: { deviceId: a.session.deviceId, since: 0 } });
    expect(noAuth.statusCode).toBe(401);
    for (const url of ['/v1/sync/pull', '/v1/sync/push']) {
      const wrong = await h.app.inject({
        method: 'POST',
        url,
        headers: bearer(a.session.tokens.accessToken),
        payload: url.endsWith('pull') ? { deviceId: randomUUID(), since: 0 } : { deviceId: randomUUID(), mutations: [] },
      });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json()).toEqual({ error: { code: 'sync.device_mismatch' } });
    }
  });
});
