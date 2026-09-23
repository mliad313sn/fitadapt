# Data protection impact assessment (DPIA)

> **Status: DRAFT — requires counsel review** (seat B1). Structure follows GDPR Art. 35(7): description, necessity and proportionality, risks, measures. Written by engineering for the M17 baseline; it must be revisited when each module that processes health data, photos, wearable data or AI conversations is built (M01, M04, M05, M11, M12), and signed off before public beta. Nothing here has been reviewed by counsel or the council.

## 1. Why a DPIA

The product processes data concerning health (GDPR Art. 9) about people who train alone or with a partner, offline, across several countries. A DPIA is expected before processing that is likely to result in a high risk (Art. 35(1)); processing health data at scale with new technology (adaptive engine, AI coach, on-device motion sensing) is the reason to do one now. Whether it is strictly mandatory for each processing is a question for counsel; we do it regardless.

## 2. Description of the processing

- **Nature.** A bilingual, offline-first training app. Data is created on the device and synced to the API (ADR-002). The engine is deterministic and explains every prescription (C2).
- **Scope.** Activities P1–P8 in [records-of-processing.md](records-of-processing.md). Data subjects are users aged 16 or over (S7 age gate). No data about third parties is collected, except that a Fair Pair partner (M09) trains on the same phone; M09 must extend this DPIA.
- **Context.** Users may be in the EU, the UK, Senegal and other West African markets. Many use mid- or low-range Android phones with intermittent connectivity. Some are beginners, some older, some returning after a long break (personas P1–P6).
- **Purposes.** Provide safe, explainable training sessions; keep data in sync across devices; with separate consent, use health data, photos, wearable data, the AI coach and product analytics.

## 3. Data inventory and sensitivity

| Data | Sensitivity | Held where | Notes |
|---|---|---|---|
| Email, locale, units | Personal | Server | Email only for sign-in; stored in clear because codes must be mailed; everywhere else a keyed hash (ADR-003) |
| Set logs, loads, body weight in logs, notes | Personal; **may reveal health** (injury, pain notes, weight changes) | Device and server | Treated as health data for security purposes even when consent is not the lawful basis (open question Q2) |
| Screening answers, pain reports, wearable data | **Health data (Art. 9)** | Device and server (future modules) | Behind the `health` / `wearables` consents |
| Progress photos | Sensitive (body images) | Device only, encrypted; server only as an end-to-end encrypted backup | Behind the `photos` consent (ADR-006) |
| AI coach conversations | May contain health data | Server and AI provider (M11) | Behind the `ai_coach` consent |
| Analytics events | Low: enums and buckets, no user id | Analytics store (M18) | Behind the `analytics` consent; allowlisted |
| Consent records, audit entries | Low (pseudonymous after deletion) | Server | L2, L11 |

## 4. Necessity and proportionality

- **Lawful basis** per activity and jurisdiction: [records-of-processing.md](records-of-processing.md) §3.
- **Minimisation.** The age gate keeps only the outcome, never the date of birth (test: `age-gate.e2e.test.tsx`). Analytics carry no identifier and no free text (allowlist). Logs carry no personal data (scrubber + tests). Emails, codes, tokens and IP addresses are stored or rate-limited only as keyed hashes.
- **Consent is granular and opt-in** per data type, versioned, and as easy to withdraw as to give (one toggle); withdrawal switches the features off at once, on the device and the server (ADR-004).
- **Storage limitation.** [retention-schedule.md](retention-schedule.md).
- **Data-subject rights.** Access and portability: in-app JSON export of everything in primary storage (`GET /v1/privacy/export`), checked against the live schema by a test. Rectification: `PATCH /v1/me` (locale, units); records are corrected through sync (set logs are append-only: corrections are new entries). Erasure: in-app deletion, primary storage at once, backups within 30 days (ADR-005). Objection and restriction: via consent withdrawal for consent-based processing; a support channel for the rest (to be set up with the Terms, M20).
- **Processors and transfers.** None contracted yet; each needs a data-processing agreement and, where relevant, a transfer mechanism (records §3).
- **Safety is never traded for privacy.** Refusing health consent must never loosen a safety gate: without screening data the engine treats screening as unresolved (S1 fails closed). This is a requirement on M01/M02 recorded in ADR-004.

## 5. Risks and measures

Likelihood and severity are qualitative (low / medium / high) engineering estimates, to be reviewed by B1.

| # | Risk to people | Likelihood | Severity | Measures (in place → planned) | Residual |
|---|---|---|---|---|---|
| R1 | Health data exposed by a server breach | Medium | High | TLS only, HSTS; keyed hashes for credentials; no health data in logs; least-privilege DB role (M19) → encryption at rest of the database and backups (M19), field-level encryption of health payloads (ADR-006), external pen-test (Phase 4) | Medium until M19 and the pen-test |
| R2 | Health data or photos exposed from a lost or shared phone | Medium | High | Photos encrypted on the device with a key in the OS keystore (ADR-006, built with M04); refresh token in the keystore (M01) → encrypted local database (SQLCipher) when health data first lands on the device (ADR-006) | Medium until those modules |
| R3 | Personal data leaking into logs, crash reports or analytics | Medium | Medium | Scrubber on every log record, child binding and interpolated value; errors log type and code only; analytics allowlist; tests fail on any email, name, weight, pain report or free text (goal condition 3) | Low |
| R4 | Processing without valid consent (e.g. after a text change or a withdrawal) | Medium | High | Versioned consent per data type; material change raises the minimum version and switches features off until renewal; the API refuses outdated grants; tests on device and server | Low |
| R5 | A minor uses the app | Medium | High | Age gate at 16 before any screen, neutral, block persists across relaunches; no marketing to minors (M19) → server-side check once the profile holds a date of birth (M01) | Medium (self-declaration can be bypassed by lying or reinstalling) |
| R6 | Deletion incomplete (backups, third parties, device) | Low | Medium | One-transaction erasure checked against every table with a user id; sign-in codes and rate-limit counters erased; backup purge completed only when the backup catalogue proves rotation; device wipe on deletion → processors' deletion clauses (DPAs) | Low |
| R7 | Unlawful transfer abroad (Senegal, UK, US processors) | Medium | Medium | EU hosting proposal; per-jurisdiction transfer mechanism in the records → counsel review and CDP formalities (Gate 0) | Medium until filings |
| R8 | Re-identification through pseudonymous records kept after deletion | Low | Low | HMAC with a server-side pepper; no email, user id, device id or health data in those records (tested) → counsel to confirm retention basis (Q3) | Low |
| R9 | Vulnerable dependency or leaked secret | Medium | High | CI fails on high/critical advisories, on any secret in history (gitleaks) and on security lint findings; Dependabot; licence gate | Low |
| R10 | AI coach receives health data and a provider retains it | Medium | High | Separate `ai_coach` consent; provider choice with a no-training/no-retention agreement (M11) | Open (M11) |

## 6. Consultation and sign-off

| Step | Status |
|---|---|
| Engineering draft | Done (M17 baseline, 2026-09-23) |
| Review by privacy counsel (seat B1) | Not started: seat open (docs/governance/03-expert-advisory-council.md) |
| Views of data subjects or their representatives (Art. 35(9)) | Not started: planned with the Phase 1 user panel |
| Prior consultation of an authority (Art. 36) | Not assessed: depends on B1's view of the residual risks |

## 7. Open questions for counsel

- **Q1.** Is a DPIA mandatory for this processing in each launch market, and does any authority require it to be filed?
- **Q2.** Are set logs with body weight or notes "data concerning health" when no screening or pain data is attached? If yes, P2 needs explicit consent too, and training (the core service) would depend on it.
- **Q3.** Is keeping pseudonymous audit entries and request records after deletion lawful, and for how long (L11 vs erasure)?
- **Q4.** Minimum age: is 16 enough in every launch market, and is self-declaration an acceptable age-assurance method?
- **Q5.** Senegal: which CDP formality applies to health data and to hosting in the EU?
