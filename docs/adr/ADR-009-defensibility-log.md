# ADR-009 — Defensibility log: append-only, hash-chained, pseudonymous

- Status: Accepted (M20); amended by ADR-024 (anchored chain heads, structural purge; PKG-01)
- Date: 2026-09-23
- Deciders: M20 engineer; retention and lawful basis pending counsel (B1, B2)

## Context

L11: consents, notices shown, safety events, engine version per prescription, content approvals and incident handling are logged immutably and retained per schedule, so the company can show what the user saw and why a prescription was made. M20: append-only, tamper-evident (hash-chained), access audited, legal-hold export in under a day. M17's account deletion must still erase personal data (ADR-005).

## Decision

- **Event model** (`packages/legal/src/defensibility.ts`): `{ id, chain, chainSeq, type, occurredAt, payload, prevHash, hash }`. `hash` = SHA-256 over canonical JSON of every other field; `prevHash` is the previous event of the same chain (genesis `0…0`). Payloads are strict zod schemas per type: identifiers, versions, codes, hashes, engine versions only. Free text, emails and health values are rejected.
- **One chain per subject** (the M17 keyed subject reference, HMAC of the user id) plus a `global` chain. Per-subject chains make an export self-verifying and let retention remove whole chains without breaking others.
- **PostgreSQL** `defensibility_events`: triggers reject `UPDATE` always and `DELETE` unless the transaction set `app.defensibility_purge = on`, which only `purgeExpired` does. Appends take a transaction-scoped advisory lock per chain. No foreign key to `users`: the file survives account deletion. `occurred_at` is stored as the exact hashed string.
- **Same transaction.** Acceptances, notice impressions and consent decisions are written with their log event in one transaction. Since `3bff4b8` (M01 fix during M07) the same holds for the safety events of a synced screening, and `recordSafetyEvent` / `recordPrescription` take the transaction of the change they describe; calling them without one is only right when the event is the only write.
- **Retention**: a subject chain is purged when its last event is older than `defensibilityRetentionDays` (3650, `validated: false`) and it is not under legal hold; the purge is recorded in the global chain (`retention.purged` with the chain digest, count and head hash).
- **Access audit and legal hold**: `LegalService.legalHoldExport` appends `log.accessed` (actor role, purpose, subject digest) and `legal_hold.placed` (if none is active) before reading; the export contains the chain and its verification.

## Alternatives considered

- **A single global chain**: simpler, but retention would have to cut the chain and every export would need the whole log to verify.
- **Keyed (HMAC) chain**: stops recomputation by someone with database access but without the key; adds key management. The plain chain plus external anchoring (below) was preferred for now.
- **External ledger / WORM storage / timestamping service**: stronger, but needs production infrastructure (M19).
- **Blocking `TRUNCATE`**: would break test resets; in production the application role must not own the table (M19), which is what actually prevents `TRUNCATE`, `ALTER TABLE … DISABLE TRIGGER` and DDL.

## Consequences

- **Amended by ADR-024:** the statement below held only for edits. A removed tail or a removed chain verified as `ok` and the `app.defensibility_purge` GUC could be set by any session. ADR-024 adds anchored heads (`defensibility_heads`), a structural purge through `defensibility_purge_chain` and a separate purger role.
- Tampering by a table owner (triggers disabled) is **detected**, not prevented; an integration test proves it. Recomputing the whole chain after an edit is possible for someone with write access; the next step is to anchor chain heads outside the database (e.g. a daily head hash in write-once storage, M19) — open item.
- The log is pseudonymous personal data (it is linkable through the pepper). Lawful basis, period and its interaction with erasure requests are open questions for counsel.
- Device-side events (safety stops offline) will need a device buffer (`MemoryDefensibilityLog` shape) uploaded after sign-in (M01/M05).
