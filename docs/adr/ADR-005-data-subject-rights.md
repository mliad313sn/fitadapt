# ADR-005 — Data-subject rights: export, correction, deletion and backup purge

- Status: Accepted (M17 baseline)
- Date: 2026-09-23
- Deciders: M17 engineer (PE-11 role); legal review by seat B1 pending

## Context

Users must be able to get a copy of their data, correct it and delete their account in the app (GDPR Art. 15–17 and 20; app-store rules require in-app account deletion). The spec requires deletion to complete within 30 days, including backups on their rotation schedule. L11 requires the company to show later what a user agreed to and which requests were handled, which pulls against erasure.

## Decision

**Data inventory.** `apps/api/src/privacy/inventory.ts` lists every table in primary storage with where it appears in the export and how it is erased. An integration test compares it with the live schema: a new table cannot ship without that decision.

**Export** — `GET /v1/privacy/export` returns one JSON document (`DataExportSchema`, format `account-data-export`, schema version 1): user, devices, sessions, consent history, every synced change with its payload, the idempotency ledger, data requests and the pseudonymous audit trail. Credential hashes (refresh tokens, sign-in codes) are excluded; the sessions they belong to are exported. The response is `no-store` and an attachment. The export is itself recorded as a data request. Rate-limited per user. On the device, the privacy screen hands the JSON to the system share sheet.

**Correction** — `PATCH /v1/me` for locale and units. Synced records are corrected through sync (set logs are append-only: a correction is a new entry). Email change needs a verified-code flow and is left for M01.

**Deletion** — `POST /v1/privacy/deletion {confirm: "delete-my-account"}` with a valid session:

1. In **one transaction**: record the deletion request, write the audit entry, delete sign-in codes by email hash (they have no foreign key), delete the user row; everything else cascades (devices, sessions, refresh tokens, sync data, consent records). Primary storage holds nothing of the user once it commits (test: every table with a `user_id` column is empty for that user).
2. Clear the Redis rate-limit counters keyed by the email hash and subject reference.
3. **Schedule the backup purge**: `backupPurgeDueAt = now + backupRetentionDays` (30 days, ≤ the 30-day deadline).
4. The **retention job** (`PrivacyService.runRetention`, hourly, one runner via `pg_try_advisory_xact_lock`) completes a due request only when the `BackupCatalog` shows that no backup taken before the deletion is still retained; otherwise it reports the request as overdue (an alert and a runbook trigger). The production catalogue queries the backup provider (M19); development has no backups.
5. The same job enforces the other periods of the retention schedule (sign-in codes, ended sessions, pseudonymous records).
6. On the device, the app then erases the local database (records, outbox, sync metadata including the device id, consent ledger). The age-gate outcome is kept: it is not account data and it prevents a blocked minor from passing by deleting an account.

**What survives** is pseudonymous: `data_requests` and `audit_entries`, keyed by `HMAC(pepper, "subject", userId)`, without email, user id, device id or health data (tested). Whether this is lawful and for how long is an open question for B1 (retention schedule).

## Alternatives considered

- **Soft delete (a `deleted_at` flag)**: data stays in primary storage; fails "removes it from primary storage immediately".
- **Asynchronous deletion through a queue**: useful when erasure spans many services; with one database a single transaction is simpler and cannot half-complete. Revisit when processors (email, AI, analytics) hold data: each then gets a deletion call recorded on the request.
- **Crypto-shredding** (per-user data keys, destroyed on deletion, so backup copies become unreadable at once): stronger for backups and planned with field-level encryption of health payloads (ADR-006). Not needed for the 30-day commitment today.
- **Keeping consent records after deletion** with the user id: identifies the person; replaced by pseudonymous audit entries.

## Consequences

- Every new table must be added to the inventory with export and erasure decisions; every new processor must get a deletion path.
- In the app, export and deletion are usable once sign-in exists (M01); until then the buttons are disabled with an explanation.
- Step-up re-authentication before deletion and export (a fresh one-time code) is not built: a stolen access token could delete an account within its 15-minute lifetime. Listed as a gap (MASVS-AUTH-3) for M01.
- The inactive-account deletion in the retention schedule needs the mail provider (notice first) and is not built.
