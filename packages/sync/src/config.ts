import { defineConfig, unvalidatedKeys } from '@fitadapt/shared';

/**
 * Sync transport limits (CLAUDE.md rule 4). Engineering values, none
 * validated; listed in docs/status/FIX-packages-tooling.md.
 */
export const syncConfig = defineConfig({
  /**
   * Byte budget of one push request (the JSON of its mutations), PKG-02. Half
   * of Fastify's default `bodyLimit` (1 MiB, 1,048,576 bytes), leaving room for
   * the request envelope; a single larger mutation is still sent alone, and a
   * request the server refuses as too large is split, then quarantined.
   */
  pushBatchMaxBytes: {
    value: 524_288,
    unit: 'bytes',
    source: "engineering choice: half of Fastify's default bodyLimit (1 MiB, Fastify server options documentation); the API should set bodyLimit explicitly to match",
    validated: false,
  },
  /**
   * Time allowed for one sync request, headers and body, PKG-07. A captive
   * portal or a half-open connection otherwise stalls sync until the app is
   * killed (React Native's fetch has no read timeout).
   */
  requestTimeoutMs: {
    value: 30_000,
    unit: 'milliseconds',
    source: 'engineering choice (no external source): long enough for a 512 KiB push on a slow mobile link, short enough to retry within a gym session',
    validated: false,
  },
});

export type SyncConfigKey = keyof typeof syncConfig;
export const syncValue = (key: SyncConfigKey): number => syncConfig[key].value;
export const SYNC_UNVALIDATED = unvalidatedKeys(syncConfig);
