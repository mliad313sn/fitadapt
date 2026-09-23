# Security checklist: OWASP MASVS (mobile) and ASVS Level 2 (API)

> **Status: DRAFT — requires counsel review** for the privacy items (MASVS-PRIVACY, V8) and review by the external penetration tester in Phase 4 for all items. This is a self-assessment by engineering at the M17 baseline: "Implemented" means built and covered by a test or a CI gate in this repository, not independently verified.

Statuses: **Implemented** (built and tested), **Partial** (some of it built; the gap is named), **Planned** (owner module named), **Deferred** (decision postponed to M17 completion, Phase 4), **Not applicable** (with the reason).

Standards: OWASP MASVS v2 control groups (with MASVS-PRIVACY); OWASP ASVS 4.0.3 at section level, Level 2. Requirement-by-requirement verification against the official texts is part of the Phase 4 pen-test preparation (open question: move to ASVS 5.0 then).

## Mobile app (MASVS)

| ID | Control | Status | Evidence / gap |
|---|---|---|---|
| MASVS-STORAGE-1 | Sensitive data is stored securely | Partial | Only the age-gate outcome and consent ledger are stored today (no health data on device yet). Gap: encrypted local database (SQLCipher) and keystore-held keys when health data first lands on the device (ADR-006, M01/M05); photos encrypted on device (M04). |
| MASVS-STORAGE-2 | Sensitive data does not leak | Partial | `android.allowBackup: false` (test in `apps/mobile/__tests__/privacy.test.tsx`); `reportError` accepts no user data; analytics allowlist. Gap: iOS backup exclusion and screenshot protection for photo screens (M04). |
| MASVS-CRYPTO-1 | Strong, current cryptography used correctly | Partial | No custom crypto on the device yet. Design: AES-256-GCM with a keystore-held key for photos and backups (ADR-006). Built with M04. |
| MASVS-CRYPTO-2 | Key management follows best practice | Planned | Keys generated on device, kept in the Keychain/Keystore via expo-secure-store; backup key derived from a user secret (ADR-006, M04). |
| MASVS-AUTH-1 | Secure authentication and authorisation protocols | Implemented | One-time email code, 15-minute access tokens, rotating refresh tokens with family revocation on reuse (ADR-003; `apps/api/test/integration/auth.test.ts`). Sign-in screens: M01. |
| MASVS-AUTH-2 | Local authentication follows platform practice | Not applicable | No local (biometric/PIN) authentication. Revisit if an app lock is added. |
| MASVS-AUTH-3 | Sensitive operations need additional authentication | Partial | Account deletion needs a valid session, a confirmation sheet in the app and an explicit confirmation value in the API call. Gap: step-up re-authentication (fresh one-time code) before deletion and export (M01). |
| MASVS-NETWORK-1 | All traffic is secured | Partial | The app refuses a non-https API URL outside loopback development builds; no cleartext exceptions in `app.json` (tests); HSTS from the API. Gap: TLS 1.2+/1.3-only termination configured at the edge (M19). |
| MASVS-NETWORK-2 | Identity pinning for own endpoints | Deferred | Pinning trades resilience for security; decide with the pen-tester (Phase 4). |
| MASVS-PLATFORM-1 | IPC used securely | Partial | Deep links (`companion://`) reach only routes behind the age gate (`Stack.Protected`, E2E test). Gap: review of deep-link parameters once screens take parameters. |
| MASVS-PLATFORM-2 | WebViews used securely | Not applicable | No WebView in the app. |
| MASVS-PLATFORM-3 | UI used securely | Partial | No sensitive data displayed yet. Gap: hide photo and health screens in the app switcher (M04, M05). |
| MASVS-CODE-1 | Up-to-date platform version required | Planned | Minimum OS versions come from Expo SDK 57 defaults; set explicitly before store submission (M19). |
| MASVS-CODE-2 | Enforced app updates | Planned | Minimum-version check or EAS Update policy (M19). |
| MASVS-CODE-3 | No components with known vulnerabilities | Implemented | CI fails on high/critical advisories (`pnpm security:audit`), weekly scheduled audit, Dependabot, licence gate. |
| MASVS-CODE-4 | Untrusted input validated | Implemented | zod at every boundary (API responses in the privacy client, stored ledgers); age-gate input fails closed (S7 property tests). |
| MASVS-RESILIENCE-1 | Platform integrity validated | Deferred | Resilience controls are optional in MASVS; decide in Phase 4 whether a wellness app warrants root/jailbreak detection. |
| MASVS-RESILIENCE-2 | Anti-tampering | Deferred | Same decision (Phase 4). Store signing via EAS covers distribution integrity (M19). |
| MASVS-RESILIENCE-3 | Anti-static analysis | Deferred | Same decision (Phase 4). No secrets are shipped in the app bundle. |
| MASVS-RESILIENCE-4 | Anti-dynamic analysis | Deferred | Same decision (Phase 4). |
| MASVS-PRIVACY-1 | Access to sensitive data minimised | Implemented | Opt-in consent per data type; the age gate keeps only its outcome, never the date of birth (E2E test). |
| MASVS-PRIVACY-2 | User identification prevented | Partial | Analytics carry no user or device id; logs carry no personal data. Gap: the server keeps the email for sign-in (necessary); pseudonymous ids for analytics cohorts, if any, are M18's decision. |
| MASVS-PRIVACY-3 | Transparent about data collection | Partial | Consent labels per data type in FR/EN. Gap: privacy policy and consent texts (M20), store privacy labels (M19). |
| MASVS-PRIVACY-4 | User control over their data | Partial | Consent toggles work offline and switch features off at once; export and deletion are built (API + privacy screen). Gap: usable in the app only once sign-in exists (M01). |

## API (ASVS 4.0.3, Level 2)

| ID | Section | Status | Evidence / gap |
|---|---|---|---|
| V1.1 | Secure software development lifecycle | Partial | ADRs, CI gates (tests, security scans, licence gate), this checklist. Gap: written threat model (Phase 4). |
| V1.2 | Authentication architecture | Implemented | ADR-003. |
| V1.4 | Access control architecture | Implemented | Every data route authenticates and scopes by the token's user id; sessions checked on every request (logout takes effect at once). |
| V1.6 | Cryptographic architecture | Partial | ADR-006. Gap: KMS-held keys and database encryption at rest (M19). |
| V1.7 | Errors, logging and auditing architecture | Implemented | ADR-007; pseudonymous audit entries (L11). |
| V1.8 | Data protection and privacy architecture | Implemented | Data inventory checked against the live schema; records of processing; retention schedule enforced by a job. |
| V1.9 | Communications architecture | Partial | TLS at the edge planned (M19); HSTS sent. |
| V1.14 | Configuration architecture | Partial | Thresholds in config with `source`/`validated`; production refuses development secrets. Gap: environment segregation and secret store (M19). |
| V2.1 | Password security | Not applicable | Passwordless (one-time codes, federated sign-in). |
| V2.2 | General authenticator security | Implemented | Rate limits per email and IP, attempt lockout, codes invalidated by a newer one (integration tests). |
| V2.5 | Credential recovery | Not applicable | No password to recover; the email code is the recovery path. |
| V2.7 | Out-of-band verifier | Implemented | 6-digit code, 10-minute lifetime, single use, stored as keyed hash, 5 attempts. Thresholds await review (`validated: false`). |
| V2.9 | Cryptographic verifier | Planned | Sign in with Apple/Google: JWKS signature, `iss`, `aud`, `exp`, nonce checks (ADR-003); stub answers 501 today. |
| V3.1 | Fundamental session management | Implemented | Tokens only in headers or bodies, never URLs; request logs drop query strings. |
| V3.2 | Session binding | Implemented | 256-bit random refresh tokens (CSPRNG), bound to a device session. |
| V3.3 | Session termination | Implemented | Logout revokes the token family; deletion ends every session; ended sessions purged after the retention period. |
| V3.5 | Token-based session management | Implemented | Short-lived JWT checked against the session; rotation with reuse detection. |
| V4.1 | General access control design | Implemented | Deny by default: routes without `authenticate` are limited to health, docs and sign-in. |
| V4.2 | Operation-level access control | Implemented | User id taken from the token only; sync rejects a device id that is not the session's (403). |
| V4.3 | Other access control considerations | Partial | No admin interface exists yet. Gap: admin and coach access (M15, M18) with their own review. |
| V5.1 | Input validation | Implemented | zod schemas on every route (strict objects for analytics); validation errors never echo input. |
| V5.3 | Output encoding and injection prevention | Implemented | Parameterised queries (Drizzle); JSON-only API; SAST gate (`pnpm security:sast`). |
| V6.1 | Data classification | Implemented | Data inventory (`apps/api/src/privacy/inventory.ts`) and records of processing. |
| V6.2 | Algorithms | Partial | HMAC-SHA-256, HS256 JWT, Node crypto. Gap: review of HS256 vs asymmetric signing when several services verify tokens (M19). |
| V6.3 | Random values | Implemented | `crypto.randomInt`, `crypto.randomBytes`, `randomUUID`. |
| V6.4 | Secret management | Partial | Secrets from the environment; production refuses the `.env.example` values; gitleaks in CI. Gap: secret store and rotation schedule (M19; rotation interval to be set with `validated: false`). |
| V7.1 | Log content | Implemented | Scrubber on every record, child binding and interpolated value; tests fail on emails, names, weights, pain reports or free text in logs. |
| V7.2 | Log processing | Partial | Structured JSON logs with route and status. Gap: security-event log (sign-in failures, reuse detection) to the defensibility log (M20). |
| V7.3 | Log protection | Planned | Central log store with access control and integrity (M19). |
| V7.4 | Error handling | Implemented | Stable error codes; 500s log type and code only; custom 404. |
| V8.1 | General data protection | Partial | `Cache-Control: no-store` on every response. Gap: encrypted backups and their rotation (M19). |
| V8.2 | Client-side data protection | Partial | See MASVS-STORAGE. |
| V8.3 | Sensitive private data | Implemented | Consent per data type, export, correction, deletion with backup purge (integration tests); minimisation of logs and analytics. |
| V9.1 | Client communication security | Partial | HSTS; https-only clients. Gap: edge TLS configuration and certificate management (M19). |
| V9.2 | Server communication security | Planned | TLS to PostgreSQL and Redis in production (M19). |
| V10.2 | Malicious code search | Partial | SAST and dependency audit in CI. Gap: review of install scripts beyond pnpm's allowlist (`onlyBuiltDependencies`). |
| V10.3 | Deployed application integrity | Planned | Signed store builds (EAS) and signed container images (M19). |
| V11.1 | Business logic security | Partial | Rate limits on sign-in, export, deletion and analytics. Gap: limits on sync push volume per user. |
| V12 | Files and resources | Not applicable | No file upload or download yet; photo backup (M04) must add this section. |
| V13.1 | Generic web service security | Implemented | JSON only, OpenAPI document, authentication on every data route. |
| V13.2 | RESTful web service | Implemented | Method-specific routes, schema-validated bodies, unsupported content types rejected by Fastify. |
| V14.1 | Build and deploy | Partial | Frozen lockfile installs, CI on every pull request. Gap: deployment pipeline (M19). |
| V14.2 | Dependency | Implemented | Audit gate (high/critical), weekly audit, Dependabot, licence gate, pinned versions. |
| V14.3 | Unintended security disclosure | Implemented | No stack traces or input echoed in responses; generic error codes. |
| V14.4 | HTTP security headers | Implemented | HSTS, nosniff, `no-referrer`, `DENY` framing, `default-src 'none'` CSP, `no-store` (integration test). |
| V14.5 | HTTP request header validation | Partial | `trustProxy: false`. Gap: proxy configuration and CORS policy when a browser client exists (M15). |

## Not covered by a self-assessment

| Item | Status | Reason |
|---|---|---|
| External penetration test of app and API | Deferred to M17 completion (Phase 4) | Needs a production-like environment (M19) and an external tester; spec: findings closed before launch. |
| Certification (e.g. ISO 27001) | Out of scope | M17 spec, "later decision". |
