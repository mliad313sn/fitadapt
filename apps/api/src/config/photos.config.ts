import { defineConfig } from '@fitadapt/shared';

/**
 * Limits of the end-to-end-encrypted progress-photo backup (M04, ADR-020).
 * Engineering defaults without an external source (CLAUDE.md rule 4): they
 * bound storage and abuse, not a health value. Await security review (B1).
 */
const SOURCE = 'docs/adr/ADR-020-device-encryption-and-photo-backup.md (engineering default, no external source)';
const REVIEW = 'docs/status/FIX-api-security.md (API security review; engineering default, no external source)';

export const photosConfig = defineConfig({
  maxEnvelopeBytes: { value: 15 * 1024 * 1024, unit: 'bytes per encrypted photo', source: SOURCE, validated: false },
  maxPhotosPerUser: { value: 500, unit: 'photos', source: SOURCE, validated: false },
  // API-7 (docs/status/FIX-api-security.md): storage and upload rate per account are bounded too.
  /** Total envelope bytes one account may keep in the backup (the envelope limit alone allowed 7.5 GB). */
  maxBytesPerUser: { value: 1024 * 1024 * 1024, unit: 'bytes per user (1 GiB)', source: REVIEW, validated: false },
  /** Photo uploads (new or replaced) one account may make per window. */
  uploadsPerUserPerWindow: { value: 120, unit: 'uploads per user per window', source: REVIEW, validated: false },
  uploadRateLimitWindowSeconds: { value: 3600, unit: 's', source: REVIEW, validated: false },
});

export type PhotosConfigKey = keyof typeof photosConfig;

export function photosValue(key: PhotosConfigKey): number {
  return photosConfig[key].value;
}
