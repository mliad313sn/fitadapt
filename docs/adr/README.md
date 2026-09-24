# Architecture Decision Records

One ADR per significant decision (template: context, decision, alternatives, consequences).

| ADR | Decision | Module |
|---|---|---|
| [ADR-001](ADR-001-stack.md) | Stack and repository layout | M00 |
| [ADR-002](ADR-002-sync.md) | Local-first data and sync | M00 |
| [ADR-003](ADR-003-auth.md) | Authentication | M00 |
| [ADR-004](ADR-004-consent-model.md) | Consent model: versioned, per data type, same rules on device and server | M17 |
| [ADR-005](ADR-005-data-subject-rights.md) | Export, correction, deletion and backup purge | M17 |
| [ADR-006](ADR-006-encryption-and-key-management.md) | Encryption in transit and at rest, photos, keys and secrets | M17 |
| [ADR-007](ADR-007-security-gates-and-telemetry-hygiene.md) | CI security gates, log scrubbing and analytics allowlist | M17 |
| [ADR-008](ADR-008-legal-acceptance-model.md) | Legal documents, acceptance, notices and the production release guard | M20 |
| [ADR-009](ADR-009-defensibility-log.md) | Defensibility log: append-only, hash-chained, pseudonymous | M20 |
| [ADR-010](ADR-010-claims-and-licence-controls.md) | Claims linter, substantiation file and licence controls | M20 |
| [ADR-011](ADR-011-exercise-knowledge-graph.md) | Exercise knowledge graph, substitution and offline library | M06 |
| [ADR-012](ADR-012-onboarding-screening-and-safety-profile.md) | Onboarding, health screening and the SafetyProfile | M01 |
| [ADR-013](ADR-013-mobile-sign-in-and-account-sync.md) | Sign-in in the app and account sync of the device ledgers | M01 |
| [ADR-014](ADR-014-assessment-capacity-and-first-session.md) | Assessment protocols, CapacityModel and the first session | M07 |
| [ADR-015](ADR-015-program-architect-and-m02-api.md) | Program architect: periodization, scheduling, reflow, and the API M02 builds on | M08 |
| [ADR-016](ADR-016-session-engine-and-execution.md) | Session engine: one generator, double progression, increments, time-boxing, and offline execution | M02 |
| [ADR-017](ADR-017-recovery-pain-monitoring-and-red-flag-flow.md) | Recovery: pain monitoring, triggered deloads, warm-ups, readiness and the S3 red-flag flow | M05 |
| [ADR-018](ADR-018-cardio-conditioning-and-eyes-free-intervals.md) | Cardio and conditioning: protocols in the one generator, HIIT and impact gates, zones, eyes-free wall-clock interval timer, weekly aerobic ledger | M03 |
| [ADR-019](ADR-019-tracking-analytics-and-progress-dashboard.md) | Tracking and analytics: pure engine analytics, the progress dashboard, body data, the M10 guardrail hand-off, export and import | M04 |
| [ADR-020](ADR-020-device-encryption-and-photo-backup.md) | Health data encrypted at rest on the device (SQLCipher, keystore key, fail closed) and progress photos with an end-to-end-encrypted backup | M04 |
| [ADR-021](ADR-021-fair-pair-partner-training.md) | Fair Pair: one engine per person, shared timeline, relative Fair Challenge Score, partner consent and privacy, multi-device WebSocket relay | M09 |
| [ADR-022](ADR-022-nutrition-energy-balance.md) | Nutrition and energy balance: S4 floors in packages/safety, the engine's nutrition target (Mifflin-St Jeor, adaptive expenditure), supportive mode without numbers, an original food seed, and the M04 hand-off handled | M10 |
| [ADR-023](ADR-023-latest-record-ordering.md) | "The latest counts" follows an explicit `supersedes` chain, never a clock; ambiguity fails closed (screenings, consents, nutrition plans, readiness, assessments, programs, reflows, S2/S3 links); device and server use the same functions | FIX-latest-record-ordering |
| [ADR-024](ADR-024-s3-lock-survives-health-withdrawal.md) | The S3 intensity lock survives a health-consent withdrawal: minimal lock facts kept apart from erasable logs while the lock is on (retention basis validated:false, B1/counsel) | FIX-api-security (MOB-08) |
| [ADR-025](ADR-025-api-abuse-limits-and-trusted-proxy.md) | API abuse limits (rate limits on join, create, consents, acceptances, notices, photos), bounded pool waits, auth before body, eight-character join codes, WebSocket session re-checks and caps, trusted-proxy hop count (all validated:false) | FIX-api-security |
