# ADR-006 — Encryption and key management

- Status: Accepted (M17 baseline). Parts marked *planned* are decisions to implement in the named module.
- Date: 2026-09-23
- Deciders: M17 engineer (PE-11 role); review by the external pen-tester in Phase 4

## Context

The spec asks for TLS 1.2+ (prefer 1.3) in transit, encryption at rest, end-to-end encryption for photo backups and secrets management. CLAUDE.md rule 7: progress photos stay encrypted on the device unless backup is enabled. No photo, health or wearable feature exists yet, and there is no production infrastructure (M19). This ADR fixes the design now so those modules build on it.

## Decision

| Layer | Decision | Status |
|---|---|---|
| In transit, client → edge | TLS only; TLS 1.2 minimum, 1.3 preferred, configured at the edge (load balancer / CDN). | Planned (M19) |
| In transit, API | HSTS on every response (`max-age` in `privacy.config.ts`, `validated: false`), plus `nosniff`, `no-referrer`, `DENY` framing, `default-src 'none'` CSP, `no-store`. | Implemented (integration test) |
| In transit, app | The app refuses a non-https API URL except loopback in development builds; no cleartext exceptions in `app.json`. | Implemented (tests) |
| In transit, internal | TLS to PostgreSQL and Redis in production. | Planned (M19) |
| Certificate pinning | Not now: pinning can lock users out on certificate changes; decide with the pen-tester. | Deferred (Phase 4) |
| At rest, server | Managed PostgreSQL with storage encryption; backups encrypted and rotated after `backupRetentionDays`. | Planned (M19) |
| At rest, server, health payloads | Field-level envelope encryption of health-category sync payloads: AES-256-GCM with a per-user data key wrapped by a KMS key. Destroying the per-user key also makes backup copies unreadable (crypto-shredding, ADR-005). | Planned (M01/M05, when the first health collection is added) |
| Credentials at rest | Codes, refresh tokens, emails in auxiliary tables and rate-limit keys stored only as HMAC-SHA-256 with a server-side pepper (ADR-003). | Implemented |
| At rest, device database | expo-sqlite with SQLCipher (`useSQLCipher` config plugin), keyed with a random 256-bit key held in expo-secure-store (iOS Keychain, "this device only, after first unlock"; Android Keystore). Enabled in the release that first stores health data on the device. | Planned (M01) |
| At rest, device, tokens | Refresh token in expo-secure-store, never in SQLite or AsyncStorage. | Planned (M01, ADR-003) |
| Device backups | Android `allowBackup: false`, so the local database is not copied to device or cloud backups. iOS: exclude the database and photo files from backups. | Android implemented (test); iOS planned (M04) |
| Progress photos | Each photo encrypted on the device with AES-256-GCM (random 96-bit nonce per file) under a photo key held in expo-secure-store; never written unencrypted to shared storage; thumbnails too. | Planned (M04) |
| Photo backup (E2E) | Photos are encrypted on the device before upload; the server stores only ciphertext. The photo key is wrapped by a key derived from a user recovery secret (memory-hard KDF), so the service cannot decrypt backups. Losing the secret loses the backup: the UI must say so. Behind the `photos` consent (`photos.backup`). | Planned (M04) |
| Crypto libraries | Platform keystores via expo-secure-store; audited, permissively licensed JS primitives where the platform has none (candidates: `@noble/ciphers`, `@noble/hashes`, MIT). Each passes the licence gate (L6) when added. No home-made algorithms. | Planned (M04) |
| Secrets | From the environment, provided by a secret store per environment (M19). Production refuses the public `.env.example` values (M00). gitleaks scans the full history in CI (ADR-007). Rotation steps for `AUTH_JWT_SECRET` and `AUTH_TOKEN_PEPPER` are in the breach runbook. | Partial: secret store and rotation interval M19 |

## Alternatives considered

- **Rely on full-disk encryption of phones only**: does not protect data from other apps' backups, from a shared unlocked phone, or from rooted devices; health data deserves an app-level layer.
- **Server-side encryption of photo backups with our keys**: simpler recovery, but the service could read the photos; rule 7 and the spec ask for end-to-end.
- **Pinning from day one**: see above; revisit with the pen-test.
- **Asymmetric JWT signing now**: one service verifies tokens today; HS256 with a strong secret is adequate; revisit when several services verify tokens (ASVS V6.2 gap).

## Consequences

- M01 must turn on SQLCipher and secure-store keys before the first health field is stored on the device; M04 must implement photo encryption and E2E backup as above; M19 must provide TLS, encrypted backups, KMS and the secret store.
- No key-rotation interval is set yet. When the secret store exists, the interval goes into config with `source` and `validated: false` (CLAUDE.md rule 4).
