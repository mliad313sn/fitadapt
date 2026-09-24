import { defineConfig } from '@fitadapt/shared';

/**
 * Sync endpoint limits. Engineering defaults without an external source
 * (CLAUDE.md rule 4); await security review (seat B1).
 */
const SOURCE = 'docs/status/FIX-api-security.md (API security review with FIX-E: the device keeps a push at 512 KiB or less; engineering default, no external source)';

export const syncConfig = defineConfig({
  /** Largest push request body; the device splits its outbox into pushes of at most half this size. */
  pushBodyLimitBytes: { value: 1024 * 1024, unit: 'bytes (1 MiB)', source: SOURCE, validated: false },
});

export type SyncConfigKey = keyof typeof syncConfig;

export function syncValue(key: SyncConfigKey): number {
  return syncConfig[key].value;
}
