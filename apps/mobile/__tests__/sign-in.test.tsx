import type { AcceptanceRecord } from '@fitadapt/legal';
import type { ConsentRecord } from '@fitadapt/shared';
import { MemoryLocalStore, MemoryServerStore, InMemoryTransport, OfflineError, SyncClient, SyncServer } from '@fitadapt/sync';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { runAccountSync, UploadLedger, type AccountApi } from '../src/account/account-sync';
import { ApiRequestError, createAuthApi, jsonPost, type AuthApi } from '../src/auth/auth-api';
import { createSessionStore } from '../src/auth/session-store';
import { MemoryVault } from '../src/auth/vault';
import type { DeviceNoticeImpression } from '../src/legal/legal-store';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr } from './helpers';
import { appRoutes } from './routes';

/**
 * M01 sign-in (M00 deferred it): one-time code, refresh token in the OS
 * keystore, rotation, and the upload of the device ledgers (M17 consents,
 * M20 acceptances and notices) before sync.
 */
const tokens = (n: number) => ({ tokenType: 'Bearer' as const, accessToken: `access-${n}`, accessTokenExpiresInSeconds: 900, refreshToken: `refresh-${n}`, refreshTokenExpiresInSeconds: 2_592_000 });
const user = { id: randomUUID(), email: 'fictional.user@example.test', locale: 'en' as const, unitSystem: 'metric' as const, createdAt: '2026-09-23T10:00:00.000Z' };

function fakeAuth(): AuthApi & { calls: string[] } {
  let n = 0;
  const calls: string[] = [];
  return {
    calls,
    async requestCode() {
      calls.push('request');
    },
    async verifyCode(_e, code) {
      calls.push('verify');
      if (code !== '123456') throw new ApiRequestError(401, 'auth.invalid_code');
      return { user, isNewUser: true, tokens: tokens(++n) };
    },
    async refresh(token) {
      calls.push(`refresh:${token}`);
      if (token === 'refresh-reused') throw new ApiRequestError(401, 'auth.refresh_token_reused');
      return tokens(++n);
    },
    async logout(token) {
      calls.push(`logout:${token}`);
    },
  };
}

describe('session (ADR-003, ADR-013)', () => {
  it('keeps the refresh token in the keystore, the access token in memory, and rotates it before expiry', async () => {
    const api = fakeAuth();
    const vault = new MemoryVault();
    let now = new Date('2026-09-23T10:00:00.000Z');
    const signedIn = jest.fn();
    const session = createSessionStore({ api, vault, device: () => ({ id: randomUUID(), platform: 'ios' }), now: () => now, onSignedIn: signedIn });
    await session.getState().restore();
    expect(session.getState().status).toBe('signed_out');
    await expect(session.getState().getAccessToken()).rejects.toThrow('not signed in');

    await expect(session.getState().verifyCode('fictional.user@example.test', '000000')).rejects.toMatchObject({ code: 'auth.invalid_code' });
    expect(session.getState().status).toBe('signed_out');
    await session.getState().verifyCode('fictional.user@example.test', '123456');
    expect(session.getState().status).toBe('signed_in');
    expect(signedIn).toHaveBeenCalledTimes(1);
    expect(vault.token).toBe('refresh-1');
    expect(await session.getState().getAccessToken()).toBe('access-1');

    now = new Date(now.getTime() + 880_000); // within the refresh margin
    expect(await session.getState().getAccessToken()).toBe('access-2');
    expect(vault.token).toBe('refresh-2');
    expect(api.calls).toContain('refresh:refresh-1');

    // A new app start restores the session from the keystore.
    const restarted = createSessionStore({ api, vault, device: () => ({ id: randomUUID(), platform: 'ios' }), now: () => now });
    await restarted.getState().restore();
    expect(restarted.getState().status).toBe('signed_in');
    expect(await restarted.getState().getAccessToken()).toBe('access-3');

    await restarted.getState().signOut();
    expect(api.calls).toContain('logout:refresh-3');
    expect(vault.token).toBeNull();
    expect(restarted.getState().status).toBe('signed_out');
  });

  it('signs out on the device when the server says the session ended (reused refresh token)', async () => {
    const vault = new MemoryVault();
    vault.token = 'refresh-reused';
    const session = createSessionStore({ api: fakeAuth(), vault, device: () => ({ id: randomUUID(), platform: 'android' }), now: () => new Date() });
    await session.getState().restore();
    await expect(session.getState().getAccessToken()).rejects.toMatchObject({ code: 'auth.refresh_token_reused' });
    expect(session.getState().status).toBe('signed_out');
    expect(vault.token).toBeNull();
  });

  it('the HTTP client maps network failures to OfflineError and error bodies to codes', async () => {
    const offline = createAuthApi(jsonPost('https://api.example.test', (async () => Promise.reject(new TypeError('Network request failed'))) as typeof fetch));
    await expect(offline.requestCode('a@example.test', 'en')).rejects.toBeInstanceOf(OfflineError);
    const failing = createAuthApi(jsonPost('https://api.example.test', (async () => new Response(JSON.stringify({ error: { code: 'auth.rate_limited' } }), { status: 429 })) as typeof fetch));
    await expect(failing.requestCode('a@example.test', 'en')).rejects.toMatchObject({ status: 429, code: 'auth.rate_limited' });
    const ok = createAuthApi(jsonPost('https://api.example.test', (async () => new Response(null, { status: 204 })) as typeof fetch));
    await expect(ok.logout('refresh-1')).resolves.toBeUndefined();
  });
});

describe('account sync: device ledgers first, then the outbox', () => {
  const consent = (id: string, at: string): ConsentRecord => ({ id, dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', recordedAt: at });
  const acceptance: AcceptanceRecord = { id: randomUUID(), documentId: 'terms', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: 'a'.repeat(64), acceptedAt: '2026-09-23T10:05:00.000Z' };
  const notice: DeviceNoticeImpression = { id: randomUUID(), noticeId: 'first_workout', version: 1, kind: 'shown', locale: 'en', jurisdiction: 'GB', contentHash: 'b'.repeat(64), occurredAt: '2026-09-23T10:06:00.000Z' };

  function setup(fail: (kind: string, id: string) => Error | null = () => null) {
    const order: string[] = [];
    const api: AccountApi = {
      postConsent: async (r) => {
        const e = fail('consent', r.id);
        if (e) throw e;
        order.push(`consent:${r.recordedAt}`);
      },
      postAcceptance: async (r) => {
        const e = fail('acceptance', r.id);
        if (e) throw e;
        order.push(`acceptance:${r.documentId}`);
      },
      postNotice: async (r) => {
        const e = fail('notice', r.id);
        if (e) throw e;
        order.push(`notice:${r.noticeId}`);
      },
    };
    const server = new SyncServer({ store: new MemoryServerStore() });
    const sync = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(server, 'u'), newId: randomUUID });
    const pushSpy = jest.spyOn(sync, 'sync');
    pushSpy.mockImplementation(async (...args) => {
      order.push('sync');
      return SyncClient.prototype.sync.apply(sync, args);
    });
    return { order, api, sync, ledger: new UploadLedger(new MemoryKeyValueStore()) };
  }

  it('uploads consents in time order, then acceptances and notices, then syncs; each record once', async () => {
    const s = setup();
    const consents = [consent(randomUUID(), '2026-09-23T10:02:00.000Z'), consent(randomUUID(), '2026-09-23T10:01:00.000Z')];
    const input = { ...s, consents, acceptances: [acceptance], notices: [notice] };
    expect(await runAccountSync(input)).toEqual({ offline: false, uploaded: 4, refused: 0 });
    expect(s.order).toEqual(['consent:2026-09-23T10:01:00.000Z', 'consent:2026-09-23T10:02:00.000Z', 'acceptance:terms', 'notice:first_workout', 'sync']);
    expect(await runAccountSync(input)).toEqual({ offline: false, uploaded: 0, refused: 0 });
  });

  it('stops before syncing when offline and resumes where it stopped', async () => {
    let offline = true;
    const s = setup((kind) => (offline && kind === 'acceptance' ? new OfflineError() : null));
    const input = { ...s, consents: [consent(randomUUID(), '2026-09-23T10:01:00.000Z')], acceptances: [acceptance], notices: [notice] };
    expect(await runAccountSync(input)).toEqual({ offline: true, uploaded: 1, refused: 0 });
    expect(s.order).toEqual(['consent:2026-09-23T10:01:00.000Z']);
    offline = false;
    expect(await runAccountSync(input)).toMatchObject({ uploaded: 2 });
    expect(s.order).toEqual(['consent:2026-09-23T10:01:00.000Z', 'acceptance:terms', 'notice:first_workout', 'sync']);
  });

  it('does not retry a record the server refuses for good, and rethrows server errors', async () => {
    const refused = setup((kind) => (kind === 'notice' ? new ApiRequestError(409, 'legal.content_mismatch') : null));
    expect(await runAccountSync({ ...refused, consents: [], acceptances: [], notices: [notice] })).toEqual({ offline: false, uploaded: 0, refused: 1 });
    expect(refused.ledger.has(notice.id)).toBe(true);
    const broken = setup(() => new ApiRequestError(500, 'internal_error'));
    await expect(runAccountSync({ ...broken, consents: [consent(randomUUID(), '2026-09-23T10:01:00.000Z')], acceptances: [], notices: [] })).rejects.toMatchObject({ status: 500 });
  });
});

let mockSql: SqlJsStatic;
let mockDb: Database;
jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-GB', regionCode: 'GB' }] }));

describe('sign-in in the app (end to end against a fake API)', () => {
  const realFetch = global.fetch;
  const requests: Array<{ path: string; body: Record<string, unknown>; auth: string | null }> = [];
  beforeAll(async () => {
    mockSql = await initSqlJs();
  });
  beforeEach(() => {
    mockDb = new mockSql.Database();
    requests.length = 0;
    let n = 0;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requests.push({ path, body, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
      switch (path) {
        case '/v1/auth/otp/request':
          return json(202, { status: 'sent', expiresInSeconds: 600 });
        case '/v1/auth/otp/verify':
          return json(200, { user, isNewUser: true, tokens: tokens(++n) });
        case '/v1/privacy/consents':
          return json(201, { consent: {} });
        case '/v1/sync/push':
          return json(200, { results: (body.mutations as Array<{ mutationId: string }>).map((m, i) => ({ mutationId: m.mutationId, status: 'applied', revision: i + 1 })) });
        case '/v1/sync/pull':
          return json(200, { changes: [], cursor: 0, hasMore: false });
        default:
          return json(404, { error: { code: 'not_found' } });
      }
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('signs in with an emailed code, uploads the consent ledger before syncing, and enables export and deletion', async () => {
    const t = tr('en');
    renderRouter(appRoutes, { initialUrl: '/' });
    await screen.findByRole('header', { name: t.t('ageGate.title') });
    fireEvent.changeText(screen.getByTestId('age-gate-day'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-month'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-year'), '1990');
    fireEvent.press(screen.getByTestId('age-gate-continue'));
    await screen.findByRole('header', { name: t.t('home.title') });

    // Before sign-in: a consent decided offline, and no export or deletion.
    fireEvent.press(screen.getByTestId('open-privacy'));
    await screen.findByRole('header', { name: t.t('privacy.title') });
    expect(screen.getByTestId('privacy-export').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByRole('switch', { name: t.t('privacy.consent.health.label') }));
    act(() => jest.requireActual('expo-router').router.back());

    fireEvent.press(await screen.findByTestId('open-sign-in'));
    await screen.findByRole('header', { name: t.t('signIn.title') });
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'not-an-email');
    fireEvent.press(screen.getByTestId('sign-in-send'));
    expect(screen.getByText(t.t('signIn.invalidEmail'))).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'Fictional.User@example.test');
    fireEvent.press(screen.getByTestId('sign-in-send'));
    await screen.findByText(t.t('signIn.codeSent'));
    fireEvent.changeText(screen.getByTestId('sign-in-code'), '123456');
    fireEvent.press(screen.getByTestId('sign-in-verify'));
    await screen.findByText(t.t('signIn.done'));

    await waitFor(() => expect(requests.map((r) => r.path)).toContain('/v1/sync/pull'));
    const paths = requests.map((r) => r.path);
    expect(paths.slice(0, 2)).toEqual(['/v1/auth/otp/request', '/v1/auth/otp/verify']);
    expect(paths.indexOf('/v1/privacy/consents')).toBeLessThan(paths.indexOf('/v1/sync/push') === -1 ? Infinity : paths.indexOf('/v1/sync/push'));
    const uploaded = requests.find((r) => r.path === '/v1/privacy/consents')!;
    expect(uploaded.auth).toBe('Bearer access-1');
    expect(uploaded.body).toMatchObject({ dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' });
    expect(typeof uploaded.body.id).toBe('string');
    expect(typeof uploaded.body.recordedAt).toBe('string');
    // The code and the email never reach the device database.
    const dump = JSON.stringify(mockDb.exec('SELECT * FROM app_kv'));
    expect(dump).not.toContain('123456');
    expect(dump).not.toContain('refresh-1');
    expect(dump.toLowerCase()).not.toContain('fictional.user');
    expect(jest.requireMock('expo-secure-store').__items.get('refresh_token')).toBe('refresh-1');

    fireEvent.press(screen.getByTestId('sign-in-close'));
    await screen.findByText(t.t('home.account.signedIn'));
    fireEvent.press(screen.getByTestId('open-privacy'));
    await screen.findByRole('header', { name: t.t('privacy.title') });
    expect(screen.getByTestId('privacy-export').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('privacy-delete').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
