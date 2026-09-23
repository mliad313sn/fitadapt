# M20 — Legal Framework, Claims Control & Defensibility

| Status | Phase | Depends on |
|---|---|---|
| New (legal hardening) | Phase 0 (after M17 baseline); maintained to launch | M00, M17 |

## Purpose
Give the product the legal mechanisms it needs — documents, recorded acceptance, point-of-risk notices, claims control, licence compliance, name clearance tracking and an immutable defensibility file — so that risk is reduced by design and provable afterwards.

## Why (committee review)
Me. Paul A.: disclaimers cannot remove liability for negligent injury, so safety by design plus proof of what the user saw is the real defence. Dr. Nina W.: one careless sentence ('treats back pain') can turn a wellness app into a medical device. Me. Aïcha D.: the 'Adapt' name space is crowded and unlicensed media is the most common infringement in fitness apps. Victor L.: insurers ask for exactly this evidence before quoting.

## Scope
- packages/legal: versioned legal documents per locale and jurisdiction (drafts for counsel), acceptance service, point-of-risk notice registry (L2, L3).
- Jurisdiction matrix as configuration (age thresholds, required notices, withdrawal rules, emergency guidance, authority-filing status).
- Claims linter over i18n catalogues, store metadata, AI-coach system prompts and marketing copy, with FR/EN denylists and an allowlisted substantiation file (L1).
- Licence compliance: software bill of materials, open-source licence allowlist, asset/dataset licence register with evidence links (L6).
- Trademark and name register (codename vs public name, classes, markets, status) (L7).
- Defensibility file: append-only log of acceptances, notices shown, safety events, engine versions, content approvals and incident handling, with retention rules and legal-hold export (L11).
- Incident and complaint procedure: injury report path, escalation, legal hold, regulator and insurer notification steps.
- docs/legal: founder checklist (Gate 0), risk register, document list, counsel sign-off tracker.

## Rules
- Legal texts are drafts until counsel marks them approved for a jurisdiction; unapproved texts cannot be enabled in production builds.
- The defensibility log is append-only and tamper-evident (hash-chained); access is audited.
- The claims linter runs in CI and on AI-coach eval outputs; any hit fails the build unless the phrase is in the substantiation file with evidence.

## Core data entities
LegalDocument, DocumentVersion, Acceptance, NoticeImpression, DefensibilityEvent, LicenceRecord, TrademarkRecord, IncidentReport

## Acceptance criteria
- Acceptance and notices work per locale and jurisdiction; production builds refuse unapproved legal texts.
- Claims linter, licence scan and defensibility-log integrity checks run in CI.
- Legal docs, matrix, registers and procedures exist in docs/legal, marked 'requires counsel review'.

## KPIs
- Open legal gates at launch = 0
- Claims-linter violations merged = 0
- Time to produce a legal-hold export < 1 day

## Out of scope
- Giving legal advice or replacing counsel
- Filing trademarks or regulatory forms automatically
