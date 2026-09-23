import { defineConfig } from '@fitadapt/shared';

/**
 * Privacy and security parameters of the API (CLAUDE.md rule 4). Engineering
 * defaults chosen in M17 without an external source; they await security
 * review (PE-11 with seat B1). Retention periods live in @fitadapt/privacy.
 */
const SOURCE = 'docs/adr/ADR-005-data-subject-rights.md (engineering default, no external source)';
const HEADERS = 'docs/adr/ADR-006-encryption-and-key-management.md (engineering default, no external source)';

export const privacyConfig = defineConfig({
  exportRequestsPerWindow: { value: 5, unit: 'exports per user per window', source: SOURCE, validated: false },
  deletionRequestsPerWindow: { value: 5, unit: 'attempts per user per window', source: SOURCE, validated: false },
  analyticsBatchesPerWindow: { value: 120, unit: 'batches per user per window', source: SOURCE, validated: false },
  privacyRateLimitWindowSeconds: { value: 3600, unit: 's', source: SOURCE, validated: false },
  retentionJobIntervalSeconds: { value: 3600, unit: 's', source: SOURCE, validated: false },
  // M01 (ADR-013): consents, acceptances and notices recorded offline on the device are uploaded later with their device time.
  offlineRecordMaxAgeSeconds: { value: 2_592_000, unit: 's (30 days)', source: 'docs/adr/ADR-013-mobile-sign-in-and-account-sync.md (engineering default, no external source)', validated: false },
  clientClockSkewSeconds: { value: 300, unit: 's', source: 'docs/adr/ADR-013-mobile-sign-in-and-account-sync.md (engineering default, no external source)', validated: false },
  hstsMaxAgeSeconds: { value: 31_536_000, unit: 's (365 days)', source: HEADERS, validated: false },
});

export type PrivacyConfigKey = keyof typeof privacyConfig;

export function privacyValue(key: PrivacyConfigKey): number {
  return privacyConfig[key].value;
}
