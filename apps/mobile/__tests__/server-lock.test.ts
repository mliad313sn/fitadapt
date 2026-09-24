import { drizzle } from 'drizzle-orm/sql-js';
import { randomBytes, randomUUID } from 'node:crypto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createAppServices } from '../src/app-services';
import { MemoryVault } from '../src/auth/vault';
import { selectIntensityLock, serverLockEvents } from '../src/profile/selectors';
import type { PhotoFiles } from '../src/progress/photo-vault';
import { createServerLockApi, refreshServerLock } from '../src/safety/server-lock';
import { MemoryDeviceKeyStore } from '../src/storage/device-keys';

/**
 * Integration FIX-C × FIX-D (MOB-08, ADR-027): the device reads the S3 lock
 * the server retains (GET /v1/safety/intensity-lock) when online, treats it as
 * locked, and its medical-review attestation names the server's flagIds.
 * Offline: the last answer and the device's own lock still apply.
 * Fictional user; ids only, no symptom.
 */
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const NOW = new Date('2026-09-24T10:00:00.000Z');
const FLAG = '00000000-0000-4000-8000-00000000f1a9';
const SINCE = '2026-09-23T18:00:00.000Z';

function memFiles(): PhotoFiles {
  const m = new Map<string, Uint8Array>();
  return { write: (n, b) => void m.set(n, b), read: (n) => m.get(n)!, remove: (n) => void m.delete(n), list: () => [...m.keys()] };
}

/** A fetch where only the lock and token-refresh endpoints answer; everything else is "no network". */
function lockFetch(answer: () => unknown) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/v1/safety/intensity-lock') return new Response(JSON.stringify(answer()), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === '/v1/auth/refresh') {
      const tokens = { tokenType: 'Bearer', accessToken: 'access', accessTokenExpiresInSeconds: 900, refreshToken: 'refresh-2', refreshTokenExpiresInSeconds: 86_400 };
      return new Response(JSON.stringify({ tokens }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new TypeError('network down');
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

async function services(fetch: typeof globalThis.fetch) {
  const tokens = new MemoryVault();
  const app = createAppServices({
    db: drizzle(new SQL.Database()),
    jurisdiction: 'GB',
    initialLocale: 'en',
    apiUrl: 'https://api.example.test',
    randomUUID,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => NOW,
    keys: new MemoryDeviceKeyStore(),
    photoFiles: memFiles(),
    tokenVault: tokens,
    platform: 'ios',
    fetch,
  });
  await tokens.set('refresh-token');
  await app.session.getState().restore();
  return app;
}

describe('integration FIX-C × FIX-D: the server-retained S3 lock on the device', () => {
  it('online: a lock the server retains locks the device although it holds no red flag; the attestation names the server flag and lifts it', async () => {
    let server = { locked: true, since: SINCE, flagIds: [FLAG] };
    const net = lockFetch(() => server);
    const app = await services(net.fetch);
    expect(app.session.getState().status).toBe('signed_in');
    expect(selectIntensityLock(app.profile.getState().executionLogs, app.profile.getState().serverLock)).toEqual({ locked: false, since: null });

    await app.accountSync();
    expect(net.calls).toContain('/v1/safety/intensity-lock');
    expect(app.profile.getState().serverLock).toEqual(server);
    expect(selectIntensityLock(app.profile.getState().executionLogs, app.profile.getState().serverLock)).toEqual({ locked: true, since: SINCE });

    const attested = app.profile.getState().logExecution({ kind: 'medical_review_attested', at: NOW.toISOString(), statementVersion: 1 });
    expect(attested).toMatchObject({ kind: 'medical_review_attested', attests: [FLAG] });
    // Lifted on the device at once (offline too), before the server has seen the attestation.
    expect(selectIntensityLock(app.profile.getState().executionLogs, app.profile.getState().serverLock)).toEqual({ locked: false, since: null });

    server = { locked: false, since: null, flagIds: [] };
    await app.accountSync();
    expect(app.profile.getState().serverLock).toEqual(server);
    expect(selectIntensityLock(app.profile.getState().executionLogs, app.profile.getState().serverLock).locked).toBe(false);
  });

  it('offline: the last answer still locks after a restart and a health-consent withdrawal; the local lock applies unchanged; the wipe forgets it', async () => {
    const net = lockFetch(() => ({ locked: true, since: SINCE, flagIds: [FLAG] }));
    const app = await services(net.fetch);
    await app.accountSync();
    app.profile.getState().forgetHealthData();
    app.profile.getState().reload();
    app.profile.getState().reset();
    expect(app.profile.getState().serverLock).toMatchObject({ locked: true });
    expect(selectIntensityLock(app.profile.getState().executionLogs, app.profile.getState().serverLock).locked).toBe(true);

    // The device's own red flag locks with no server answer at all (unchanged behaviour).
    const offline = await services(lockFetch(() => ({ locked: false, since: null, flagIds: [] })).fetch);
    offline.profile.getState().logExecution({ kind: 'red_flag', planId: null, symptom: 'palpitations', at: SINCE });
    expect(selectIntensityLock(offline.profile.getState().executionLogs)).toMatchObject({ locked: true });
    expect(selectIntensityLock(offline.profile.getState().executionLogs, null)).toMatchObject({ locked: true });
    // An "unlocked" server answer never lifts a lock the device holds (the stricter wins).
    expect(selectIntensityLock(offline.profile.getState().executionLogs, { locked: false, since: null, flagIds: [] })).toMatchObject({ locked: true });

    await app.wipeLocalData();
    expect(app.profile.getState().serverLock).toBeNull();
  });

  it('the client: a server lock without flag ids still locks until a later attestation; failures change nothing and offline is not reported', async () => {
    expect(serverLockEvents({ locked: true, since: SINCE, flagIds: [] })).toEqual([{ kind: 'red_flag', at: SINCE }]);
    expect(serverLockEvents({ locked: false, since: null, flagIds: [] })).toEqual([]);
    expect(serverLockEvents(null)).toEqual([]);
    const received: unknown[] = [];
    const errors: unknown[] = [];
    const down = createServerLockApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 't', fetch: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch });
    await refreshServerLock(down, (l) => received.push(l), (e) => errors.push(e));
    const refused = createServerLockApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 't', fetch: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch });
    await refreshServerLock(refused, (l) => received.push(l), (e) => errors.push(e));
    const malformed = createServerLockApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 't', fetch: (async () => new Response(JSON.stringify({ locked: 'yes' }), { status: 200 })) as unknown as typeof fetch });
    await refreshServerLock(malformed, (l) => received.push(l), (e) => errors.push(e));
    expect(received).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});
