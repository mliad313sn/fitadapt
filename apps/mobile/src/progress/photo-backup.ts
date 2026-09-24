import { PhotoBackupEntrySchema, WrappedPhotoKeySchema, type PhotoBackupEntry, type WrappedPhotoKey } from '@fitadapt/shared';
import { z } from 'zod';
import { photosValue } from '../config/photos.config';
import { deriveWrappingKey, fromBase64, openEnvelope, recoveryCode, sealEnvelope, toBase64, WRAPPED_KEY_AAD } from './photo-crypto';
import type { PhotoVault } from './photo-vault';

/**
 * End-to-end-encrypted photo backup (ADR-006, ADR-020), off by default and
 * only with the `photos` consent (feature `photos.backup`), a signed-in
 * account and the user's explicit choice. What leaves the device:
 * - each photo's encrypted file exactly as stored on the device (the service
 *   receives ciphertext only);
 * - the photo key wrapped (AES-256-GCM) by a key derived with scrypt from a
 *   recovery code that is shown once and never leaves the device.
 * The service cannot open either. Losing the code loses the backup; the UI
 * says so before the backup is turned on.
 */
export interface PhotoBackupApi {
  putKey(key: WrappedPhotoKey): Promise<void>;
  getKey(): Promise<WrappedPhotoKey | null>;
  putPhoto(photoId: string, envelope: Uint8Array): Promise<void>;
  listPhotos(): Promise<PhotoBackupEntry[]>;
  getPhoto(photoId: string): Promise<Uint8Array>;
  /** Deletes every uploaded photo and the wrapped key. */
  removeAll(): Promise<void>;
}

export interface HttpPhotoBackupDeps {
  readonly baseUrl: string;
  readonly getAccessToken: () => string | Promise<string>;
  readonly fetch?: typeof fetch;
}

export class PhotoBackupHttpError extends Error {
  constructor(readonly status: number) {
    super(`photo backup request failed (${status})`);
    this.name = 'PhotoBackupHttpError';
  }
}

const ListSchema = z.object({ photos: z.array(PhotoBackupEntrySchema) });
const KeyResponseSchema = z.object({ key: WrappedPhotoKeySchema.nullable() });

/** HTTP client of `/v1/photos/backup/*` (apps/api): bearer auth, binary bodies, https-only base URL (apiBaseUrl). */
export function httpPhotoBackupApi({ baseUrl, getAccessToken, fetch: doFetch = (...a) => fetch(...a) }: HttpPhotoBackupDeps): PhotoBackupApi {
  const call = async (method: string, path: string, body?: Uint8Array | string, type?: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${await getAccessToken()}` };
    if (type) headers['content-type'] = type;
    const res = await doFetch(`${baseUrl}/v1/photos/backup${path}`, { method, headers, body: body as BodyInit | undefined });
    if (!res.ok) throw new PhotoBackupHttpError(res.status);
    return res;
  };
  return {
    putKey: async (key) => void (await call('PUT', '/key', JSON.stringify(WrappedPhotoKeySchema.parse(key)), 'application/json')),
    getKey: async () => KeyResponseSchema.parse(await (await call('GET', '/key')).json()).key,
    putPhoto: async (photoId, envelope) => void (await call('PUT', `/photos/${encodeURIComponent(photoId)}`, envelope, 'application/octet-stream')),
    listPhotos: async () => ListSchema.parse(await (await call('GET', '/photos')).json()).photos,
    getPhoto: async (photoId) => new Uint8Array(await (await call('GET', `/photos/${encodeURIComponent(photoId)}`)).arrayBuffer()),
    removeAll: async () => void (await call('DELETE', '')),
  };
}

export interface PhotoBackupDeps {
  readonly vault: PhotoVault;
  readonly api: PhotoBackupApi;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly now: () => Date;
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super('the recovery code does not open this backup');
    this.name = 'WrongRecoveryCodeError';
  }
}

export class PhotoBackup {
  constructor(private readonly deps: PhotoBackupDeps) {}

  /** A new recovery code (shown once to the user; never stored). */
  newRecoveryCode(): string {
    return recoveryCode(this.deps.randomBytes, photosValue('backup.recoveryCodeChars'));
  }

  /** Uploads the photo key wrapped by the recovery code (the service can never unwrap it). */
  async enable(code: string): Promise<void> {
    const params = { logN: photosValue('backup.scryptLogN'), r: photosValue('backup.scryptR'), p: photosValue('backup.scryptP') };
    const salt = this.deps.randomBytes(16);
    const kek = deriveWrappingKey(code, salt, params);
    const wrapped = sealEnvelope(kek, this.deps.vault.exportKey(), this.deps.randomBytes(12), WRAPPED_KEY_AAD);
    await this.deps.api.putKey({ schemaVersion: 1, kdf: { name: 'scrypt', ...params }, salt: toBase64(salt), wrappedKey: toBase64(wrapped) });
  }

  /** Uploads the encrypted files of photos not yet backed up. Returns how many were sent. */
  async run(): Promise<number> {
    let sent = 0;
    for (const meta of this.deps.vault.list()) {
      if (meta.backedUpAt !== null) continue;
      await this.deps.api.putPhoto(meta.id, this.deps.vault.envelope(meta.id));
      this.deps.vault.markBackedUp(meta.id, this.deps.now().toISOString());
      sent += 1;
    }
    return sent;
  }

  /** Turns the backup off: every uploaded copy and the wrapped key are deleted from the service. */
  async disable(): Promise<void> {
    await this.deps.api.removeAll();
    for (const meta of this.deps.vault.list()) this.deps.vault.markBackedUp(meta.id, null);
  }

  /** On a new device: unwraps the photo key with the recovery code and restores the photos. */
  async restore(code: string): Promise<number> {
    const wrapped = await this.deps.api.getKey();
    if (!wrapped) return 0;
    let key: Uint8Array;
    try {
      const kek = deriveWrappingKey(code, fromBase64(wrapped.salt), wrapped.kdf);
      key = openEnvelope(kek, fromBase64(wrapped.wrappedKey), WRAPPED_KEY_AAD);
    } catch {
      throw new WrongRecoveryCodeError();
    }
    this.deps.vault.adoptKey(key);
    const known = new Set(this.deps.vault.list().map((p) => p.id));
    let restored = 0;
    for (const entry of await this.deps.api.listPhotos()) {
      if (known.has(entry.photoId)) continue;
      this.deps.vault.restore(entry.photoId, await this.deps.api.getPhoto(entry.photoId), entry.storedAt);
      restored += 1;
    }
    return restored;
  }
}
