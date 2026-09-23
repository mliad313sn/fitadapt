# ADR-008 — Legal documents, acceptance and the production release guard

- Status: Accepted (M20)
- Date: 2026-09-23
- Deciders: M20 engineer; legal review by counsel pending (nothing here is legal advice)

## Context

L2 requires Terms, Privacy Policy, health-data consent and an exercise-risk acknowledgment to be accepted before the first workout, each acceptance storing document version, locale, jurisdiction and time, with re-acceptance on material change. L3 requires notices at the point of risk; L5 an AI disclosure at every conversation. M20 requires texts per locale and jurisdiction and that unapproved texts cannot be enabled in production builds. CLAUDE.md rule 5 puts every user-facing string in `packages/i18n`. M17 (ADR-004) already records consents with version, locale and jurisdiction, and left the wording to M20.

## Decision

- **Wording in i18n, structure in `packages/legal`.** Legal texts are `legal.*` messages in `packages/i18n` (FR and EN, parity-tested). `packages/legal` holds the registry: documents, integer versions with `material`, `publishedOn`, `effectiveFrom`, sections (a message, or one message per jurisdiction variant with a default) and one counsel approval entry per variant. Every entry is `pending`. Drafts for counsel are generated from the same source into `docs/legal/drafts`.
- **Jurisdiction variants.** Countries map to six text variants (`EU_FR`, `GB`, `US`, `SN`, `CI`, `DEFAULT`) through the jurisdiction matrix (config with `source`/`validated`). Unknown countries get `DEFAULT` with the strictest values.
- **Acceptance record** `{ documentId, version, locale, jurisdiction, source, contentHash, acceptedAt }`, append-only. `contentHash` is SHA-256 of exactly what was rendered (draft banner, title, sections); the server re-renders and refuses a mismatch, so a record proves which text was shown. An acceptance counts only for the variant it was given in.
- **Versions.** The version in force is the latest whose `effectiveFrom` has passed; a published future version is "upcoming" and can be accepted early. A material change raises the minimum accepted version once in force; a non-material change keeps the acceptance and shows an update notice. Material changes of Terms, Privacy and Subscription Terms need `materialChangeNoticeDays` of advance notice (validated by `validateRegistry`).
- **Consents stay in the M17 ledger.** Consent documents (`consent.<type>`) have the version and `documentKey` of `CONSENT_POLICIES`; a test keeps them equal. The first-workout gate reads the health consent from the consent ledger; it fails closed.
- **Ages.** `evaluateEligibility` runs the S7 gate first, then the jurisdiction's minimum and digital-consent ages (which can only raise 16), and flags purchases below the age of majority.
- **Notices.** A registry of point-of-risk notices with trigger, frequency (`once_per_version` until acknowledged, or `every_time`), acknowledgement flag and emergency guidance from the matrix (a number only where configured).
- **Release guard.** `assertLegalReleaseReady(profile)` throws for `production` while any enabled document version or notice lacks an approval with reviewer, record and date for any enabled variant. It runs in `apps/mobile/app.config.js` (EAS `production` sets `APP_VARIANT=production`) and at API start with `NODE_ENV=production`. Unknown build variants are treated as production.
- The same pure code runs on the device (offline) and on the server. SHA-256 is implemented in TypeScript because Hermes has no `node:crypto`; tests compare it with `node:crypto`.

## Alternatives considered

- **Legal texts as Markdown files in `packages/legal`**: easier for counsel to edit, but outside the i18n parity checks and rule 5. Counsel reviews the generated drafts instead.
- **Reusing `consent_records` for Terms and Privacy**: its `dataType` enum is about data processing; mixing contract acceptance into it would blur withdrawal semantics (a Terms acceptance cannot be "withdrawn" the way a consent can).
- **Semantic versions**: integers compare without parsing (as ADR-004).
- **Approval flags in a separate JSON**: the approval must travel with the version it approves; keeping it beside the version makes a partial approval visible in review.

## Consequences

- Any wording change is a new version; a change to the rendering (banner, values) changes the hash and therefore needs a new acceptance of the affected text.
- A production build is impossible until counsel approves every enabled text per enabled variant; the release config can narrow the variants to the markets actually launched.
- M01 must render the texts, post acceptances with the hash, and call the first-workout gate; M02/M03 must call `requireFirstWorkoutAcceptance` on workout endpoints and show notices through `noticesToShow`.
