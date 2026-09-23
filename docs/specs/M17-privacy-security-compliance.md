# M17 — Privacy, Security & Compliance

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 0 baseline; Phase 4 completion | M00 |

## Purpose
Treat health data, photos and conversations as the most sensitive data they are — by design, provably.

## Why (committee review)
Me. Hélène: health data is special-category data under GDPR Art. 9 and needs explicit consent; other launch markets have their own data-protection laws; stores require in-app account deletion. Raj and Yuki: security must be tested, not asserted.

## Scope
- Consent management per data type (health, photos, wearables, AI coach, analytics) with versioned consent records; legal texts configurable per country.
- Data subject rights in-app: export, correction, account and data deletion (with backup purge schedule).
- Encryption: TLS 1.2+ (prefer 1.3) in transit, encryption at rest, end-to-end encryption for photo backups; secrets management.
- Security baselines: OWASP MASVS for mobile, OWASP ASVS Level 2 for the API; dependency and secret scanning in CI; external penetration test before launch.
- DPIA, records of processing, retention schedule, breach-response runbook.
- Wellness positioning and claims review (not a medical device); terms and privacy policy; age gate at 16.

## Rules
- No personal or health data in logs or analytics.
- Deletion completes within 30 days, including backups on their rotation schedule.
- Records of processing include, per jurisdiction, the lawful basis, transfer mechanism and authority-filing status (e.g., CDP formalities).

## Core data entities
ConsentRecord, DataRequest, RetentionPolicy, AuditEntry

## Acceptance criteria
- Automated privacy tests; security scans clean; DPIA and runbooks in repo; pen-test findings closed before launch.

## KPIs
- Open high/critical findings = 0 at launch
- Median data-request completion time

## Out of scope
- Certification programmes (e.g., ISO 27001) — later decision
