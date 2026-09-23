# Compliance documents (M17)

> **Status: DRAFT — requires counsel review.** Written by the M17 engineer (a non-lawyer) as a starting point for privacy counsel (council seat B1) and local counsel in each launch jurisdiction. Nothing here is legal advice, and nothing here has been reviewed by counsel yet. Statements about the law are hypotheses to check.

| Document | What it is | Owner / reviewer |
|---|---|---|
| [dpia.md](dpia.md) | Data protection impact assessment (GDPR Art. 35) for the baseline product | PE-11 / B1 |
| [records-of-processing.md](records-of-processing.md) | Record of processing activities (GDPR Art. 30) and the per-jurisdiction matrix: lawful basis, transfer mechanism, authority-filing status | PE-11 / B1 + local counsel |
| [retention-schedule.md](retention-schedule.md) | How long each data category is kept, and how it is erased | PE-11 / B1, B2 (L11) |
| [breach-runbook.md](breach-runbook.md) | Personal-data breach response: detection to notification and review | PE-11 / B1 |
| [masvs-asvs-checklist.md](masvs-asvs-checklist.md) | OWASP MASVS (mobile) and ASVS Level 2 (API) checklist, with a status per item | PE-11 / external pen-tester (Phase 4) |

`pnpm compliance:check` (CI job *Security scans and compliance documents*) fails if a document is missing, is not marked as a draft that requires counsel review, if the records of processing miss a lawful basis, transfer mechanism or filing status for a jurisdiction of the matrix in `docs/specs/00-legal-framework.md`, if a checklist item has no status, or if a retention period in `packages/privacy/src/retention.ts` is not in the schedule.

Legal texts shown to users (Terms, Privacy Policy, consent texts, notices) are **not** here: they belong to M20 (`packages/legal`). The consent data model that records which text version a user accepted is in `packages/privacy` (ADR-004).
