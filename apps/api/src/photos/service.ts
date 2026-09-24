import { PHOTO_ENVELOPE_MIN_BYTES, PHOTO_ENVELOPE_VERSION, WrappedPhotoKeySchema, type PhotoBackupEntry, type WrappedPhotoKey } from '@fitadapt/shared';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { ApiError } from '../auth/errors.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import { photosValue } from '../config/photos.config.js';
import { lockUser, type Database } from '../db/client.js';
import { photoBackupKeys, photoBackups } from '../db/schema.js';
import type { ConsentWithdrawalHandler, PrivacyService } from '../privacy/service.js';

/**
 * M04 end-to-end-encrypted photo backup (ADR-020). The service stores what
 * the device sends and can open none of it: a wrapped photo key and opaque
 * AES-256-GCM envelopes. It needs the `photos` consent (feature
 * `photos.backup`). It checks only the envelope's framing (version byte and
 * minimum length) and the limits, never the content. Nothing about a photo
 * is logged.
 */
export const photoErrors = {
  invalidEnvelope: () => new ApiError(400, 'photos.invalid_envelope'),
  tooLarge: () => new ApiError(413, 'photos.too_large'),
  tooMany: () => new ApiError(409, 'photos.too_many'),
  notFound: () => new ApiError(404, 'photos.not_found'),
  noKey: () => new ApiError(409, 'photos.backup_key_required'),
  storageFull: () => new ApiError(409, 'photos.storage_full'),
  rateLimited: () => new ApiError(429, 'photos.rate_limited'),
};

export interface PhotoBackupServiceDeps {
  readonly db: Database;
  readonly privacy: PrivacyService;
  readonly now: () => Date;
  /** API-7: uploads per account per window (none: unlimited, tests only). */
  readonly rateLimiter?: RateLimiter;
}

export class PhotoBackupService {
  constructor(private readonly deps: PhotoBackupServiceDeps) {}

  private consent(userId: string) {
    return this.deps.privacy.requireConsent(userId, 'photos');
  }

  async putKey(userId: string, key: WrappedPhotoKey): Promise<void> {
    const data = WrappedPhotoKeySchema.parse(key);
    await this.deps.db.transaction(async (tx) => {
      // API-2: consent read under the user's lock, in the writing transaction (a withdrawal waits, then erases).
      await lockUser(tx, userId);
      await this.deps.privacy.requireConsent(userId, 'photos', tx);
      await tx
        .insert(photoBackupKeys)
        .values({ userId, data, updatedAt: this.deps.now() })
        .onConflictDoUpdate({ target: photoBackupKeys.userId, set: { data, updatedAt: this.deps.now() } });
    });
  }

  async getKey(userId: string): Promise<WrappedPhotoKey | null> {
    await this.consent(userId);
    const [row] = await this.deps.db.select({ data: photoBackupKeys.data }).from(photoBackupKeys).where(eq(photoBackupKeys.userId, userId));
    return row ? WrappedPhotoKeySchema.parse(row.data) : null;
  }

  /** Stores (or replaces) one encrypted photo. A backup key must be stored first: without it nobody could ever open the photo. */
  async putPhoto(userId: string, photoId: string, envelope: Buffer): Promise<PhotoBackupEntry> {
    if (envelope.length > photosValue('maxEnvelopeBytes')) throw photoErrors.tooLarge();
    if (envelope.length < PHOTO_ENVELOPE_MIN_BYTES || envelope[0] !== PHOTO_ENVELOPE_VERSION) throw photoErrors.invalidEnvelope();
    const allowed = await this.deps.rateLimiter?.hit('photo-upload', this.deps.privacy.subjectRef(userId), photosValue('uploadsPerUserPerWindow'), photosValue('uploadRateLimitWindowSeconds'));
    if (allowed === false) throw photoErrors.rateLimited();
    const storedAt = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      // API-2: the consent is read under the user's lock, in the writing transaction, so a withdrawal either
      // committed before (and is seen) or waits for this upload and erases it. API-12: the same lock
      // serialises a user's uploads, so the quota count below cannot be raced past.
      await lockUser(tx, userId);
      await this.deps.privacy.requireConsent(userId, 'photos', tx);
      const [key] = await tx.select({ userId: photoBackupKeys.userId }).from(photoBackupKeys).where(eq(photoBackupKeys.userId, userId));
      if (!key) throw photoErrors.noKey();
      const [existing] = await tx.select({ photoId: photoBackups.photoId }).from(photoBackups).where(and(eq(photoBackups.userId, userId), eq(photoBackups.photoId, photoId)));
      if (!existing) {
        const [n] = await tx.select({ n: count() }).from(photoBackups).where(eq(photoBackups.userId, userId));
        if ((n?.n ?? 0) >= photosValue('maxPhotosPerUser')) throw photoErrors.tooMany();
      }
      // API-7: total bytes kept, not counting the envelope this upload replaces.
      const [stored] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${photoBackups.byteLength}), 0)` })
        .from(photoBackups)
        .where(and(eq(photoBackups.userId, userId), ne(photoBackups.photoId, photoId)));
      if (Number(stored?.bytes ?? 0) + envelope.length > photosValue('maxBytesPerUser')) throw photoErrors.storageFull();
      await tx
        .insert(photoBackups)
        .values({ userId, photoId, envelope, byteLength: envelope.length, storedAt })
        .onConflictDoUpdate({ target: [photoBackups.userId, photoBackups.photoId], set: { envelope, byteLength: envelope.length, storedAt } });
      return { photoId, byteLength: envelope.length, storedAt: storedAt.toISOString() };
    });
  }

  async listPhotos(userId: string): Promise<PhotoBackupEntry[]> {
    await this.consent(userId);
    const rows = await this.deps.db
      .select({ photoId: photoBackups.photoId, byteLength: photoBackups.byteLength, storedAt: photoBackups.storedAt })
      .from(photoBackups)
      .where(eq(photoBackups.userId, userId))
      .orderBy(asc(photoBackups.storedAt), asc(photoBackups.photoId));
    return rows.map((r) => ({ photoId: r.photoId, byteLength: r.byteLength, storedAt: r.storedAt.toISOString() }));
  }

  async getPhoto(userId: string, photoId: string): Promise<Buffer> {
    await this.consent(userId);
    const [row] = await this.deps.db.select({ envelope: photoBackups.envelope }).from(photoBackups).where(and(eq(photoBackups.userId, userId), eq(photoBackups.photoId, photoId)));
    if (!row) throw photoErrors.notFound();
    return row.envelope;
  }

  /** Backup turned off: every uploaded photo and the wrapped key are deleted. Allowed without the consent (deleting is always possible). */
  async removeAll(userId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await tx.delete(photoBackups).where(eq(photoBackups.userId, userId));
      await tx.delete(photoBackupKeys).where(eq(photoBackupKeys.userId, userId));
    });
  }
}

/** Photos consent withdrawn: the backup is erased in the withdrawal transaction (ADR-004). */
export function photosWithdrawalHandler(): ConsentWithdrawalHandler {
  return async (tx, userId) => {
    await tx.delete(photoBackups).where(eq(photoBackups.userId, userId));
    await tx.delete(photoBackupKeys).where(eq(photoBackupKeys.userId, userId));
  };
}
