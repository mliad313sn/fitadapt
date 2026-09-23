# Defensibility file (L11)

> **DRAFT — requires counsel review.** Design: docs/adr/ADR-009-defensibility-log.md. Retention periods are configuration with `validated: false` until counsel sets them.

## What is recorded

| Event | When | Payload (no personal data) |
|---|---|---|
| `acceptance.recorded` | Terms, Privacy Policy, exercise-risk acknowledgment, subscription terms, community guidelines accepted | document id, version, locale, jurisdiction, SHA-256 of the exact text shown, source |
| `consent.recorded` | Any M17 consent grant or withdrawal (health-data consent included) | data type, decision, version, locale, jurisdiction |
| `notice.shown` / `notice.acknowledged` | Point-of-risk notice displayed / confirmed (L3) and AI disclosure (L5) | notice id, version, locale, jurisdiction, SHA-256 of the text shown |
| `safety.event` | An S1–S7 gate blocks, substitutes, caps or ends a session | invariant, reason code, action, engine version |
| `prescription.issued` | The engine issues a prescription | prescription id, engine version, reason codes |
| `program.generated` | A program (M08) is stored; written in the same transaction as the program record | program id, engine version, program rules version, template id, reason codes |
| `program.reflowed` | The engine shifts, merges or skips a session the user could not do (M08); same transaction as the reflow record | program id, session id, outcome, engine version |
| `content.approved` | Exercise, notice or copy approved by a council seat | content id, version, reviewer seat, sign-off record path |
| `incident.recorded` | Each step of incident-procedure.md | incident id, category, step |
| `legal_hold.placed` / `released` | Legal hold on a subject | hold id, reason code |
| `log.accessed` | Every export or integrity check | actor role, purpose, subject digest, events returned |
| `retention.purged` | A subject chain removed after its retention period | chain digest, event count, head hash |

Events are keyed by a pseudonymous subject reference (keyed hash of the user id, as for M17 audit entries), so the file survives account deletion without holding the user's email or name. It is still pseudonymous personal data: lawful basis and period are open questions for counsel (docs/status/M20.md).

## Integrity and access

- One hash chain per subject plus a `global` chain. Each event's SHA-256 covers its fields and the previous event's hash.
- PostgreSQL rejects `UPDATE` and `DELETE` on `defensibility_events` by trigger; the only deletion path is the retention purge, which runs inside a transaction that sets a purge flag and removes whole chains only.
- Every read through the export command writes a `log.accessed` event first.

## Retention and legal hold

- `defensibilityRetentionDays` = 3650 days (10 years) after the subject's last event, `validated: false` (packages/legal/src/config.ts). Counsel to confirm per jurisdiction.
- A subject under legal hold is never purged.

## Legal-hold export

`pnpm legal:export --user <user-id> [--out <file>] [--actor <role>]` places a legal hold, logs the access and writes a JSON file with the subject's acceptances, consents, notices, safety events, prescriptions, engine versions, holds, access log, the full chain and its verification result. KPI: produced in < 1 day (`legalHoldExportTargetHours`); in practice seconds.
