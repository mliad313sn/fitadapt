import { intensityLockStatus } from '@fitadapt/safety';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import { randomBytes, randomUUID } from 'node:crypto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { UploadLedger } from '../src/account/account-sync';
import { createAppServices, type AppServices } from '../src/app-services';
import { MemoryVault } from '../src/auth/vault';
import type { PhotoFiles } from '../src/progress/photo-vault';
import { DEVICE_KEY_NAMES, MemoryDeviceKeyStore } from '../src/storage/device-keys';

/**
 * MOB-01 (scratchpad mobtests/wipe.test.ts): after an account wipe, the
 * in-memory stores built from the device database are reset too, so the
 * next ordinary actions never write the deleted health or pair data back.
 * The whole app's services over one database, as AppRoot mounts them.
 */
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const NOW = new Date('2026-09-24T10:00:00.000Z');

function memFiles(): PhotoFiles & { m: Map<string, Uint8Array> } {
  const m = new Map<string, Uint8Array>();
  return { m, write: (n, b) => void m.set(n, b), read: (n) => m.get(n)!, remove: (n) => void m.delete(n), list: () => [...m.keys()] };
}

function services(): AppServices & { keys: MemoryDeviceKeyStore; files: ReturnType<typeof memFiles>; tokens: MemoryVault } {
  const keys = new MemoryDeviceKeyStore();
  const files = memFiles();
  const tokens = new MemoryVault();
  const app = createAppServices({
    db: drizzle(new SQL.Database()),
    jurisdiction: 'FR',
    initialLocale: 'en',
    apiUrl: 'https://api.example.test',
    randomUUID,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => NOW,
    keys,
    photoFiles: files,
    tokenVault: tokens,
    platform: 'ios',
  });
  return { ...app, keys, files, tokens };
}

const rows = (app: AppServices) => (app.db as unknown as { all<T>(q: unknown): T[] }).all<{ key: string; value: string }>(sql`SELECT key, value FROM app_kv ORDER BY key`);

describe('MOB-01: an account wipe resets every in-memory store', () => {
  it('reviewer scenario: after the wipe, one sharing change, one draft edit and one new partner write only new data', async () => {
    const app = services();
    app.ageGate.getState().submit({ year: 1990, month: 1, day: 1 }, { year: 2026, month: 9, day: 24 }, 'FR');
    // Before: a partner "Awa" with her own ledger, owner sharing, a health draft answer, body data, a photo, a session.
    const awa = app.pair.getState().addGuest('Awa', { year: 1990, month: 1, day: 1 });
    const awaLedgers = app.pair.getState().ledgers(awa.id);
    awaLedgers.consents.getState().decide('health', true, 'en');
    app.pair.getState().setOwnerName('Sam');
    app.pair.getState().recordSharing('owner', ['bodyweight']);
    app.profile.getState().updateDraft({ answers: { chest_discomfort: 'yes' } });
    app.profile.getState().reportNewCondition();
    app.progress.getState().logBodyMetric('weight', 83.4, '2026-09-24');
    app.progress.getState().setPhotoBackupEnabled(true);
    app.consents.getState().decide('health', true, 'en');
    app.legal.getState().accept('terms', 'en');
    app.vault.add({ image: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-24' });
    await app.tokens.set('refresh-token');
    await app.session.getState().restore();
    expect(app.session.getState().status).toBe('signed_in');

    await app.wipeLocalData();
    expect(rows(app).map((r) => r.key)).toEqual(['age_gate_status']);

    // Every store is back to an empty device.
    expect(app.pair.getState().guests).toEqual([]);
    expect(app.pair.getState().ownerName).toBeNull();
    expect(app.pair.getState().ownerSharing).toEqual([]);
    expect(app.profile.getState().draft.answers).toEqual({});
    expect(app.profile.getState().newConditionReportedAt).toBeNull();
    expect(app.progress.getState().bodyMetrics).toEqual([]);
    expect(app.progress.getState().photoBackupEnabled).toBe(false);
    expect(app.consents.getState().records).toEqual([]);
    expect(app.legal.getState().acceptances).toEqual([]);
    expect(app.vault.list()).toEqual([]);
    expect(app.files.m.size).toBe(0);
    expect(app.keys.get(DEVICE_KEY_NAMES.photos)).toBeNull();
    expect(app.session.getState().status).toBe('signed_out');
    expect(app.tokens.token).toBeNull();
    expect(app.ageGate.getState().status).toBe('allowed');

    // Ordinary actions afterwards, including through a partner ledger a screen still held.
    app.pair.getState().recordSharing('owner', []);
    app.profile.getState().updateDraft({ primaryGoal: 'strength' });
    const bo = app.pair.getState().addGuest('Bo', { year: 1991, month: 1, day: 1 });
    awaLedgers.consents.getState().decide('partner_sharing', true, 'en');
    app.progress.getState().setShowBodyWeight(false);

    const after = rows(app);
    const all = JSON.stringify(after);
    for (const deleted of [awa.id, 'Awa', 'Sam', 'chest_discomfort', '83.4']) expect(all).not.toContain(deleted);
    expect(after.map((r) => r.key).sort()).toEqual(
      ['age_gate_status', 'onboarding_draft', 'pair.guests', 'pair.owner.sharing', `pair.guest.${bo.id}.profile`, 'progress_show_body_weight'].sort(),
    );
    expect(JSON.parse(after.find((r) => r.key === 'pair.guests')!.value)).toEqual([bo.id]);
    expect(JSON.parse(after.find((r) => r.key === 'pair.owner.sharing')!.value)).toEqual([expect.objectContaining({ scopes: [] })]);
  });
});

describe('MOB-08 (device part): a local health-consent withdrawal never lifts the S3 intensity lock', () => {
  it('the red-flag log, and so the lock, survive the withdrawal and the forgetting of health answers on this phone', () => {
    const app = services();
    app.consents.getState().decide('health', true, 'en');
    app.profile.getState().logExecution({ kind: 'red_flag', planId: randomUUID(), symptom: 'chest_pain_pressure', at: NOW.toISOString() });
    expect(intensityLockStatus(app.profile.getState().executionLogs.map((e) => e.data)).locked).toBe(true);
    // What ProfileProvider does on a withdrawal (forgetHealthData), done here directly.
    app.consents.getState().decide('health', false, 'en');
    app.profile.getState().forgetHealthData();
    app.profile.getState().reload();
    expect(intensityLockStatus(app.profile.getState().executionLogs.map((e) => e.data)).locked).toBe(true);
  });
});

describe('MOB-07: the device data and the upload ledger belong to one account', () => {
  const people = {
    a: { id: '7d0f9a8e-1b2c-4d3e-8f4a-5b6c7d8e9f01', email: 'fictional.a@example.test' },
    b: { id: '2e4c6a8b-0d1f-4a3b-9c5d-7e9f1a3b5c02', email: 'fictional.b@example.test' },
  } as const;
  let calls: { path: string; auth: string | null; body: unknown }[];
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    calls = [];
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init: { headers?: Record<string, string>; body?: string } = {}) => {
      const path = new URL(String(input)).pathname;
      const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ path, auth: init.headers?.authorization ?? null, body });
      const json = (status: number, value: unknown) => ({ ok: status < 300, status, json: async () => value });
      if (path === '/v1/auth/otp/verify') {
        const who = body!.email === people.a.email ? 'a' : 'b';
        const user = { id: people[who].id, email: people[who].email, locale: 'en', unitSystem: 'metric', createdAt: '2026-09-01T10:00:00.000Z' };
        return json(200, { user, isNewUser: false, tokens: { tokenType: 'Bearer', accessToken: `access-${who}`, accessTokenExpiresInSeconds: 900, refreshToken: `refresh-${who}`, refreshTokenExpiresInSeconds: 2_592_000 } });
      }
      if (path === '/v1/auth/logout') return json(204, null);
      if (path.startsWith('/v1/privacy/') || path.startsWith('/v1/legal/')) return json(201, {});
      // Sync is offline in this test: nothing is pushed anywhere.
      throw new TypeError('network request failed');
    }) as unknown as typeof fetch);
  });
  afterEach(() => fetchSpy.mockRestore());

  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it('a different account never receives the previous account’s outbox or ledgers; after erasing the phone it gets its own consents', async () => {
    const app = services();
    app.consents.getState().decide('health', true, 'en');
    app.progress.getState().logBodyMetric('weight', 83.4, '2026-09-24');
    await app.session.getState().verifyCode(people.a.email, '123456');
    await settle();
    expect(app.binding.boundTo()).toBe(people.a.id);
    expect(calls.filter((c) => c.path === '/v1/privacy/consents').map((c) => c.auth)).toEqual(['Bearer access-a']);

    // A's session ends on the server (the phone is signed out, the data stays); B signs in on the same phone.
    await app.session.getState().forget();
    const before = calls.length;
    await expect(app.session.getState().verifyCode(people.b.email, '123456')).rejects.toMatchObject({ name: 'OtherAccountDataError' });
    await settle();
    const duringB = calls.slice(before);
    // B's new session was ended at once; nothing of A's was sent with B's token.
    expect(duringB.map((c) => c.path)).toEqual(['/v1/auth/otp/verify', '/v1/auth/logout']);
    expect(duringB[1]!.body).toEqual({ refreshToken: 'refresh-b' });
    expect(calls.some((c) => c.auth === 'Bearer access-b')).toBe(false);
    expect(app.session.getState().status).toBe('signed_out');
    expect(app.tokens.token).toBeNull();
    expect(app.binding.boundTo()).toBe(people.a.id);

    // A can still sign in on this phone.
    await app.session.getState().verifyCode(people.a.email, '123456');
    expect(app.session.getState().status).toBe('signed_in');
    await app.session.getState().forget();

    // "Delete this phone's data", then B signs in: B's own consent goes to B, nothing of A's does.
    await app.wipeLocalData();
    expect(app.binding.boundTo()).toBeNull();
    const own = app.consents.getState().decide('health', true, 'en');
    const mark = calls.length;
    await app.session.getState().verifyCode(people.b.email, '123456');
    await settle();
    expect(app.binding.boundTo()).toBe(people.b.id);
    const toB = calls.slice(mark).filter((c) => c.auth === 'Bearer access-b');
    // Nothing is pushed to B (the outbox left with A's data); the only record B receives is its own consent.
    expect(toB.some((c) => c.path === '/v1/sync/push')).toBe(false);
    expect(toB.filter((c) => c.path !== '/v1/sync/pull').map((c) => [c.path, (c.body as { id?: string }).id])).toEqual([['/v1/privacy/consents', own.id]]);
    expect(app.syncClient.pendingCount()).toBe(0);
  });

  it('the upload ledger is kept per account: "uploaded" for one account is not "uploaded" for another', () => {
    const app = services();
    const kv = app.kv;
    let account: string | null = people.a.id;
    const ledger = new UploadLedger(kv, () => account);
    ledger.add('record-1');
    expect(ledger.has('record-1')).toBe(true);
    account = people.b.id;
    expect(ledger.has('record-1')).toBe(false);
  });
});

describe('integration FIX-B × FIX-D: the confirmed country of residence through the app services', () => {
  it('consents follow the residence the user confirmed; the wipe forgets it and the device locale applies again', async () => {
    const app = services();
    expect(app.legal.getState().jurisdiction).toBe('FR');
    app.legal.getState().confirmResidence('GB');
    expect(app.consents.getState().decide('health', true, 'en').jurisdiction).toBe('GB');
    await app.wipeLocalData();
    expect(app.legal.getState()).toMatchObject({ jurisdiction: 'FR', jurisdictionSource: 'device_locale' });
    expect(app.consents.getState().decide('health', true, 'en').jurisdiction).toBe('FR');
  });
});
