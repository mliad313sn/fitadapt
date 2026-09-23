# docs/legal — Legal framework, claims control and defensibility (M20)

> **DRAFT — requires counsel review.** Every document in this folder was written by a non-lawyer drafting assistant as a starting point for qualified counsel in each launch jurisdiction. **Nothing here is legal advice, nothing is final, and no text has had counsel review or sign-off yet.** Approval status per text and jurisdiction lives in [counsel-signoff-tracker.md](counsel-signoff-tracker.md); every entry is `pending`.

| Document | Purpose | Kept in sync by |
|---|---|---|
| [founder-checklist.md](founder-checklist.md) | Gate 0 founder protections (company, IP, employment, counsel, name, insurance, advisors, filings). Human actions; every item `open`. | `pnpm legal:docs` (all items present and open) |
| [jurisdiction-matrix.md](jurisdiction-matrix.md) | Per market: text variant, age thresholds, withdrawal rules, emergency guidance, authority filings, frameworks to check. | generated from `packages/legal/src/jurisdictions.ts` |
| [risk-register.md](risk-register.md) | Legal risk register with controls and status. | `pnpm legal:docs` (every domain present) |
| [document-list.md](document-list.md) | Every legal document, where it is shown, and its draft. | `pnpm legal:docs` (every draft linked) |
| [drafts/](drafts/) | Draft texts. In-app texts are generated from `packages/i18n` (`legal.*` keys, FR and EN); contracts are hand-written. | `pnpm legal:docs` |
| [trademark-register.md](trademark-register.md) | Codename vs public name, classes, markets, status (L7). | `pnpm legal:docs`; codename check in `pnpm legal:claims` |
| [substantiation-file.md](substantiation-file.md) | Evidence for claims and the exact disclaimers the claims linter allows (L1). | `pnpm legal:claims` |
| [asset-licence-register.md](asset-licence-register.md) | Licence record for every media asset, font, sound, icon and dataset (L6). | `pnpm legal:licences` |
| [defensibility-file.md](defensibility-file.md) | What the defensibility log holds, retention, legal hold and export (L11). | tests in `packages/legal` and `apps/api` |
| [incident-procedure.md](incident-procedure.md) | Injury reports, complaints, escalation, legal hold, regulator and insurer notification. | `pnpm legal:docs` (every step present) |
| [counsel-signoff-tracker.md](counsel-signoff-tracker.md) | Counsel approval per text, version and jurisdiction variant (all `pending`). | generated from `packages/legal` approvals |

Commands: `pnpm legal:claims` (L1/L7), `pnpm legal:licences` (L6, SBOM), `pnpm legal:docs` (this folder), `pnpm legal:export --user <id>` (L11 legal-hold export), `pnpm legal:check` (the first three). Production builds refuse unapproved legal texts (`assertLegalReleaseReady`, see ADR-008).
