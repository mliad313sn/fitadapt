import { randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { installErrorReporter } from '../src/observability';
import { PhotoBackup, WrongRecoveryCodeError, type PhotoBackupApi } from '../src/progress/photo-backup';
import { openEnvelope } from '../src/progress/photo-crypto';
import { PhotoKeyErasurePendingError, PhotoVault, STAGED_PHOTO_KEY_NAME, type PhotoFiles } from '../src/progress/photo-vault';
import { PhotoKeyErasureError, reportPhotoErasure } from '../src/progress/ProgressProvider';
import { DEVICE_KEY_NAMES, eraseKey, MemoryDeviceKeyStore, secureDeviceKeyStore } from '../src/storage/device-keys';

/**
 * Fix wave, mobile review (scratchpad mobtests/backup.test.ts): the photo key
 * on a second phone (MOB-02), atomic key adoption (MOB-03) and confirmed
 * crypto-erasure (MOB-14), at the vault and backup level.
 */
const rand = (n: number) => new Uint8Array(randomBytes(n));
const img = (seed: number) => new Uint8Array([0xff, 0xd8, seed, ...rand(64)]);

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

/** In-memory photo files; `failWrite` makes the n-th next write throw (full storage, app killed mid-write). */
function memFiles() {
  const m = new Map<string, Uint8Array>();
  const ctl = { failWriteAt: 0, writes: 0 };
  const files: PhotoFiles = {
    write: (n, b) => {
      ctl.writes += 1;
      if (ctl.failWriteAt > 0 && ctl.writes === ctl.failWriteAt) throw new Error('ENOSPC: no space left on device');
      m.set(n, b);
    },
    read: (n) => {
      const b = m.get(n);
      if (!b) throw new Error('no such file');
      return b;
    },
    remove: (n) => void m.delete(n),
    list: () => [...m.keys()],
  };
  return { m, files, ctl };
}

function memApi(): PhotoBackupApi & { putKeys: number } {
  let key: Awaited<ReturnType<PhotoBackupApi['getKey']>> = null;
  const photos = new Map<string, Uint8Array>();
  const api = {
    putKeys: 0,
    putKey: async (k: NonNullable<typeof key>) => {
      api.putKeys += 1;
      key = k;
    },
    getKey: async () => key,
    putPhoto: async (id: string, env: Uint8Array) => void photos.set(id, env),
    listPhotos: async () => [...photos.entries()].map(([photoId, env]) => ({ photoId, storedAt: '2026-09-24T10:00:00.000Z', byteLength: env.length })),
    getPhoto: async (id: string) => photos.get(id)!,
    removeAll: async () => {
      key = null;
      photos.clear();
    },
  };
  return api;
}

function device(api: PhotoBackupApi, shared?: { keys: MemoryDeviceKeyStore; files: ReturnType<typeof memFiles>; db: ReturnType<typeof drizzle> }) {
  const db = shared?.db ?? drizzle(new SQL.Database());
  const files = shared?.files ?? memFiles();
  const keys = shared?.keys ?? new MemoryDeviceKeyStore();
  const vault = new PhotoVault({ db, files: files.files, keys, randomBytes: rand, newId: randomUUID, now: () => new Date('2026-09-24T10:00:00.000Z') });
  return { db, vault, files, keys, backup: new PhotoBackup({ vault, api, randomBytes: rand, now: () => new Date('2026-09-24T10:00:00.000Z') }) };
}

const readable = (vault: PhotoVault, id: string) => {
  try {
    vault.image(id);
    return true;
  } catch {
    return false;
  }
};

describe('MOB-02: a second phone never orphans the existing backup', () => {
  it('reviewer scenario: enabling with a new code on phone B is refused, the old code still restores; with the old code B joins and a restore never throws', async () => {
    const api = memApi();
    const a = device(api);
    a.vault.add({ image: img(1), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' });
    const codeA = a.backup.newRecoveryCode();
    await expect(a.backup.enable(codeA)).resolves.toEqual({ joinedExisting: false, restored: 0, unreadable: 0 });
    expect(await a.backup.run()).toBe(1);

    const b = device(api);
    const photoB = b.vault.add({ image: img(2), mimeType: 'image/jpeg', pose: 'side', takenOn: '2026-09-20' });
    // "Turn on backup" with a fresh code: refused, the wrapped key on the service is untouched.
    await expect(b.backup.enable(b.backup.newRecoveryCode())).rejects.toBeInstanceOf(WrongRecoveryCodeError);
    expect(api.putKeys).toBe(1);
    expect(readable(b.vault, photoB.id)).toBe(true);
    await expect(device(api).backup.restoreWithReport(codeA)).resolves.toEqual({ restored: 1, unreadable: 0 });

    // With the existing code B joins: its photo goes up under the backup's key.
    await expect(b.backup.enable(codeA)).resolves.toEqual({ joinedExisting: true, restored: 1, unreadable: 0 });
    expect(await b.backup.run()).toBe(1);
    expect(api.putKeys).toBe(1);
    const c = device(api);
    await expect(c.backup.restoreWithReport(codeA)).resolves.toEqual({ restored: 2, unreadable: 0 });
    for (const meta of c.vault.list()) expect(readable(c.vault, meta.id)).toBe(true);
  });
});

describe('MOB-03: adopting a key is atomic', () => {
  it('reviewer scenario: a damaged local file is skipped; every other photo stays readable and a retry works', async () => {
    const api = memApi();
    const a = device(api);
    a.vault.add({ image: img(1), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' });
    const code = a.backup.newRecoveryCode();
    await a.backup.enable(code);
    await a.backup.run();

    const b = device(api);
    const image1 = img(2);
    const p1 = b.vault.add({ image: image1, mimeType: 'image/jpeg', pose: 'side', takenOn: '2026-09-02' });
    const p2 = b.vault.add({ image: img(3), mimeType: 'image/jpeg', pose: 'back', takenOn: '2026-09-03' });
    b.files.m.set(`${p2.id}.bin`, new Uint8Array([1, 0, 0]));
    await expect(b.backup.restoreWithReport(code)).resolves.toEqual({ restored: 1, unreadable: 1 });
    expect(Buffer.from(b.vault.image(p1.id))).toEqual(Buffer.from(image1));
    // Idempotent: the key is already in force, nothing is re-encrypted, nothing breaks.
    await expect(b.backup.restoreWithReport(code)).resolves.toEqual({ restored: 0, unreadable: 0 });
    expect(readable(b.vault, p1.id)).toBe(true);
  });

  it('a storage failure while re-encrypting leaves every photo readable under the key still in the keystore', () => {
    const d = device(memApi());
    const ids = [1, 2, 3].map((n) => d.vault.add({ image: img(n), mimeType: 'image/jpeg', pose: 'front', takenOn: `2026-09-0${n}` }).id);
    const before = d.keys.get(DEVICE_KEY_NAMES.photos);
    d.files.ctl.failWriteAt = d.files.ctl.writes + 2; // the second staged file
    expect(() => d.vault.adoptKey(rand(32))).toThrow(/ENOSPC/);
    expect(d.keys.get(DEVICE_KEY_NAMES.photos)).toBe(before);
    expect(d.keys.get(STAGED_PHOTO_KEY_NAME)).toBeNull();
    expect([...d.files.m.keys()].filter((n) => n.endsWith('.new'))).toEqual([]);
    for (const id of ids) expect(readable(d.vault, id)).toBe(true);
  });

  it('an interruption after the commit point (during the swap) is finished when the vault next opens', () => {
    const d = device(memApi());
    const ids = [1, 2, 3].map((n) => d.vault.add({ image: img(n), mimeType: 'image/jpeg', pose: 'front', takenOn: `2026-09-0${n}` }).id);
    const newKey = rand(32);
    // Staged files: 3 writes; the swap's second file write fails (the app is killed there).
    d.files.ctl.failWriteAt = d.files.ctl.writes + 3 + 2;
    expect(() => d.vault.adoptKey(newKey)).toThrow(/ENOSPC/);
    d.files.ctl.failWriteAt = 0;
    // In the same run the next read finishes the swap first: every photo opens.
    for (const id of ids) expect(readable(d.vault, id)).toBe(true);
    expect(d.keys.get(DEVICE_KEY_NAMES.photos)).toBe(Buffer.from(newKey).toString('hex'));
    // Next start: the same keystore, files and database.
    const again = device(memApi(), { keys: d.keys, files: d.files, db: d.db });
    expect(again.keys.get(DEVICE_KEY_NAMES.photos)).toBe(Buffer.from(newKey).toString('hex'));
    expect(again.keys.get(STAGED_PHOTO_KEY_NAME)).toBeNull();
    expect([...again.files.m.keys()].filter((n) => n.endsWith('.new'))).toEqual([]);
    for (const id of ids) {
      expect(readable(again.vault, id)).toBe(true);
      expect(() => openEnvelope(newKey, again.vault.envelope(id), id)).not.toThrow();
      expect(again.vault.get(id)?.byteLength).toBe(again.vault.envelope(id).length);
    }
  });

  it('staged files without a committed key are leftovers: deleted at start, photos untouched', () => {
    const d = device(memApi());
    const id = d.vault.add({ image: img(1), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' }).id;
    d.files.m.set(`${id}.bin.new`, new Uint8Array([9, 9, 9]));
    const again = device(memApi(), { keys: d.keys, files: d.files, db: d.db });
    expect(again.files.m.has(`${id}.bin.new`)).toBe(false);
    expect(readable(again.vault, id)).toBe(true);
  });
});

describe('MOB-14: crypto-erasure of the photo key is awaited and reported', () => {
  afterEach(() => installErrorReporter(null));

  it('wipe resolves once the key is deleted; photos cannot be sealed or opened while it is pending', async () => {
    const d = device(memApi());
    d.vault.add({ image: img(1), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' });
    const erasure = d.vault.wipe();
    expect(d.vault.list()).toEqual([]);
    expect(d.files.m.size).toBe(0);
    expect(() => d.vault.add({ image: img(2), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-02' })).toThrow(PhotoKeyErasurePendingError);
    await expect(erasure).resolves.toEqual({ keyErased: true });
    expect(d.keys.get(DEVICE_KEY_NAMES.photos)).toBeNull();
    // Afterwards a new key is made for new photos.
    const fresh = d.vault.add({ image: img(3), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-03' });
    expect(readable(d.vault, fresh.id)).toBe(true);
  });

  it('a keystore that refuses the deletion is reported (no data), never an unhandled rejection', async () => {
    const reported: unknown[] = [];
    installErrorReporter((error) => reported.push(error));
    const d = device(memApi());
    d.vault.add({ image: img(1), mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' });
    d.keys.failRemovals = new Error('keystore busy');
    await expect(reportPhotoErasure(d.vault.wipe())).resolves.toBe(false);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(PhotoKeyErasureError);
    expect(d.files.m.size).toBe(0);
  });

  it('the OS keystore deletion is awaited (expo-secure-store deleteItemAsync), and its failure is seen', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as { __items: Map<string, string>; __setDeleteFailure: (e: Error | null) => void };
    SecureStore.__items.set('k', 'v');
    SecureStore.__setDeleteFailure(new Error('keychain error'));
    await expect(eraseKey(secureDeviceKeyStore, 'k')).resolves.toBe(false);
    SecureStore.__setDeleteFailure(null);
    await expect(eraseKey(secureDeviceKeyStore, 'k')).resolves.toBe(true);
    expect(SecureStore.__items.has('k')).toBe(false);
  });
});
