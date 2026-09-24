import { randomBytes, randomUUID } from 'node:crypto';
import type { WrappedPhotoKey } from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { photoBackups, syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';
import { integrationEnv } from './env.js';

/**
 * Regression tests for the API security review (docs/status/FIX-api-security.md):
 * each test failed on the code before its fix and passes after it. The
 * people and data are fictional.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

async function session() {
  const dev = device();
  const auth = await signIn(h, uniqueEmail(), dev);
  return { token: auth.tokens.accessToken, refresh: auth.tokens.refreshToken, userId: auth.user.id, deviceId: dev.id };
}
type Session = Awaited<ReturnType<typeof session>>;

/** Many sign-ups from one address (every inject is 127.0.0.1): clears this harness's per-IP sign-in counter. */
async function manySessions(n: number): Promise<Session[]> {
  const out: Session[] = [];
  for (let i = 0; i < n; i++) {
    const keys = await h.redis.keys(`${h.redisPrefix}rl:otp-request-ip:*`);
    if (keys.length) await h.redis.del(...keys);
    out.push(await session());
  }
  return out;
}

const insert = (collection: string, data: unknown, recordId: string = randomUUID()) => ({ mutationId: randomUUID(), collection, recordId, op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() });
type Mutation = ReturnType<typeof insert>;
const pushReq = (s: Session, mutations: unknown[]) => h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations } });
async function push(s: Session, mutations: Mutation[]) {
  const res = await pushReq(s, mutations);
  expect(res.statusCode).toBe(200);
  return (res.json() as { results: { status: string; reason?: string }[] }).results.map((r) => (r.status === 'rejected' ? r.reason : r.status));
}
const consent = (s: Session, dataType: string, decision: 'granted' | 'withdrawn' = 'granted') =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType, decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });

const readiness = () => {
  const at = h.clock.now().toISOString();
  return { schemaVersion: 1, date: at.slice(0, 10), at, sleep: 1, soreness: 5, stress: 4, energy: 2, wearable: null };
};
const healthRows = async (userId: string, collection: string) => (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection)))).length;

/** A second connection outside the app's pool, to hold locks the way a concurrent request would. */
async function outside() {
  const client = new pg.Client({ connectionString: integrationEnv().databaseUrl });
  await client.connect();
  return client;
}
/** In `client`'s open transaction: the user's lock, then a withdrawal of `dataType` written as the consent service writes it. */
async function withdrawInOpenTransaction(client: pg.Client, userId: string, dataType: string) {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
  await client.query(
    `INSERT INTO consent_records (id, user_id, data_type, decision, version, locale, jurisdiction, source, recorded_at) VALUES ($1, $2, $3, 'withdrawn', 1, 'en', 'GB', 'mobile', now())`,
    [randomUUID(), userId, dataType],
  );
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe('API-1: sync validators read through the sync transaction (no pool self-deadlock)', () => {
  it('more concurrent consent-gated pushes than pool connections all complete', async () => {
    const users = await manySessions(30);
    for (const u of users.slice(0, 15)) expect((await consent(u, 'health')).statusCode).toBe(201);
    const started = Date.now();
    const all = Promise.all(users.map((u) => pushReq(u, [insert('readiness_checks', readiness()), insert('readiness_checks', readiness()), insert('readiness_checks', { junk: true }), insert('readiness_checks', readiness()), insert('readiness_checks', readiness())])));
    const outcome = await Promise.race([all.then(() => 'completed'), settle(10_000).then(() => 'hung')]);
    if (outcome === 'hung') {
      // Free the stuck backends so the suite can close, then fail.
      const admin = await outside();
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()");
      await admin.end();
      await all.catch(() => undefined);
    }
    expect(outcome).toBe('completed');
    expect(Date.now() - started).toBeLessThan(10_000);
    const results = await all;
    const reasons = results.map((r) => (r.json() as { results: { status: string; reason?: string }[] }).results.map((x) => x.reason ?? x.status));
    // With consent: four applied, the malformed one rejected; without: every one refused on consent.
    for (const [i, r] of reasons.entries()) {
      expect(r).toEqual(i < 15 ? ['applied', 'applied', 'readiness_check.invalid', 'applied', 'applied'] : Array(5).fill('privacy.consent_required'));
    }
    expect(h.database.pool.waitingCount).toBe(0);
  }, 60_000);

  it('the pool has bounded waits: connection, statement and idle-in-transaction timeouts come from config', async () => {
    const { dbConfig } = await import('../../src/config/db.config.js');
    for (const v of Object.values(dbConfig)) expect(v.validated).toBe(false);
    const settings = await h.database.db.execute<{ s: string; i: string }>(sql`SELECT current_setting('statement_timeout') AS s, current_setting('idle_in_transaction_session_timeout') AS i`);
    const toMs = (v: string) => (v.endsWith('ms') ? Number(v.slice(0, -2)) : v.endsWith('s') ? Number(v.slice(0, -1)) * 1000 : v.endsWith('min') ? Number(v.slice(0, -3)) * 60_000 : Number(v));
    expect(toMs(settings.rows[0]!.s)).toBe(dbConfig.statementTimeoutMs.value);
    expect(toMs(settings.rows[0]!.i)).toBe(dbConfig.idleInTransactionTimeoutMs.value);
    expect(h.database.pool.options.connectionTimeoutMillis).toBe(dbConfig.connectionTimeoutMs.value);
    expect(h.database.pool.options.max).toBe(dbConfig.poolMax.value);
  });
});

describe('API-2: consent withdrawal and consent-gated writes are serialised per user', () => {
  it('a health push that passed its consent check before a withdrawal is erased by it (no health data left with consent withdrawn)', async () => {
    const s = await session();
    expect((await consent(s, 'health')).statusCode).toBe(201);
    // Creates the user's sync head row (set logs are not health data).
    expect(await push(s, [insert('preferences', { units: 'metric' })])).toEqual(['applied']);
    const locker = await outside();
    await locker.query('BEGIN');
    await locker.query('SELECT 1 FROM sync_heads WHERE user_id = $1 FOR UPDATE', [s.userId]);
    // The push takes the user's lock, validates (consent granted) and then waits on the head row.
    const inflight = pushReq(s, [insert('readiness_checks', readiness())]);
    await settle();
    // The withdrawal now waits for the push instead of committing under it.
    const withdrawal = consent(s, 'health', 'withdrawn');
    await settle();
    await locker.query('COMMIT');
    await locker.end();
    const [pushed, withdrawn] = await Promise.all([inflight, withdrawal]);
    expect(withdrawn.statusCode).toBe(201);
    expect(pushed.statusCode).toBe(200);
    expect(await healthRows(s.userId, 'readiness_checks')).toBe(0);
    const states = (await h.app.inject({ method: 'GET', url: '/v1/privacy/consents', headers: bearer(s.token) })).json() as { consents: { dataType: string; granted: boolean }[] };
    expect(states.consents.find((c) => c.dataType === 'health')!.granted).toBe(false);
  });

  it('a health push that reaches its consent check while a withdrawal is committing sees the withdrawal', async () => {
    const s = await session();
    expect((await consent(s, 'health')).statusCode).toBe(201);
    const other = await outside();
    await withdrawInOpenTransaction(other, s.userId, 'health');
    const inflight = pushReq(s, [insert('readiness_checks', readiness())]);
    await settle();
    await other.query('COMMIT');
    await other.end();
    const res = await inflight;
    expect((res.json() as { results: { reason?: string }[] }).results[0]!.reason).toBe('privacy.consent_required');
    expect(await healthRows(s.userId, 'readiness_checks')).toBe(0);
  });

  it('a photo upload racing a photos-consent withdrawal is refused (the consent is read in the writing transaction, after the lock)', async () => {
    const s = await session();
    expect((await consent(s, 'photos')).statusCode).toBe(201);
    expect((await h.app.inject({ method: 'PUT', url: '/v1/photos/backup/key', headers: bearer(s.token), payload: wrappedKey() })).statusCode).toBe(204);
    const other = await outside();
    await withdrawInOpenTransaction(other, s.userId, 'photos');
    const inflight = putPhoto(s, randomUUID(), envelope());
    await settle();
    await other.query('COMMIT');
    await other.end();
    const res = await inflight;
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'privacy.consent_required' } });
    expect(await h.database.db.select().from(photoBackups).where(eq(photoBackups.userId, s.userId))).toHaveLength(0);
  });

  it('a pair event racing a partner_sharing withdrawal is refused and nothing is relayed or stored', async () => {
    const s = await pairReady();
    const created = await createPair(s);
    expect(created.statusCode).toBe(201);
    const { pairSessionId } = created.json() as { pairSessionId: string };
    const other = await outside();
    await withdrawInOpenTransaction(other, s.userId, 'partner_sharing');
    const inflight = h.app.services.pair.append(s.userId, pairSessionId, randomUUID(), { type: 'turn', exerciseIndex: 0, setIndex: 0, status: 'done', performance: null }).then(
      () => 'stored',
      (e: { code?: string }) => e.code,
    );
    await settle();
    await other.query('COMMIT');
    await other.end();
    expect(await inflight).toBe('pair.consent_required');
    expect((await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pair_events WHERE pair_session_id = ${pairSessionId}`)).rows[0]!.n).toBe(0);
  });
});

async function acceptL2(u: Session) {
  for (const documentId of ['terms', 'privacy', 'exercise_risk']) {
    const d = (await h.app.inject({ method: 'GET', url: `/v1/legal/documents/${documentId}?locale=en&jurisdiction=GB` })).json() as { version: number; contentHash: string };
    expect((await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(u.token), payload: { documentId, version: d.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: d.contentHash } })).statusCode).toBe(201);
  }
}
/** Own texts accepted, own health and partner-sharing consents given (M09). */
async function pairReady(s?: Session) {
  const u = s ?? (await session());
  expect((await consent(u, 'health')).statusCode).toBe(201);
  await acceptL2(u);
  expect((await consent(u, 'partner_sharing')).statusCode).toBe(201);
  return u;
}
const createPair = (u: Session) => h.app.inject({ method: 'POST', url: '/v1/pair/sessions', headers: bearer(u.token), payload: { displayName: 'Host', scopes: [], jurisdiction: 'GB' } });

const wrappedKey = (): WrappedPhotoKey => ({ schemaVersion: 1, kdf: { name: 'scrypt', logN: 15, r: 8, p: 1 }, salt: randomBytes(16).toString('base64'), wrappedKey: Buffer.concat([Buffer.from([1]), randomBytes(12 + 32 + 16)]).toString('base64') });
const envelope = (bytes = 2048) => Buffer.concat([Buffer.from([1]), randomBytes(bytes)]);
const putPhoto = (s: Session, id: string, body: Buffer) => h.app.inject({ method: 'PUT', url: `/v1/photos/backup/photos/${id}`, headers: { ...bearer(s.token), 'content-type': 'application/octet-stream' }, payload: body });
