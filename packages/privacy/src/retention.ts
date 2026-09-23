import { defineConfig, unvalidatedKeys } from '@fitadapt/shared';

/**
 * Retention schedule (docs/compliance/retention-schedule.md). Every period is a
 * config value with a source and a validation status (CLAUDE.md rule 4). None
 * is validated: the schedule needs review by privacy counsel (seat B1) and, for
 * the defensibility file (L11), consumer and product-liability counsel (B2).
 */
const SPEC = 'docs/specs/M17-privacy-security-compliance.md, Rules ("Deletion completes within 30 days, including backups on their rotation schedule")';
const ENGINEERING = 'engineering default, no external source; docs/compliance/retention-schedule.md';

export const retentionConfig = defineConfig({
  /** Upper bound for a deletion request, backups included. A requirement of the spec. */
  deletionCompletionMaxDays: { value: 30, unit: 'days', source: SPEC, validated: false },
  /** Encrypted database backups are rotated out after this many days. Must not exceed deletionCompletionMaxDays. */
  backupRetentionDays: { value: 30, unit: 'days', source: SPEC, validated: false },
  /** Used or expired one-time sign-in codes (keyed hashes only) are purged after this many days. */
  otpCodeRetentionDays: { value: 1, unit: 'days', source: ENGINEERING, validated: false },
  /** Revoked or expired sign-in sessions and their refresh-token hashes. */
  endedSessionRetentionDays: { value: 90, unit: 'days', source: ENGINEERING, validated: false },
  /** Pseudonymous audit entries (consent history, data requests) kept for the defensibility file (L11). */
  auditEntryRetentionDays: { value: 2190, unit: 'days (6 years)', source: ENGINEERING, validated: false },
  /** Completed data-request records (pseudonymous). */
  dataRequestRetentionDays: { value: 2190, unit: 'days (6 years)', source: ENGINEERING, validated: false },
  /** Accounts with no sign-in and no sync for this long are flagged for deletion after notice. */
  inactiveAccountDays: { value: 1095, unit: 'days (3 years)', source: ENGINEERING, validated: false },
  /** Application logs (which carry no personal data by design). */
  applicationLogRetentionDays: { value: 30, unit: 'days', source: ENGINEERING, validated: false },
});

export type RetentionKey = keyof typeof retentionConfig;

export function retentionDays(key: RetentionKey): number {
  return retentionConfig[key].value;
}

export const RETENTION_UNVALIDATED = unvalidatedKeys(retentionConfig);

/** The backup rotation must let a deletion finish within the spec's deadline. */
export function backupRotationMeetsDeletionDeadline(config = retentionConfig): boolean {
  return config.backupRetentionDays.value <= config.deletionCompletionMaxDays.value;
}
