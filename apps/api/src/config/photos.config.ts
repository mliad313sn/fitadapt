import { defineConfig } from '@fitadapt/shared';

/**
 * Limits of the end-to-end-encrypted progress-photo backup (M04, ADR-020).
 * Engineering defaults without an external source (CLAUDE.md rule 4): they
 * bound storage and abuse, not a health value. Await security review (B1).
 */
const SOURCE = 'docs/adr/ADR-020-device-encryption-and-photo-backup.md (engineering default, no external source)';

export const photosConfig = defineConfig({
  maxEnvelopeBytes: { value: 15 * 1024 * 1024, unit: 'bytes per encrypted photo', source: SOURCE, validated: false },
  maxPhotosPerUser: { value: 500, unit: 'photos', source: SOURCE, validated: false },
});

export type PhotosConfigKey = keyof typeof photosConfig;

export function photosValue(key: PhotosConfigKey): number {
  return photosConfig[key].value;
}
