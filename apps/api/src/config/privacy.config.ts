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
  hstsMaxAgeSeconds: { value: 31_536_000, unit: 's (365 days)', source: HEADERS, validated: false },
});

export type PrivacyConfigKey = keyof typeof privacyConfig;

export function privacyValue(key: PrivacyConfigKey): number {
  return privacyConfig[key].value;
}
