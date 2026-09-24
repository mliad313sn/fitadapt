# ADR-004 — Consent model

- Status: Accepted (M17 baseline)
- Date: 2026-09-23
- Deciders: M17 engineer (PE-11 role); legal review by seat B1 pending

## Context

Health data is special-category data (GDPR Art. 9) and needs explicit consent; other launch markets have their own rules (M17 spec, L9). The spec asks for consent per data type (health, photos, wearables, AI coach, analytics) with versioned records and legal texts configurable per country. L2 requires each acceptance to store document version, locale, jurisdiction and time, and material changes to require re-acceptance. The app is offline first: a withdrawal made in airplane mode must take effect at once on the device. Consent wording belongs to M20 (`packages/legal`), which does not exist yet.

## Decision

**Data model** (`packages/shared/src/privacy.ts`):

- `ConsentRecord { id, dataType, decision: granted | withdrawn, version, locale, jurisdiction, source, recordedAt }`. Five data types: `health`, `photos`, `wearables`, `ai_coach`, `analytics`. Nothing is granted by default.
- Records are **append-only**. A withdrawal is a new record. On the server a trigger rejects `UPDATE` on `consent_records` (and `audit_entries`); rows are deleted only with the account.
- The latest decision per data type wins (time, then insertion order `seq`).

**Versioning** (`packages/privacy/src/consent.ts`): each data type has a consent text policy `{ currentVersion, minimumVersion, documentKey }`, with optional per-jurisdiction overrides (ISO 3166-1 alpha-2; `ZZ` = unknown, which gets the default texts). A grant counts only if its version ≥ `minimumVersion`; raising `minimumVersion` for a material change switches the features off (`needsRenewal: true`) until the user accepts the current text. The API accepts new grants only for `currentVersion` (409 `privacy.consent_version_outdated`); withdrawals are always accepted. `documentKey` (e.g. `consent.health.v1`) names the text that M20 will provide; M17 ships **no consent wording**, only UI labels in `packages/i18n` (marked as drafts owned by M20).

**One rule set on device and server.** `@fitadapt/privacy` is pure TypeScript used by the app and the API. A feature registry maps each consent-gated feature to the consents it needs (e.g. `wearables.import` needs `wearables` and `health`). `isFeatureEnabled` is true only while every one is currently granted: features stay off without consent and switch off on withdrawal.

- Device: an append-only ledger in the local database (`app_kv`), a `useFeature` hook and a `FeatureGate` component. Works offline.
- Server: `GET/POST /v1/privacy/consents`; `PrivacyService.requireConsent` guards consent-bound endpoints (today: `POST /v1/analytics/events`).
- Withdrawal handlers: owning modules register a handler per data type, run in the same transaction as the withdrawal, to stop processing and erase what they hold on that basis.

**Safety is never traded for privacy.** Refusing or withdrawing health consent must never loosen a safety gate. Without screening data the engine must treat screening as unresolved (S1 fails closed). M01 and M02 implement this; it is a requirement, not an option.

**Audit.** Every decision also writes a pseudonymous `audit_entries` row (action, data type, version, time, keyed subject reference), which survives account deletion (L11, ADR-005).

## Alternatives considered

- **A single "I agree" consent**: not specific or granular enough for Art. 9 and cannot switch off one feature.
- **Mutable consent flags on the user row**: loses the history L2 and L11 need.
- **Server-only consent**: breaks offline use and would let a withdrawn feature keep running until the next sync.
- **A consent-management platform (CMP)**: built for web cookies, adds a vendor and a transfer; our needs are five data types.
- **Semantic version strings**: integer versions per data type are enough and compare without parsing.

## Consequences

- Features built later (M01, M04, M05, M11, M12, M18) must register in `FEATURE_CONSENTS` and check `isFeatureEnabled` / `requireConsent`; a new consent data type is a schema change in `packages/shared` and a migration.
- The device ledger is not yet sent to the server: sign-in arrives with M01, which must upload device decisions (they are already shaped as `ConsentRecord`s) and reconcile them with server records.
- L2 acceptances (Terms, Privacy Policy, exercise-risk acknowledgment) are M20's; they can reuse this record shape and ledger.

> **Amended by ADR-023 (2026-09-24):** "the most recent decision wins" is the head of the decisions' `supersedes` chain, not the newest `recordedAt`; decisions stored before it keep the time-then-position order; several heads → withdrawn if any is a withdrawal (fail closed).
