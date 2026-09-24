import type { WrappedPhotoKey } from '@fitadapt/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { randomBytes } from 'node:crypto';
import { AppState } from 'react-native';
import { AppProviders } from '../src/AppProviders';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { httpPhotoBackupApi, PhotoBackup, WrongRecoveryCodeError } from '../src/progress/photo-backup';
import { fromBase64, normaliseRecoveryCode, openEnvelope, recoveryCode, sealEnvelope, toBase64, unpackPhoto } from '../src/progress/photo-crypto';
import { expoPhotoFiles, PhotoVault } from '../src/progress/photo-vault';
import { PhotosScreen } from '../src/screens/PhotosScreen';
import { DEVICE_KEY_NAMES, MemoryDeviceKeyStore } from '../src/storage/device-keys';
import { tr } from './helpers';
import { closeReferenceDevices, referenceDevice, type ReferenceDevice } from './progress-seed';

/**
 * Goal condition 4: progress photos are encrypted at rest; with a network
 * spy (every fetch, XMLHttpRequest and WebSocket is recorded), nothing is
 * uploaded while the backup is off; turning the backup on uploads only
 * ciphertext. The photo metadata sits in the encrypted database (the
 * reference device runs on the SQLCipher stand-in), the images in files
 * sealed with AES-256-GCM under a keystore key.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system') as { __files: Map<string, Uint8Array> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImagePicker = require('expo-image-picker') as { __queue: { uri: string; mimeType?: string }[] };

const rand = (n: number) => new Uint8Array(randomBytes(n));
const CANARY = 'PHOTO-CANARY-front-view-2026';

/** A fictional JPEG-like image: the JPEG header, a recognisable canary and noise. */
function fakeJpeg(): Uint8Array {
  const text = new TextEncoder().encode(`JFIF ${CANARY} `.repeat(20));
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...text, ...rand(2000), 0xff, 0xd9]);
}
const includes = (hay: Uint8Array, needle: Uint8Array | string) => Buffer.from(hay).includes(typeof needle === 'string' ? Buffer.from(needle) : Buffer.from(needle));

/** The picker leaves its copy in the app cache; the app reads it and deletes it. */
function queuePicked(image: Uint8Array) {
  // The expo-file-system stand-in's URIs are `file://<dir>/…` (jest.setup.js).
  const uri = `file://cache/ImagePicker/${randomBytes(4).toString('hex')}.jpg`;
  FileSystem.__files.set(uri, image);
  ImagePicker.__queue.push({ uri, mimeType: 'image/jpeg' });
  return uri;
}

/** An in-memory backup service reached only through `fetch` (the spied network). */
function fakeBackupServer() {
  const photos = new Map<string, Uint8Array>();
  let key: WrappedPhotoKey | null = null;
  const requests: { method: string; url: string; body: unknown }[] = [];
  const res = (status: number, body?: unknown) => ({
    ok: status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => (body as Uint8Array).slice().buffer,
  });
  const handler = async (input: unknown, init: { method?: string; body?: unknown } = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    requests.push({ method, url, body: init.body });
    const path = url.replace('https://api.example.test/v1/photos/backup', '');
    if (method === 'PUT' && path === '/key') {
      key = JSON.parse(String(init.body)) as WrappedPhotoKey;
      return res(204);
    }
    if (method === 'GET' && path === '/key') return res(200, { key });
    if (method === 'GET' && path === '/photos') return res(200, { photos: [...photos.keys()].map((photoId) => ({ photoId, byteLength: photos.get(photoId)!.length, storedAt: '2026-09-24T12:00:00.000Z' })) });
    const m = /^\/photos\/(.+)$/.exec(path);
    if (m && method === 'PUT') {
      photos.set(decodeURIComponent(m[1]!), new Uint8Array(init.body as Uint8Array));
      return res(201, {});
    }
    if (m && method === 'GET') return photos.has(m[1]!) ? res(200, photos.get(m[1]!)) : res(404, {});
    if (method === 'DELETE' && path === '') {
      photos.clear();
      key = null;
      return res(204);
    }
    return res(404, {});
  };
  return { photos, requests, handler, key: () => key };
}

let fetchSpy: jest.SpyInstance;
/** Every XMLHttpRequest or WebSocket the code under test would open (the jest environment has neither: recording stand-ins). */
const otherTransports: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;
const saved = { XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket };
let server: ReturnType<typeof fakeBackupServer>;
beforeEach(() => {
  FileSystem.__files.clear();
  ImagePicker.__queue.length = 0;
  server = fakeBackupServer();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(server.handler as unknown as typeof fetch);
  otherTransports.length = 0;
  g.XMLHttpRequest = class {
    open(method: string, url: string) {
      otherTransports.push(`xhr ${method} ${url}`);
    }
    send() {}
    setRequestHeader() {}
  };
  g.WebSocket = class {
    constructor(url: string) {
      otherTransports.push(`ws ${url}`);
    }
  };
});
afterEach(() => {
  fetchSpy.mockRestore();
  g.XMLHttpRequest = saved.XMLHttpRequest;
  g.WebSocket = saved.WebSocket;
  closeReferenceDevices();
});

interface PhotoDevice {
  d: ReferenceDevice;
  keys: MemoryDeviceKeyStore;
  vault: PhotoVault;
}

function photoDevice(): PhotoDevice {
  const d = referenceDevice();
  d.consents.getState().decide('photos', true, 'en');
  const keys = new MemoryDeviceKeyStore();
  let n = 0;
  const vault = new PhotoVault({ db: d.db, files: expoPhotoFiles(), keys, randomBytes: rand, newId: () => `0b8f4c3e-2d1a-4b7c-9e6f-${String(++n).padStart(12, '0')}`, now: () => new Date('2026-09-24T12:00:00.000Z') });
  return { d, keys, vault };
}

function renderPhotos({ d, vault }: PhotoDevice, { signedIn = true, locale = 'en' as 'en' | 'fr' } = {}) {
  const backupApi = signedIn ? httpPhotoBackupApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 'token' }) : undefined;
  return render(
    <AppProviders
      syncClient={d.client}
      initialLocale={locale}
      profile={d.profile}
      legal={d.legal}
      progress={{ progress: d.progress, nutrition: d.nutrition, vault, backupApi, randomBytes: rand }}
      privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}
    >
      <PhotosScreen onExit={() => undefined} />
    </AppProviders>,
  );
}

const storedFiles = () => [...FileSystem.__files.entries()].filter(([uri]) => uri.includes('/progress-photos/'));

describe('photos are encrypted at rest on the device', () => {
  it('only an AES-256-GCM envelope is stored: no JPEG header, no image bytes, and the picker copy is deleted', async () => {
    const p = photoDevice();
    renderPhotos(p);
    const image = fakeJpeg();
    const pickedUri = queuePicked(image);
    fireEvent.press(screen.getByTestId('photos-take'));
    await waitFor(() => expect(screen.getByTestId('photos-count').props.children).toBe(tr('en').t('photos.count', { count: 1 })));
    expect(FileSystem.__files.has(pickedUri)).toBe(false);
    const files = storedFiles();
    expect(files).toHaveLength(1);
    const [, stored] = files[0]!;
    expect(stored[0]).toBe(1);
    expect(Buffer.from(stored.subarray(0, 4))).not.toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(includes(stored, CANARY)).toBe(false);
    expect(includes(stored, 'JFIF')).toBe(false);
    expect(includes(stored, image.subarray(200, 232))).toBe(false);
    // Decrypted in memory for display only.
    const [meta] = p.vault.list();
    expect(Buffer.compare(Buffer.from(p.vault.image(meta!.id)), Buffer.from(image))).toBe(0);
    expect(screen.getByTestId(`photo-image-${meta!.id}`)).toBeTruthy();
    // In the app switcher or the background the photos are not drawn (no snapshot shows them).
    const change = (AppState.addEventListener as unknown as jest.Mock).mock.calls.filter(([event]) => event === 'change').at(-1)![1] as (state: string) => void;
    act(() => change('inactive'));
    expect(screen.queryByTestId(`photo-image-${meta!.id}`)).toBeNull();
    act(() => change('background'));
    expect(screen.queryByTestId(`photo-image-${meta!.id}`)).toBeNull();
    act(() => change('active'));
    expect(screen.getByTestId(`photo-image-${meta!.id}`)).toBeTruthy();
    // The metadata row is in the encrypted database, not in the file.
    expect(p.vault.get(meta!.id)).toMatchObject({ pose: 'front', mimeType: 'image/jpeg', backedUpAt: null });
    // The key is only in the keystore.
    expect(p.keys.get(DEVICE_KEY_NAMES.photos)).toMatch(/^[0-9a-f]{64}$/);
    expect(includes(stored, p.keys.get(DEVICE_KEY_NAMES.photos)!)).toBe(false);
  });

  it('an envelope opens only with its key and for its own photo id; any altered byte is refused', () => {
    const key = rand(32);
    const env = sealEnvelope(key, new TextEncoder().encode(CANARY), rand(12), 'photo-a');
    expect(new TextDecoder().decode(openEnvelope(key, env, 'photo-a'))).toBe(CANARY);
    expect(() => openEnvelope(rand(32), env, 'photo-a')).toThrow();
    expect(() => openEnvelope(key, env, 'photo-b')).toThrow();
    for (const i of [1, 13, env.length - 1]) {
      const bad = env.slice();
      bad[i] = bad[i]! ^ 1;
      expect(() => openEnvelope(key, bad, 'photo-a')).toThrow();
    }
    const v2 = env.slice();
    v2[0] = 2;
    expect(() => openEnvelope(key, v2, 'photo-a')).toThrow(/version/);
    expect(() => sealEnvelope(rand(16), new Uint8Array(1), rand(12), 'x')).toThrow();
    expect(() => sealEnvelope(key, new Uint8Array(1), rand(8), 'x')).toThrow();
    expect(() => unpackPhoto(new Uint8Array([0, 0, 0, 99, 1]))).toThrow();
    // Two seals of the same photo differ (fresh nonce each time).
    expect(Buffer.compare(Buffer.from(sealEnvelope(key, new Uint8Array(8), rand(12), 'a')), Buffer.from(sealEnvelope(key, new Uint8Array(8), rand(12), 'a')))).not.toBe(0);
  });

  it('recovery codes: 20 random Crockford characters in groups of 4; typing is forgiving; base64 matches the platform', () => {
    const code = recoveryCode(rand, 20);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(normaliseRecoveryCode(` ${code.toLowerCase().replace(/-/g, ' ')} `)).toBe(code.replace(/-/g, ''));
    expect(normaliseRecoveryCode('o0-il')).toBe('0011');
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = rand(n);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(Buffer.from(fromBase64(toBase64(bytes)))).toEqual(Buffer.from(bytes));
    }
    expect(() => fromBase64('***')).toThrow();
  });

  it('withdrawing the photos consent deletes every photo file, its metadata and the photo key', async () => {
    const p = photoDevice();
    renderPhotos(p);
    queuePicked(fakeJpeg());
    fireEvent.press(screen.getByTestId('photos-take'));
    await waitFor(() => expect(storedFiles()).toHaveLength(1));
    act(() => void p.d.consents.getState().decide('photos', false, 'en'));
    expect(storedFiles()).toEqual([]);
    expect(p.vault.list()).toEqual([]);
    expect(p.keys.get(DEVICE_KEY_NAMES.photos)).toBeNull();
    expect(await screen.findByTestId('photos-needs-consent')).toBeTruthy();
  });
});

describe('network spy: zero uploads while the backup is off', () => {
  it.each([
    ['signed in, backup off', true],
    ['signed out (no backup client at all)', false],
  ])('%s: taking, choosing, comparing and deleting photos makes no network request', async (_name, signedIn) => {
    const p = photoDevice();
    renderPhotos(p, { signedIn });
    for (const source of ['photos-take', 'photos-choose', 'photos-take'] as const) {
      queuePicked(fakeJpeg());
      fireEvent.press(screen.getByTestId(source));
      await waitFor(() => expect(screen.getByTestId('photos-message').props.children).toBe(tr('en').t('photos.added')));
    }
    await waitFor(() => expect(p.vault.list()).toHaveLength(3));
    const [a, b, c] = p.vault.list();
    fireEvent.press(screen.getByTestId(`photos-select-${a!.id}`));
    fireEvent.press(screen.getByTestId(`photos-select-${b!.id}`));
    expect(screen.getByTestId('photos-compare-left')).toBeTruthy();
    // The pose-guide overlay is drawn over both photos (hidden from screen readers: it is decoration).
    expect(screen.getByTestId('photos-guide-left', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('photos-guide-right', { includeHiddenElements: true })).toBeTruthy();
    fireEvent.press(screen.getByTestId(`photos-delete-${c!.id}`));
    expect(p.vault.list()).toHaveLength(2);
    expect(screen.getByTestId(signedIn ? 'photos-backup-off' : 'photos-backup-unavailable')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(otherTransports).toEqual([]);
    expect(server.requests).toEqual([]);
  });
});

describe('turning the backup on uploads only ciphertext (end-to-end encrypted)', () => {
  it('the key goes up wrapped by the recovery code, each photo exactly as its encrypted file; another phone restores them with the code', async () => {
    const p = photoDevice();
    renderPhotos(p);
    const images = [fakeJpeg(), fakeJpeg()];
    for (const image of images) {
      queuePicked(image);
      fireEvent.press(screen.getByTestId('photos-take'));
      await waitFor(() => expect(screen.getByTestId('photos-message').props.children).toBe(tr('en').t('photos.added')));
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('photos-backup-enable'));
    const code = String(screen.getByTestId('photos-backup-code').props.children);
    expect(screen.getByTestId('photos-backup-start').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('photos-backup-confirm'));
    fireEvent.press(screen.getByTestId('photos-backup-start'));
    await waitFor(() => expect(screen.getByTestId('photos-message').props.children).toBe(tr('en').t('photos.backup.done')), { timeout: 20_000 });
    expect(screen.getByTestId('photos-backup-status').props.children).toBe(tr('en').t('photos.backup.on', { backed: 2, total: 2 }));

    // What left the device: one wrapped key and two envelopes, all to the backup endpoints over https.
    expect(server.requests.map((r) => `${r.method} ${r.url.replace(/[0-9a-f-]{36}$/, ':id')}`)).toEqual([
      'PUT https://api.example.test/v1/photos/backup/key',
      'PUT https://api.example.test/v1/photos/backup/photos/:id',
      'PUT https://api.example.test/v1/photos/backup/photos/:id',
    ]);
    const photoKeyHex = p.keys.get(DEVICE_KEY_NAMES.photos)!;
    const photoKey = Buffer.from(photoKeyHex, 'hex');
    const keyBody = String(server.requests[0]!.body);
    for (const secret of [photoKeyHex, photoKey.toString('base64'), code, code.replace(/-/g, '')]) expect(keyBody.includes(secret)).toBe(false);
    for (const meta of p.vault.list()) {
      const uploaded = server.photos.get(meta.id)!;
      expect(Buffer.compare(Buffer.from(uploaded), Buffer.from(p.vault.envelope(meta.id)))).toBe(0);
      expect(uploaded[0]).toBe(1);
      expect(includes(uploaded, CANARY)).toBe(false);
      expect(includes(uploaded, 'JFIF')).toBe(false);
      expect(includes(uploaded, photoKey)).toBe(false);
      expect(meta.backedUpAt).not.toBeNull();
    }
    // The service cannot open an envelope; the photo key can.
    const [first] = p.vault.list();
    expect(() => openEnvelope(rand(32), server.photos.get(first!.id)!, first!.id)).toThrow();

    // A new photo with the backup on is uploaded at once, still as its envelope.
    queuePicked(fakeJpeg());
    fireEvent.press(screen.getByTestId('photos-take'));
    await waitFor(() => expect(server.photos.size).toBe(3));

    // Another phone (new keystore, empty vault): the right code restores every photo; a wrong one opens nothing.
    screen.unmount();
    const q = photoDevice();
    const restoreApi = httpPhotoBackupApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 'token' });
    const onNewPhone = new PhotoBackup({ vault: q.vault, api: restoreApi, randomBytes: rand, now: () => new Date('2026-09-25T08:00:00.000Z') });
    await expect(onNewPhone.restore('0000-0000-0000-0000-0000')).rejects.toBeInstanceOf(WrongRecoveryCodeError);
    expect(q.vault.list()).toEqual([]);
    expect(await onNewPhone.restore(code.toLowerCase())).toBe(3);
    expect(q.keys.get(DEVICE_KEY_NAMES.photos)).toBe(photoKeyHex);
    const restored = q.vault.list().map((m) => Buffer.from(q.vault.image(m.id)));
    for (const image of images) expect(restored.some((r) => Buffer.compare(r, Buffer.from(image)) === 0)).toBe(true);
  }, 60_000);

  it('turning the backup off deletes every uploaded copy and the wrapped key, and uploads stop', async () => {
    const p = photoDevice();
    const backup = new PhotoBackup({ vault: p.vault, api: httpPhotoBackupApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 'token' }), randomBytes: rand, now: () => new Date() });
    p.vault.add({ image: fakeJpeg(), mimeType: 'image/jpeg', pose: 'side', takenOn: '2026-09-24' });
    await backup.enable(backup.newRecoveryCode());
    expect(await backup.run()).toBe(1);
    expect(await backup.run()).toBe(0);
    p.d.progress.getState().setPhotoBackupEnabled(true);
    renderPhotos(p);
    fireEvent.press(screen.getByTestId('photos-backup-disable'));
    await waitFor(() => expect(screen.getByTestId('photos-message').props.children).toBe(tr('en').t('photos.backup.disabled')));
    expect(server.photos.size).toBe(0);
    expect(server.key()).toBeNull();
    expect(p.vault.list().every((m) => m.backedUpAt === null)).toBe(true);
    const before = server.requests.length;
    queuePicked(fakeJpeg());
    fireEvent.press(screen.getByTestId('photos-take'));
    await waitFor(() => expect(p.vault.list()).toHaveLength(2));
    expect(server.requests.length).toBe(before);
  }, 60_000);

  it('a restored key replaces the local one: photos already on this phone are re-encrypted under it and stay readable', () => {
    const p = photoDevice();
    const image = fakeJpeg();
    const meta = p.vault.add({ image, mimeType: 'image/jpeg', pose: 'back', takenOn: '2026-09-20' });
    const before = p.vault.envelope(meta.id);
    const newKey = rand(32);
    p.vault.adoptKey(newKey);
    expect(p.keys.get(DEVICE_KEY_NAMES.photos)).toBe(Buffer.from(newKey).toString('hex'));
    expect(Buffer.compare(Buffer.from(p.vault.envelope(meta.id)), Buffer.from(before))).not.toBe(0);
    expect(Buffer.compare(Buffer.from(p.vault.image(meta.id)), Buffer.from(image))).toBe(0);
    p.vault.adoptKey(newKey);
    expect(unpackPhoto(openEnvelope(newKey, p.vault.envelope(meta.id), meta.id)).meta).toMatchObject({ id: meta.id, pose: 'back' });
  });
});
