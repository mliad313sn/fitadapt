import { ProgressPhotoSchema, type IsoDate, type PhotoPose, type ProgressPhoto } from '@fitadapt/shared';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { sql } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';
import { photosValue } from '../config/photos.config';
import { DEVICE_KEY_NAMES, eraseKey, fromHex, getOrCreateKey, toHex, type DeviceKeyStore } from '../storage/device-keys';
import { openEnvelope, packPhoto, sealEnvelope, toBase64, unpackPhoto } from './photo-crypto';

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
/** A photo re-encrypted under a key being adopted, before the swap (MOB-03). */
const stagedName = (id: string) => `${id}.bin.new`;
const STAGED_SUFFIX = '.bin.new';
/** The key being adopted, kept in the keystore until every staged file is in place (MOB-03). */
export const STAGED_PHOTO_KEY_NAME = `${DEVICE_KEY_NAMES.photos}_next`;

/** The photo key is being erased (consent withdrawn, account wiped): nothing is sealed or opened until that is confirmed (MOB-14). */
export class PhotoKeyErasurePendingError extends Error {
  constructor() {
    super('the photo key is being erased');
    this.name = 'PhotoKeyErasurePendingError';
  }
}

/** Outcome of adopting a key: local photos re-encrypted, and those that did not open with the old key (left as they were). */
export interface AdoptKeyOutcome {
  readonly reencrypted: number;
  readonly unreadable: number;
}

/** Outcome of an erasure: files and metadata are gone; `keyErased` is true once the keystore confirmed the key is deleted (MOB-14). */
export interface WipeOutcome {
  readonly keyErased: boolean;
}

export class PhotoVault {
  /** Set while the photo key is being deleted (MOB-14): a key read then could return the key being erased. */
  private erasing: Promise<WipeOutcome> | null = null;
  /**
   * Decrypted photos as display URIs, in memory only (MOB-05): a photo is
   * decrypted once per app run, not on every mount or return to the
   * foreground. Bounded by `display.cacheMaxBytes` (least recently shown
   * out); emptied when a photo is deleted, the key changes or the vault is wiped.
   */
  private readonly displayCache = new Map<string, { uri: string; bytes: number }>();
  private displayCacheBytes = 0;

  constructor(private readonly deps: PhotoVaultDeps) {
    deps.db.run(sql`CREATE TABLE IF NOT EXISTS progress_photo (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.finishPendingAdoption();
  }

  private key(): Uint8Array {
    if (this.erasing) throw new PhotoKeyErasurePendingError();
    // A committed adoption whose swap failed earlier in this run is finished before any photo is sealed or opened.
    if (this.deps.keys.get(STAGED_PHOTO_KEY_NAME) !== null) this.finishPendingAdoption();
    return fromHex(getOrCreateKey(this.deps.keys, DEVICE_KEY_NAMES.photos, this.deps.randomBytes).hex);
  }

  private forgetDisplay(id?: string) {
    if (id === undefined) {
      this.displayCache.clear();
      this.displayCacheBytes = 0;
      return;
    }
    const hit = this.displayCache.get(id);
    if (!hit) return;
    this.displayCache.delete(id);
    this.displayCacheBytes -= hit.bytes;
  }

  /**
   * Finishes a key adoption interrupted after its key was staged (app killed,
   * storage error during the swap): every staged file is moved into place,
   * then the staged key becomes the photo key. Without a staged key, leftover
   * staged files come from an adoption that never committed: they are
   * deleted, and the photos are still under the key in the keystore.
   */
  private finishPendingAdoption() {
    const staged = this.deps.keys.get(STAGED_PHOTO_KEY_NAME);
    const leftovers = new Set(this.deps.files.list().filter((n) => n.endsWith(STAGED_SUFFIX)));
    if (staged !== null) {
      for (const meta of this.list()) {
        if (!leftovers.has(stagedName(meta.id))) continue;
        const envelope = this.deps.files.read(stagedName(meta.id));
        this.deps.files.write(fileName(meta.id), envelope);
        this.deps.files.remove(stagedName(meta.id));
        leftovers.delete(stagedName(meta.id));
        this.put({ ...meta, byteLength: envelope.length, backedUpAt: null });
      }
      this.deps.keys.set(DEVICE_KEY_NAMES.photos, staged);
      // The staged copy of the key is now the photo key itself: its removal needs no confirmation.
      void Promise.resolve(this.deps.keys.remove(STAGED_PHOTO_KEY_NAME)).catch(() => undefined);
      this.forgetDisplay();
    }
    for (const name of leftovers) this.deps.files.remove(name);
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

  /**
   * The photo as a `data:` URI for `<Image>`: decrypted once, then served
   * from the in-memory display cache (MOB-05). Never written anywhere.
   */
  displayUri(id: string, mimeType: string): string {
    const hit = this.displayCache.get(id);
    if (hit) {
      // Most recently shown last.
      this.displayCache.delete(id);
      this.displayCache.set(id, hit);
      return hit.uri;
    }
    const image = this.image(id);
    const uri = `data:${mimeType};base64,${toBase64(image)}`;
    const limit = photosValue('display.cacheMaxBytes');
    if (image.length <= limit) {
      this.displayCache.set(id, { uri, bytes: image.length });
      this.displayCacheBytes += image.length;
      for (const [oldest, entry] of this.displayCache) {
        if (this.displayCacheBytes <= limit) break;
        this.displayCache.delete(oldest);
        this.displayCacheBytes -= entry.bytes;
      }
    }
    return uri;
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
    this.forgetDisplay(id);
    this.deps.files.remove(fileName(id));
    this.deps.db.run(sql`DELETE FROM progress_photo WHERE id = ${id}`);
  }

  /** The photo key, for wrapping it into the backup (never shown, never logged). */
  exportKey(): Uint8Array {
    return this.key();
  }

  /**
   * Makes `key` the photo key (restore from a backup, or joining an existing
   * backup on another device). Photos already on this device are
   * re-encrypted under it atomically (MOB-03):
   * 1. every readable photo is re-encrypted into a staged file (`<id>.bin.new`);
   *    a failure here deletes the staged files and leaves everything as it was;
   * 2. the new key is stored under a staging name (the commit point);
   * 3. the staged files replace the originals, then the new key replaces the old.
   * An interruption after step 2 is finished the next time the vault opens.
   * A photo that does not open with the current key (damaged file) is left
   * as it was and counted as unreadable; it never blocks the others.
   */
  adoptKey(key: Uint8Array): AdoptKeyOutcome {
    const hex = toHex(key);
    const current = this.deps.keys.get(DEVICE_KEY_NAMES.photos);
    if (current === hex) return { reencrypted: 0, unreadable: 0 };
    if (current === null) {
      this.deps.keys.set(DEVICE_KEY_NAMES.photos, hex);
      this.forgetDisplay();
      return { reencrypted: 0, unreadable: 0 };
    }
    const old = this.key();
    const staged: string[] = [];
    let unreadable = 0;
    try {
      for (const meta of this.list()) {
        let image: Uint8Array;
        try {
          image = unpackPhoto(openEnvelope(old, this.deps.files.read(fileName(meta.id)), meta.id)).image;
        } catch {
          unreadable += 1;
          continue;
        }
        this.deps.files.write(stagedName(meta.id), this.seal(key, meta, image));
        staged.push(meta.id);
      }
    } catch (error) {
      for (const id of staged) this.deps.files.remove(stagedName(id));
      throw error;
    }
    this.deps.keys.set(STAGED_PHOTO_KEY_NAME, hex);
    // Committed: an interruption from here on is finished at the next start.
    this.finishPendingAdoption();
    return { reencrypted: staged.length, unreadable };
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

  /**
   * Consent withdrawn or account wiped: every photo file and its metadata are
   * deleted at once, then the photo key and any staged key. Resolves when the
   * keystore has confirmed the deletion (MOB-14); `keyErased: false` means
   * the files are gone but crypto-erasure was not confirmed (the caller
   * reports it). No photo is sealed or opened meanwhile.
   */
  wipe(): Promise<WipeOutcome> {
    if (this.erasing) return this.erasing;
    this.forgetDisplay();
    for (const meta of this.list()) this.deps.files.remove(fileName(meta.id));
    for (const name of this.deps.files.list()) this.deps.files.remove(name);
    this.deps.db.run(sql`DELETE FROM progress_photo`);
    const erasing = Promise.all([eraseKey(this.deps.keys, DEVICE_KEY_NAMES.photos), eraseKey(this.deps.keys, STAGED_PHOTO_KEY_NAME)])
      .then(([photoKey, stagedKey]) => ({ keyErased: photoKey && stagedKey }))
      .finally(() => {
        this.erasing = null;
      });
    this.erasing = erasing;
    return erasing;
  }
}
