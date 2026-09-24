import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { notice, renderNotice } from '@fitadapt/legal';
import { EMPTY_BIOMETRICS, PAIR_JOIN_CODE_ALPHABET, PAIR_JOIN_CODE_LENGTH, PROFILE_RECORD_ID, type CalendarDateValue, type Profile, type WrappedPhotoKey } from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { photoBackups, syncChanges, syncMutations } from '../../src/db/schema.js';
import { PairService } from '../../src/pair/service.js';
import { PEPPER, bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';
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
    const all = Promise.all(users.map((u) => pushReq(u, [insert('readiness_checks', readiness()), insert('readiness_checks', readiness()), insert('readiness_checks', readiness()), insert('readiness_checks', readiness()), insert('readiness_checks', readiness())])));
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
    // With consent: all applied; without: every one refused on consent.
    for (const [i, r] of reasons.entries()) {
      expect(r).toEqual(i < 15 ? Array(5).fill('applied') : Array(5).fill('privacy.consent_required'));
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

const ADULT: CalendarDateValue = { year: 1988, month: 3, day: 14 };
const profile = (birthDate = ADULT, goal: 'fat_loss' | 'strength' = 'fat_loss'): Profile => ({
  schemaVersion: 1,
  goals: { primary: goal, secondary: null },
  experience: 'beginner',
  schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: [], remindersEnabled: false },
  birthDate,
  biometrics: EMPTY_BIOMETRICS,
  limitations: [],
  excludedExerciseIds: [],
  motivation: null,
  activeEquipmentProfileId: null,
  onboardingCompletedAt: h.clock.now().toISOString(),
});

describe('API-3: the idempotency ledger keeps no copy of a record', () => {
  it('a conflict stores no record data; a replay rebuilds it from the stored change, and after a health withdrawal nothing is left', async () => {
    const s = await session();
    expect((await consent(s, 'health')).statusCode).toBe(201);
    expect(await push(s, [insert('profile', profile(), PROFILE_RECORD_ID)])).toEqual(['applied']);
    // A second device inserts the same record: conflict, answered with the stored profile.
    const second = insert('profile', profile(ADULT, 'strength'), PROFILE_RECORD_ID);
    const first = (await pushReq(s, [second])).json() as { results: { status: string; current?: { data: Profile } }[] };
    expect(first.results[0]).toMatchObject({ status: 'conflict', current: { data: { birthDate: ADULT } } });
    const ledger = async () => (await h.database.db.select().from(syncMutations).where(eq(syncMutations.userId, s.userId))).map((r) => JSON.stringify(r.result));
    expect((await ledger()).filter((r) => r.includes('birthDate') || r.includes('"data"'))).toEqual([]);
    // A replay still gets the record's current state (read again from sync_changes).
    const replay = (await pushReq(s, [second])).json() as { results: { status: string; current?: { data: Profile } }[] };
    expect(replay.results[0]).toMatchObject({ status: 'conflict', current: { data: { birthDate: ADULT } } });
    // Withdrawn: the profile is erased, and the ledger never held a copy.
    expect((await consent(s, 'health', 'withdrawn')).statusCode).toBe(201);
    expect((await ledger()).filter((r) => r.includes('birthDate'))).toEqual([]);
    const after = (await pushReq(s, [second])).json() as { results: { status: string; current?: unknown }[] };
    expect(after.results[0]).toEqual({ mutationId: second.mutationId, status: 'conflict' });
    const exported = await h.app.inject({ method: 'GET', url: '/v1/privacy/export', headers: bearer(s.token) });
    expect(exported.body).not.toContain('birthDate');
  });

  it('migration 0010 scrubs the record copies stored in the ledger before the fix', async () => {
    const s = await session();
    const legacy = { mutationId: randomUUID(), status: 'conflict', current: { revision: 1, collection: 'profile', recordId: PROFILE_RECORD_ID, op: 'upsert', data: { birthDate: ADULT }, originDeviceId: s.deviceId } };
    await h.database.db.insert(syncMutations).values({ userId: s.userId, mutationId: legacy.mutationId, result: legacy });
    const migration = readFileSync(fileURLToPath(new URL('../../drizzle/0010_fix_ledger_no_record_copy.sql', import.meta.url)), 'utf8');
    await h.database.db.execute(sql.raw(migration));
    const [row] = await h.database.db.select().from(syncMutations).where(eq(syncMutations.mutationId, legacy.mutationId));
    expect(row!.result).toEqual({ mutationId: legacy.mutationId, status: 'conflict', currentRef: { collection: 'profile', recordId: PROFILE_RECORD_ID } });
  });
});

const joinPair = (u: Session, joinCode: string, ip?: string) =>
  h.app.inject({ method: 'POST', url: '/v1/pair/sessions/join', headers: bearer(u.token), payload: { joinCode, displayName: 'Guest', scopes: [], jurisdiction: 'GB' }, ...(ip ? { remoteAddress: ip } : {}) });
const guess = () => Array.from({ length: PAIR_JOIN_CODE_LENGTH }, () => PAIR_JOIN_CODE_ALPHABET[Math.floor(Math.random() * PAIR_JOIN_CODE_ALPHABET.length)]).join('');

describe('API-4: pair join codes cannot be brute-forced', () => {
  it('codes are eight characters; the 11th join attempt of an account within the window answers 429', async () => {
    const host = await pairReady();
    const created = (await createPair(host)).json() as { joinCode: string };
    expect(created.joinCode).toMatch(new RegExp(`^[${PAIR_JOIN_CODE_ALPHABET}]{8}$`));
    const { pairConfig } = await import('../../src/config/pair.config.js');
    const s = await pairReady();
    const statuses: number[] = [];
    for (let i = 0; i < pairConfig.joinAttemptsPerUserPerWindow.value + 1; i++) statuses.push((await joinPair(s, guess())).statusCode);
    expect(statuses.slice(0, -1).every((c) => c === 404)).toBe(true);
    const limited = await joinPair(s, created.joinCode);
    expect(statuses.at(-1)).toBe(429);
    // Even the right code is refused once limited: guessing gains nothing.
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: 'pair.rate_limited' } });
    // A six-character code (the old format) is not a code any more.
    expect((await joinPair(host, 'ABCDEF')).statusCode).toBe(400);
  });

  it('attempts from one address are limited across accounts', async () => {
    const { pairConfig } = await import('../../src/config/pair.config.js');
    const perUser = pairConfig.joinAttemptsPerUserPerWindow.value;
    const users = await manySessions(Math.ceil(pairConfig.joinAttemptsPerIpPerWindow.value / perUser) + 1);
    for (const u of users) await pairReady(u);
    let sent = 0;
    const statuses: number[] = [];
    for (const u of users) {
      for (let i = 0; i < perUser && sent <= pairConfig.joinAttemptsPerIpPerWindow.value; i++, sent++) statuses.push((await joinPair(u, guess(), '198.51.100.7')).statusCode);
    }
    expect(statuses.filter((c) => c === 404)).toHaveLength(pairConfig.joinAttemptsPerIpPerWindow.value);
    expect(statuses.at(-1)).toBe(429);
    // Another address is not affected.
    expect((await joinPair(users.at(-1)!, guess(), '203.0.113.9')).statusCode).toBe(404);
  });
});

describe('API-12: a join code that collides with a stored one is drawn again', () => {
  it('creates the session with a fresh code instead of failing with 500', async () => {
    const host = await pairReady();
    const other = await pairReady();
    const codes = ['AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB'];
    const pair = new PairService({ db: h.database.db, privacy: h.app.services.privacy, legal: h.app.services.legal, pepper: PEPPER, now: h.clock.now, newJoinCode: () => codes.shift()! });
    expect((await pair.create(host.userId, { displayName: 'Host', scopes: [], jurisdiction: 'GB' })).joinCode).toBe('AAAAAAAA');
    expect((await pair.create(other.userId, { displayName: 'Other', scopes: [], jurisdiction: 'GB' })).joinCode).toBe('BBBBBBBB');
    expect(codes).toEqual([]);
  });
});

describe('API-10: per-user limits on appends to never-purged tables', () => {
  it('consent decisions: the next one after the limit answers 429, but a withdrawal that takes effect is never refused', async () => {
    const { privacyConfig } = await import('../../src/config/privacy.config.js');
    const s = await session();
    for (let i = 0; i < privacyConfig.consentDecisionsPerWindow.value; i++) {
      expect((await consent(s, 'analytics', i % 2 === 0 ? 'granted' : 'withdrawn')).statusCode).toBe(201);
    }
    // Over the limit: a grant is refused...
    const refused = await consent(s, 'analytics', 'granted');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: { code: 'privacy.rate_limited' } });
    // ...a withdrawal of a consent that is not granted adds nothing and is refused too...
    expect((await consent(s, 'analytics', 'withdrawn')).statusCode).toBe(429);
    // ...but withdrawing a consent that is granted always goes through (GDPR Art. 7(3)).
    await h.redis.del(...(await h.redis.keys(`${h.redisPrefix}rl:privacy-consent:*`)));
    expect((await consent(s, 'photos', 'granted')).statusCode).toBe(201);
    for (let i = 0; i < privacyConfig.consentDecisionsPerWindow.value; i++) await consent(s, 'analytics', 'withdrawn');
    expect((await consent(s, 'photos', 'withdrawn')).statusCode).toBe(201);
  });

  it('legal acceptances and notices: 429 after the limit', async () => {
    const { privacyConfig } = await import('../../src/config/privacy.config.js');
    const s = await session();
    const terms = (await h.app.inject({ method: 'GET', url: '/v1/legal/documents/terms?locale=en&jurisdiction=GB' })).json() as { version: number; contentHash: string };
    const accept = () => h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(s.token), payload: { documentId: 'terms', version: terms.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: terms.contentHash } });
    for (let i = 0; i < privacyConfig.acceptancesPerWindow.value; i++) expect((await accept()).statusCode).toBe(201);
    expect((await accept()).statusCode).toBe(429);
    const hash = renderNotice(notice('first_workout'), 'en', 'GB').contentHash;
    const shown = () => h.app.inject({ method: 'POST', url: '/v1/legal/notices', headers: bearer(s.token), payload: { noticeId: 'first_workout', version: 1, kind: 'shown', locale: 'en', jurisdiction: 'GB', contentHash: hash } });
    for (let i = 0; i < privacyConfig.noticesPerWindow.value; i++) expect((await shown()).statusCode).toBe(204);
    const limited = await shown();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: 'legal.rate_limited' } });
  }, 60_000);

  it('pair sessions: the next one after the limit answers 429', async () => {
    const { pairConfig } = await import('../../src/config/pair.config.js');
    const host = await pairReady();
    for (let i = 0; i < pairConfig.createsPerUserPerWindow.value; i++) expect((await createPair(host)).statusCode).toBe(201);
    expect((await createPair(host)).statusCode).toBe(429);
  });
});

/** Runs `fn` with photo limits lowered (restored after), so a test does not have to upload gigabytes. */
async function withPhotoLimits(values: Partial<Record<'maxBytesPerUser' | 'uploadsPerUserPerWindow' | 'maxPhotosPerUser', number>>, fn: () => Promise<void>) {
  const { photosConfig } = await import('../../src/config/photos.config.js');
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, photosConfig[k as keyof typeof values].value]));
  for (const [k, v] of Object.entries(values)) photosConfig[k as keyof typeof values].value = v;
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) photosConfig[k as keyof typeof values].value = v;
  }
}
async function photoReady() {
  const s = await session();
  expect((await consent(s, 'photos')).statusCode).toBe(201);
  expect((await h.app.inject({ method: 'PUT', url: '/v1/photos/backup/key', headers: bearer(s.token), payload: wrappedKey() })).statusCode).toBe(204);
  return s;
}

describe('API-7: photo uploads are authenticated before their body is read; storage and rate are bounded', () => {
  it('a large body without a token answers 401 (not 413: the body is never parsed)', async () => {
    const payload = Buffer.alloc(16 * 1024 * 1024, 1);
    const res = await h.app.inject({ method: 'PUT', url: `/v1/photos/backup/photos/${randomUUID()}`, headers: { 'content-type': 'application/octet-stream' }, payload });
    expect(res.statusCode).toBe(401);
    // Every authenticated plugin checks the token first: a malformed sync body without a token is 401 too.
    expect((await h.app.inject({ method: 'POST', url: '/v1/sync/push', payload: { junk: true } })).statusCode).toBe(401);
  });

  it('an account cannot store more than its byte quota; replacing a photo counts only the new envelope', async () => {
    const s = await photoReady();
    await withPhotoLimits({ maxBytesPerUser: 5000 }, async () => {
      const id = randomUUID();
      expect((await putPhoto(s, id, envelope(2000))).statusCode).toBe(201);
      expect((await putPhoto(s, randomUUID(), envelope(2000))).statusCode).toBe(201);
      const full = await putPhoto(s, randomUUID(), envelope(2000));
      expect(full.statusCode).toBe(409);
      expect(full.json()).toEqual({ error: { code: 'photos.storage_full' } });
      // Replacing the first photo with one of the same size fits.
      expect((await putPhoto(s, id, envelope(2000))).statusCode).toBe(201);
    });
  });

  it('uploads per account are rate-limited', async () => {
    const s = await photoReady();
    await withPhotoLimits({ uploadsPerUserPerWindow: 3 }, async () => {
      for (let i = 0; i < 3; i++) expect((await putPhoto(s, randomUUID(), envelope())).statusCode).toBe(201);
      const limited = await putPhoto(s, randomUUID(), envelope());
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: { code: 'photos.rate_limited' } });
    });
  });
});

describe('API-12: the photo count quota cannot be raced past', () => {
  it('parallel uploads of new photos never exceed the per-account limit', async () => {
    const s = await photoReady();
    await withPhotoLimits({ maxPhotosPerUser: 2 }, async () => {
      expect((await putPhoto(s, randomUUID(), envelope())).statusCode).toBe(201);
      // Hold inserts back (reads still work) so every upload reaches its count before any insert commits.
      const blocker = await outside();
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE photo_backups IN SHARE MODE');
      const inflight = Promise.all(Array.from({ length: 6 }, () => putPhoto(s, randomUUID(), envelope())));
      await settle(600);
      await blocker.query('COMMIT');
      await blocker.end();
      const results = await inflight;
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await h.database.db.select().from(photoBackups).where(eq(photoBackups.userId, s.userId))).toHaveLength(2);
    });
  });
});

describe('API-11: a push reads each stored collection once, then only what was appended', () => {
  it('rows are cached within a push, appended rows are fetched incrementally, and an erasure forces a full reload', async () => {
    const { collectionRows, pushCacheStats, withPushCache, parsedRows } = await import('../../src/profile/stored-rows.js');
    const { SetLogSchema } = await import('@fitadapt/shared');
    const s = await session();
    const log = (reps: number) => ({ schemaVersion: 1, planId: randomUUID(), exerciseIndex: 0, exerciseId: 'goblet_squat', set: { index: 1, status: 'done', reps, seconds: null, loadKg: 20, rir: 2 }, loggedAt: h.clock.now().toISOString(), correctionOf: null });
    expect(await push(s, [insert('set_logs', log(1)), insert('set_logs', log(2)), insert('set_logs', log(3))])).toEqual(['applied', 'applied', 'applied']);
    const db = h.database.db;
    await withPushCache(async () => {
      expect(await collectionRows(db, s.userId, 'set_logs')).toHaveLength(3);
      const first = await collectionRows(db, s.userId, 'set_logs');
      expect(pushCacheStats()).toEqual({ fullLoads: 1, incrementalLoads: 0 });
      // Parsed once per row and schema: the same objects come back.
      expect(parsedRows(first, SetLogSchema)[0]!.data).toBe(parsedRows(first, SetLogSchema)[0]!.data);
      // Another device appends (committed between two mutations of this push).
      await db.insert(syncChanges).values({ userId: s.userId, revision: 4, collection: 'set_logs', recordId: randomUUID(), op: 'upsert', data: log(4), originDeviceId: s.deviceId });
      expect((await collectionRows(db, s.userId, 'set_logs')).map((r) => (r.data as { set: { reps: number } }).set.reps)).toEqual([1, 2, 3, 4]);
      expect(pushCacheStats()).toEqual({ fullLoads: 1, incrementalLoads: 1 });
      // A row erased in between (e.g. a consent withdrawal) is never served from the cache.
      await db.delete(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.revision, 2)));
      expect((await collectionRows(db, s.userId, 'set_logs')).map((r) => r.revision)).toEqual([1, 3, 4]);
      expect(pushCacheStats()).toEqual({ fullLoads: 2, incrementalLoads: 1 });
    });
    // Outside a push there is no cache.
    expect(pushCacheStats()).toBeNull();
    expect(await collectionRows(db, s.userId, 'set_logs')).toHaveLength(3);
  });
});

describe('sync push body limit (with FIX-E: the device keeps a push at 512 KiB or less)', () => {
  it('a push body over the configured limit answers 413; one under it is processed', async () => {
    const { syncConfig } = await import('../../src/config/sync.config.js');
    const s = await session();
    const big = { units: 'metric', displayName: 'x'.repeat(10) };
    const many = Array.from({ length: 500 }, () => insert('preferences', big));
    const padded = { deviceId: s.deviceId, mutations: many, pad: 'p'.repeat(syncConfig.pushBodyLimitBytes.value) };
    expect((await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: padded })).statusCode).toBe(413);
    expect((await pushReq(s, [insert('preferences', big)])).statusCode).toBe(200);
  });
});

describe('API-8: behind the edge proxy, per-address limits are per client', () => {
  const requestCode = (app: Harness['app'], forwardedFor?: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { email: uniqueEmail(), locale: 'en' }, headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} });

  it('with one trusted hop, clients behind the proxy get their own sign-in bucket; the client cannot choose it', async () => {
    const { authConfig } = await import('../../src/config/auth.config.js');
    const limit = authConfig.otpRequestsPerIpPerWindow.value;
    const proxied = await createHarness({ trustProxyHops: 1 });
    try {
      // More sign-ins than one bucket allows, from different clients through the proxy (127.0.0.1): none is refused.
      for (let i = 0; i < limit + 5; i++) expect((await requestCode(proxied.app, `198.51.100.${i + 1}`)).statusCode).toBe(202);
      // One client is limited on its own; a spoofed left-most entry does not give it a new bucket.
      for (let i = 0; i < limit; i++) expect((await requestCode(proxied.app, `10.0.0.${i}, 203.0.113.50`)).statusCode).toBe(202);
      expect((await requestCode(proxied.app, '10.9.9.9, 203.0.113.50')).statusCode).toBe(429);
    } finally {
      await proxied.close();
    }
  });

  it('with no trusted hop (the default), X-Forwarded-For is ignored', async () => {
    const { authConfig } = await import('../../src/config/auth.config.js');
    const limit = authConfig.otpRequestsPerIpPerWindow.value;
    for (let i = 0; i < limit; i++) expect((await requestCode(h.app, `198.51.100.${i + 1}`)).statusCode).toBe(202);
    expect((await requestCode(h.app, '198.51.100.250')).statusCode).toBe(429);
  });
});
