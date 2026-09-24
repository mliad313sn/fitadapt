import { ProgressPhotoSchema, type IsoDate, type PhotoPose, type ProgressPhoto } from '@fitadapt/shared';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { sql } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';
import { DEVICE_KEY_NAMES, fromHex, getOrCreateKey, toHex, type DeviceKeyStore } from '../storage/device-keys';
import { openEnvelope, packPhoto, sealEnvelope, unpackPhoto } from './photo-crypto';

/**
 * Progress photos on the device (CLAUDE.md rule 7, ADR-006, ADR-020): each
 * photo is sealed (AES-256-GCM, a fresh nonce per file) under the photo key
 * from the OS keystore before it touches storage, and written to the app's
 * private documents directory; only the encrypted file exists. The metadata
 * sits in the encrypted database (table `progress_photo`, never synced).
 * Nothing here uses the network: backup is a separate, opt-in step
 * (photo-backup.ts) that uploads these same encrypted files.
 */
export interface PhotoFiles {
  write(name: string, bytes: Uint8Array): void;
  read(name: string): Uint8Array;
  remove(name: string): void;
  list(): string[];
}

/** expo-file-system: `<documents>/progress-photos/<id>.bin` (app-private; never the shared photo library). */
export function expoPhotoFiles(): PhotoFiles {
  const dir = new Directory(Paths.document, 'progress-photos');
  const ensure = () => {
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  };
  return {
    write(name, bytes) {
      ensure();
      new File(dir, name).write(bytes);
    },
    read: (name) => new File(dir, name).bytesSync(),
    remove(name) {
      const f = new File(dir, name);
      if (f.exists) f.delete();
    },
    list: () => (dir.exists ? dir.list().flatMap((e) => (e instanceof File ? [e.name ?? e.uri.split('/').pop()!] : [])) : []),
  };
}

export interface PhotoVaultDeps {
  readonly db: SyncSqliteDatabase;
  readonly files: PhotoFiles;
  readonly keys: DeviceKeyStore;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface NewPhoto {
  readonly image: Uint8Array;
  readonly mimeType: ProgressPhoto['mimeType'];
  readonly pose: PhotoPose;
  readonly takenOn: IsoDate;
}

const fileName = (id: string) => `${id}.bin`;

export class PhotoVault {
  constructor(private readonly deps: PhotoVaultDeps) {
    deps.db.run(sql`CREATE TABLE IF NOT EXISTS progress_photo (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }

  private key(): Uint8Array {
    return fromHex(getOrCreateKey(this.deps.keys, DEVICE_KEY_NAMES.photos, this.deps.randomBytes).hex);
  }

  private seal(key: Uint8Array, meta: ProgressPhoto, image: Uint8Array): Uint8Array {
    return sealEnvelope(key, packPhoto(meta, image), this.deps.randomBytes(12), meta.id);
  }

  private put(meta: ProgressPhoto) {
    const data = JSON.stringify(ProgressPhotoSchema.parse(meta));
    this.deps.db.run(sql`INSERT INTO progress_photo (id, data) VALUES (${meta.id}, ${data}) ON CONFLICT(id) DO UPDATE SET data = excluded.data`);
  }

  list(): ProgressPhoto[] {
    const rows = this.deps.db.all<{ data: string }>(sql`SELECT data FROM progress_photo`);
    return rows
      .map((r) => ProgressPhotoSchema.safeParse(JSON.parse(r.data)))
      .flatMap((r) => (r.success ? [r.data] : []))
      .sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.at.localeCompare(b.at));
  }

  get(id: string): ProgressPhoto | null {
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** Encrypts and stores a new photo; returns its metadata. The plain image is never written. */
  add(photo: NewPhoto): ProgressPhoto {
    const id = this.deps.newId();
    const draft: ProgressPhoto = { schemaVersion: 1, id, pose: photo.pose, takenOn: photo.takenOn, at: this.deps.now().toISOString(), mimeType: photo.mimeType, byteLength: 1, backedUpAt: null };
    const envelope = this.seal(this.key(), draft, photo.image);
    const meta = { ...draft, byteLength: envelope.length };
    this.deps.files.write(fileName(id), envelope);
    this.put(meta);
    return meta;
  }

  /** Decrypts a photo for display (kept in memory only). */
  image(id: string): Uint8Array {
    const { image } = unpackPhoto(openEnvelope(this.key(), this.deps.files.read(fileName(id)), id));
    return image;
  }

  /** The encrypted file as stored (what a backup uploads). */
  envelope(id: string): Uint8Array {
    return this.deps.files.read(fileName(id));
  }

  markBackedUp(id: string, at: string | null) {
    const meta = this.get(id);
    if (meta) this.put({ ...meta, backedUpAt: at });
  }

  remove(id: string) {
    this.deps.files.remove(fileName(id));
    this.deps.db.run(sql`DELETE FROM progress_photo WHERE id = ${id}`);
  }

  /** The photo key, for wrapping it into the backup (never shown, never logged). */
  exportKey(): Uint8Array {
    return this.key();
  }

  /**
   * Makes `key` the photo key (restore from a backup on another device):
   * photos already on this device are re-encrypted under it first.
   */
  adoptKey(key: Uint8Array) {
    const current = this.deps.keys.get(DEVICE_KEY_NAMES.photos);
    if (current === toHex(key)) return;
    if (current !== null) {
      const old = this.key();
      for (const meta of this.list()) {
        const { image } = unpackPhoto(openEnvelope(old, this.deps.files.read(fileName(meta.id)), meta.id));
        const envelope = this.seal(key, meta, image);
        this.deps.files.write(fileName(meta.id), envelope);
        this.put({ ...meta, byteLength: envelope.length, backedUpAt: null });
      }
    }
    this.deps.keys.set(DEVICE_KEY_NAMES.photos, toHex(key));
  }

  /** Stores an encrypted photo from the backup after checking it opens with the photo key. */
  restore(id: string, envelope: Uint8Array, at: string): ProgressPhoto {
    const { meta } = unpackPhoto(openEnvelope(this.key(), envelope, id));
    const parsed = ProgressPhotoSchema.parse({ ...(meta as object), id, byteLength: envelope.length, backedUpAt: at });
    this.deps.files.write(fileName(id), envelope);
    this.put(parsed);
    return parsed;
  }

  /** Imports a photo from an export (unencrypted in the file): it is encrypted again, under its own id. */
  importPlain(meta: ProgressPhoto, image: Uint8Array): ProgressPhoto | null {
    if (this.get(meta.id)) return null;
    const draft = ProgressPhotoSchema.parse({ ...meta, backedUpAt: null });
    const envelope = this.seal(this.key(), draft, image);
    const stored = { ...draft, byteLength: envelope.length };
    this.deps.files.write(fileName(meta.id), envelope);
    this.put(stored);
    return stored;
  }

  /** Consent withdrawn or account wiped: every photo file, its metadata and the photo key are deleted. */
  wipe() {
    for (const meta of this.list()) this.deps.files.remove(fileName(meta.id));
    for (const name of this.deps.files.list()) this.deps.files.remove(name);
    this.deps.db.run(sql`DELETE FROM progress_photo`);
    this.deps.keys.remove(DEVICE_KEY_NAMES.photos);
  }
}
