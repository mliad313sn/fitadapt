import { defineConfig } from '@fitadapt/shared';

/**
 * The device buffer of the defensibility log (L6, L11; mobile review MOB-11).
 * A storage parameter, not a health coefficient.
 */
export const legalLogConfig = defineConfig({
  /**
   * Events per segment of the device chain. A full segment is kept unchanged
   * and a new one starts, so each append rewrites and each start re-verifies
   * at most this many events (nothing is ever deleted).
   */
  'device.segmentMaxEvents': { value: 500, unit: 'events', source: 'Code review MOB-11 (fix wave 2026-09): engineering default bounding the per-append rewrite and start-up verification (no external source)', validated: false },
});

export const legalLogValue = (key: keyof typeof legalLogConfig) => legalLogConfig[key].value;
