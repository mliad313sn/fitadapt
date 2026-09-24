import { randomBytes, randomUUID } from 'node:crypto';
import type { BodyMetric, Measurement, WrappedPhotoKey } from '@fitadapt/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { photoBackupKeys, photoBackups, syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M04 on the server:
 * - body weight, body-fat estimates and circumferences are health data: they
 *   need the health consent, are schema-checked, and are erased when it is
 *   withdrawn (as every other health collection);
 * - the progress-photo backup stores only ciphertext (ADR-020), needs the
 *   photos consent, refuses anything not framed as an envelope (a plain JPEG
 *   or PNG is refused), and is erased when the backup is turned off, when the
 *   photos consent is withdrawn and with the account.
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
  return { token: auth.tokens.accessToken, userId: auth.user.id, deviceId: dev.id };
}
type Session = Awaited<ReturnType<typeof session>>;

const insert = (collection: string, data: unknown, recordId: string = randomUUID()) => ({ mutationId: randomUUID(), collection, recordId, op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() });
async function push(s: Session, mutations: ReturnType<typeof insert>[]) {
  const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { results: { status: string; reason?: string }[] }).results.map((r) => (r.status === 'rejected' ? r.reason : r.status));
}
const consent = (s: Session, dataType: 'health' | 'photos', decision: 'granted' | 'withdrawn') =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType, decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });

const weight = (value: number, measuredOn = '2026-09-20'): BodyMetric => ({ schemaVersion: 1, kind: 'weight', value, measuredOn, at: `${measuredOn}T06:30:00.000Z`, correctionOf: null });
const waist = (valueCm: number): Measurement => ({ schemaVersion: 1, site: 'waist', valueCm, measuredOn: '2026-09-20', at: '2026-09-20T06:35:00.000Z', correctionOf: null });

describe('body metrics and measurements are health data', () => {
  it('need the health consent, are schema-checked, and are erased when the consent is withdrawn', async () => {
    const s = await session();
    expect(await push(s, [insert('body_metrics', weight(61.2)), insert('measurements', waist(76))])).toEqual(['privacy.consent_required', 'privacy.consent_required']);
    expect((await consent(s, 'health', 'granted')).statusCode).toBe(201);
    expect(await push(s, [insert('body_metrics', weight(61.2)), insert('measurements', waist(76)), insert('body_metrics', { ...weight(61.2), value: -3 }), insert('measurements', { ...waist(76), site: 'neckline' })])).toEqual([
      'applied',
      'applied',
      'body_metrics.invalid',
      'measurements.invalid',
    ]);
    const stored = await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(stored.map((r) => r.collection).sort()).toEqual(['body_metrics', 'measurements']);

    expect((await consent(s, 'health', 'withdrawn')).statusCode).toBe(201);
    const after = await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(after).toEqual([]);
  });
});

const wrappedKey = (): WrappedPhotoKey => ({ schemaVersion: 1, kdf: { name: 'scrypt', logN: 15, r: 8, p: 1 }, salt: randomBytes(16).toString('base64'), wrappedKey: Buffer.concat([Buffer.from([1]), randomBytes(12 + 32 + 16)]).toString('base64') });
/** An envelope as the device makes it: version 1, nonce, ciphertext, tag (opaque bytes to the service). */
const envelope = (bytes = 2048) => Buffer.concat([Buffer.from([1]), randomBytes(bytes)]);

const api = (s: Session) => ({
  putKey: (key: unknown) => h.app.inject({ method: 'PUT', url: '/v1/photos/backup/key', headers: bearer(s.token), payload: key as object }),
  getKey: () => h.app.inject({ method: 'GET', url: '/v1/photos/backup/key', headers: bearer(s.token) }),
  putPhoto: (id: string, body: Buffer) => h.app.inject({ method: 'PUT', url: `/v1/photos/backup/photos/${id}`, headers: { ...bearer(s.token), 'content-type': 'application/octet-stream' }, payload: body }),
  list: () => h.app.inject({ method: 'GET', url: '/v1/photos/backup/photos', headers: bearer(s.token) }),
  getPhoto: (id: string) => h.app.inject({ method: 'GET', url: `/v1/photos/backup/photos/${id}`, headers: bearer(s.token) }),
  removeAll: () => h.app.inject({ method: 'DELETE', url: '/v1/photos/backup', headers: bearer(s.token) }),
});

describe('end-to-end-encrypted photo backup (goal condition 4, server side)', () => {
  it('needs a session and the photos consent', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/photos/backup/photos' })).statusCode).toBe(401);
    const s = await session();
    const a = api(s);
    for (const res of [await a.putKey(wrappedKey()), await a.getKey(), await a.putPhoto(randomUUID(), envelope()), await a.list(), await a.getPhoto(randomUUID())]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: { code: 'privacy.consent_required' } });
    }
    // Deleting is always possible.
    expect((await a.removeAll()).statusCode).toBe(204);
  });

  it('stores the wrapped key and the envelopes byte for byte, and gives them back', async () => {
    const s = await session();
    await consent(s, 'photos', 'granted');
    const a = api(s);
    const id = randomUUID();
    // No key yet: a photo nobody could ever open is refused.
    expect((await a.putPhoto(id, envelope())).json()).toEqual({ error: { code: 'photos.backup_key_required' } });
    expect((await a.getKey()).json()).toEqual({ key: null });
    const key = wrappedKey();
    expect((await a.putKey(key)).statusCode).toBe(204);
    expect((await a.putKey({ ...key, kdf: { name: 'pbkdf2' } })).statusCode).toBe(400);
    expect((await a.getKey()).json()).toEqual({ key });

    const body = envelope(4096);
    const put = await a.putPhoto(id, body);
    expect(put.statusCode).toBe(201);
    expect(put.json()).toMatchObject({ photoId: id, byteLength: body.length });
    const got = await a.getPhoto(id);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('application/octet-stream');
    expect(got.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(got.rawPayload, body)).toBe(0);
    expect((await a.list()).json()).toEqual({ photos: [{ photoId: id, byteLength: body.length, storedAt: expect.any(String) }] });
    const [row] = await h.database.db.select().from(photoBackups).where(and(eq(photoBackups.userId, s.userId), eq(photoBackups.photoId, id)));
    expect(Buffer.compare(row!.envelope, body)).toBe(0);
    expect((await a.getPhoto(randomUUID())).statusCode).toBe(404);
    // Another user sees nothing of it.
    const other = await session();
    await consent(other, 'photos', 'granted');
    expect((await api(other).getPhoto(id)).statusCode).toBe(404);
    expect((await api(other).list()).json()).toEqual({ photos: [] });
  });

  it('refuses anything that is not an envelope: a plain JPEG or PNG, an empty or truncated body, an unknown version', async () => {
    const s = await session();
    await consent(s, 'photos', 'granted');
    const a = api(s);
    await a.putKey(wrappedKey());
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1000)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(1000)]);
    for (const body of [jpeg, png, Buffer.from([1, 2, 3]), Buffer.alloc(0), Buffer.concat([Buffer.from([2]), randomBytes(100)])]) {
      const res = await a.putPhoto(randomUUID(), body);
      expect(res.statusCode).toBe(400);
    }
    expect((await a.putPhoto(randomUUID(), envelope(15 * 1024 * 1024))).statusCode).toBe(413);
    expect((await a.putPhoto('not-a-uuid', envelope())).statusCode).toBe(400);
    expect((await a.list()).json()).toEqual({ photos: [] });
  });

  it('is erased when the backup is turned off, when the photos consent is withdrawn, and with the account', async () => {
    const s = await session();
    await consent(s, 'photos', 'granted');
    const a = api(s);
    const rows = async () => ({
      keys: (await h.database.db.select().from(photoBackupKeys).where(eq(photoBackupKeys.userId, s.userId))).length,
      photos: (await h.database.db.select().from(photoBackups).where(eq(photoBackups.userId, s.userId))).length,
    });
    const fill = async () => {
      await a.putKey(wrappedKey());
      await a.putPhoto(randomUUID(), envelope());
      await a.putPhoto(randomUUID(), envelope());
    };
    await fill();
    expect(await rows()).toEqual({ keys: 1, photos: 2 });
    expect((await a.removeAll()).statusCode).toBe(204);
    expect(await rows()).toEqual({ keys: 0, photos: 0 });

    await fill();
    expect((await consent(s, 'photos', 'withdrawn')).statusCode).toBe(201);
    expect(await rows()).toEqual({ keys: 0, photos: 0 });

    await consent(s, 'photos', 'granted');
    await fill();
    expect((await h.app.inject({ method: 'POST', url: '/v1/privacy/deletion', headers: bearer(s.token), payload: { confirm: 'delete-my-account' } })).statusCode).toBeLessThan(300);
    expect(await rows()).toEqual({ keys: 0, photos: 0 });
  });

  it('never logs a photo body or a key', async () => {
    const s = await session();
    await consent(s, 'photos', 'granted');
    const a = api(s);
    const key = wrappedKey();
    await a.putKey(key);
    const body = envelope(64);
    await a.putPhoto(randomUUID(), body);
    const logs = h.logs.join('\n');
    expect(logs).not.toContain(key.wrappedKey);
    expect(logs).not.toContain(key.salt);
    expect(logs).not.toContain(body.toString('base64'));
  });
});
