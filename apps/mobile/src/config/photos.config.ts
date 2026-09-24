import { defineConfig } from '@fitadapt/shared';

/**
 * Progress-photo storage and backup parameters (M04, ADR-020). Security
 * parameters, not health coefficients: engineering defaults without an
 * external source, for review by PE-11 (security) with the pen-tester.
 */
export const photosConfig = defineConfig({
  /** scrypt cost of the key that wraps the photo key for the backup: N = 2^logN (memory-hard; ≈ 32 MiB at r = 8). */
  'backup.scryptLogN': { value: 15, unit: 'log2(N)', source: 'ADR-020: engineering default for a memory-hard KDF on phones (no external source)', validated: false },
  'backup.scryptR': { value: 8, unit: 'block size', source: 'ADR-020: engineering default (no external source)', validated: false },
  'backup.scryptP': { value: 1, unit: 'parallelism', source: 'ADR-020: engineering default (no external source)', validated: false },
  /** Random characters of the recovery code (Crockford base32, 5 bits each: 100 bits). */
  'backup.recoveryCodeChars': { value: 20, unit: 'characters', source: 'ADR-020: engineering default, 100 bits of randomness (no external source)', validated: false },
  /**
   * MOB-05: most decrypted photo bytes kept in memory for display, so the
   * photos screen decrypts each photo once per app run instead of on every
   * mount and every return to the foreground. About 8 photos of 3 MB; the
   * least recently shown goes first.
   */
  'display.cacheMaxBytes': { value: 25_165_824, unit: 'bytes', source: 'Code review MOB-05 (fix wave 2026-09): engineering default for the in-memory display cache, 24 MiB (no external source)', validated: false },
  /** JPEG quality asked of the picker (re-encoding keeps files small; 1 = no re-encoding). */
  'capture.quality': { value: 0.8, unit: '0–1', source: 'ADR-020: engineering default (no external source)', validated: false },
});

export const photosValue = (key: keyof typeof photosConfig) => photosConfig[key].value;
