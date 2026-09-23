# Retention schedule

> **Status: DRAFT — requires counsel review** (seat B1 for privacy; seat B2 for the defensibility file, L11). Every period below is a config value in `packages/privacy/src/retention.ts` with `source` and `validated: false` (CLAUDE.md rule 4). Only the 30-day deletion deadline comes from the spec; the other periods are engineering defaults without an external source and must be set by counsel.

## Rules

- Deletion of an account completes within **30 days, backups included** (M17 spec, Rules). Primary storage is erased at once; backups leave by rotation, so the backup retention must not exceed the deletion deadline (checked by a unit test, `backupRotationMeetsDeletionDeadline`).
- A period starts at the event named in the *Trigger* column.
- Erasure is performed by the retention job (`PrivacyService.runRetention`, scheduled in `apps/api/src/server.ts`, one runner at a time through a PostgreSQL advisory lock) unless stated otherwise.
- Logs and analytics hold no personal data by design (ADR-007); their periods limit volume, not exposure.

## Schedule

| Data | Config key | Period | Trigger | How it is erased | Why this period |
|---|---|---|---|---|---|
| Account, devices, sessions, training data, consent records | — (account lifetime) | Until deletion | Account deletion by the user | At once, in one transaction (`POST /v1/privacy/deletion`); cascade from `users` | Needed to provide the service |
| Deletion deadline, backups included | `deletionCompletionMaxDays` | 30 days | Deletion request | Backup rotation; the retention job marks the request complete only when no backup older than the deletion remains | M17 spec |
| Encrypted database backups | `backupRetentionDays` | 30 days | Backup taken | Backup provider rotation (M19) | Must fit the 30-day deletion deadline |
| One-time sign-in codes (keyed hashes) | `otpCodeRetentionDays` | 1 day | Code created | Retention job | Codes live 10 minutes; one day covers support questions |
| Ended sign-in sessions and their refresh-token hashes | `endedSessionRetentionDays` | 90 days | Session revoked, or its last refresh token expired | Retention job | Security investigations (refresh-token reuse) |
| Pseudonymous audit entries (consent history, requests handled) | `auditEntryRetentionDays` | 6 years | Entry written | Retention job | Defensibility file (L11); period to be set by counsel against limitation periods in launch markets |
| Pseudonymous data-request records | `dataRequestRetentionDays` | 6 years | Request made | Retention job (completed requests only) | Proof that rights requests were honoured; period to be set by counsel |
| Inactive accounts | `inactiveAccountDays` | 3 years | Last sign-in or sync | Notice to the user, then deletion (**not built**: needs the mail provider, deferred) | Storage limitation; period to be set by counsel |
| Application logs | `applicationLogRetentionDays` | 30 days | Log line written | Log store rotation (M19) | Operations; logs carry no personal data |

## What survives an account deletion

Only pseudonymous records: `data_requests` and `audit_entries`, keyed by an HMAC of the former user id (`subject_ref`). They hold no email, no user id, no device id and no health data (an integration test checks this). They prove that a deletion was requested and completed, and which consent texts were accepted or withdrawn, for the defensibility file (L11). Whether they count as personal data after deletion, and whether keeping them is lawful (e.g. GDPR Art. 17(3)(e), legal claims), is an open question for counsel (B1).

## On the device

- Deleting the account from the app erases the local database (synced records, outbox, sync metadata including the device id, consent ledger). The age-gate outcome is kept: it is a fact about the device's user, not account data (ADR-005).
- Progress photos (M04) will stay on the device, encrypted, until the user deletes them or the app is removed (ADR-006).
