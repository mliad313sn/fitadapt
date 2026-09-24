# FIX — API security review (FIX-C, apps/api): status

- Run date: 2026-09-24
- Scope: apps/api. Findings API-1 … API-12 (review/api-security.md). Server side of SAF-5 (review/safety-engine.md), MOB-08 (review/mobile.md) and PKG-06 (review/packages-tooling.md).
- Branch: worktree based on `0315a69`. Committed locally, signed, not pushed.
- ADRs: [ADR-027](../adr/ADR-027-s3-lock-survives-health-withdrawal.md) (S3 lock survives a health withdrawal), [ADR-028](../adr/ADR-028-api-abuse-limits-and-trusted-proxy.md) (abuse limits, bounded waits, trusted proxy).
- **No S1–S7 constant, engine coefficient or prescription changed.** `ENGINE_VERSION` is unchanged; no golden changed. Nothing was set `validated: true`, and nothing is marked counsel-approved.

## Fixed

| ID | Fix | Regression test (fails before, passes after) |
|---|---|---|
| API-1 (P0) | The sync validator receives the store transaction and reads only through it (packages/sync `MutationValidator(userId, m, tx)`). Consent, legal gate, screenings and history are read on `tx.db`. The pool gets a connection timeout, `statement_timeout` and `idle_in_transaction_session_timeout` (`config/db.config.ts`). | `security.test.ts` › 30 concurrent consent-gated pushes complete (before: hung, pool waiting 30); pool settings come from config. packages/sync unit test for the hand-off. |
| API-2 (P1) | `lockUser` is the per-user advisory lock, shared by sync pushes. `recordConsent` takes it. Photo key and photo uploads, pair create, join and append take it too, and read consent inside their writing transaction. | `security.test.ts` › withdrawal racing a push (before: 1 health row left), a photo upload (before: 201) and a pair event (before: stored). |
| API-3 (P1) | The ledger stores `{mutationId, status, revision, reason}` plus `currentRef` (collection, record id) and no data. A replayed conflict rebuilds `current` from sync_changes. Migration `0010_fix_ledger_no_record_copy` scrubs old rows. | `security.test.ts` › no data in the ledger after a conflict and a withdrawal; replay still returns the current record; the migration scrubs a legacy row. |
| API-4 (P1) | Join is limited per account (10 / 15 min) and per address (30 / 15 min) before any lookup. Join codes are 8 characters (`PAIR_JOIN_CODE_LENGTH`, packages/shared). | `security.test.ts` › the 11th attempt answers 429, even with the right code; the per-address limit applies across accounts. |
| API-5 / SAF-5 | The server bounds these client times with `clientTimeInRange` (skew, offline window): session `plan.generatedAt` and `startedAt`, nutrition `createdAt` and `today` (`today` must also be the local date of `createdAt`). S5 is also checked at min(generatedAt, server now). A screening's birth date must equal the stored profile's. Sessions and nutrition plans are refused while the latest screening head states another birth date. | `nutrition.test.ts` › the review's minor scenario (screening refused; future `today`, far `createdAt` refused); birth-date correction fails closed until a re-screen. `session.test.ts` › a plan 8 days ahead, or older than the window, is refused (before: applied). |
| API-6 | Pair WebSocket: the session is re-checked on every message, on a timer, and at token expiry. A logout or reuse revocation on this instance closes the socket at once (4401). | `pair.test.ts` › logout closes the socket (4401); an expired token or a session revoked elsewhere closes it on the next message. |
| API-7 | Every authenticated route authenticates in `onRequest`, before the body is read. Photos: 1 GiB per account and 120 uploads per hour. | `security.test.ts` › 16 MB without a token answers 401 (before: 413); byte quota; upload rate. |
| API-8 | `TRUST_PROXY_HOPS` (env, default 0) sets the exact trusted hop count for `request.ip` and the WebSocket client address. Documented in ADR-028 and `.env.example`. | `security.test.ts` › one hop: per-client sign-in buckets, a spoofed left-most XFF does not help; default: XFF ignored. Unit: parsing, `clientAddress`. |
| API-9 | Pending hellos are capped per process and per address (upgrade answered 429). Per-socket queue depth and message rate are bounded (4429). Empty rooms are freed. | `pair.test.ts` › 1000 unawaited messages close the socket with 4429 and the room returns to 0; pending cap per address. |
| API-10 | Per-user limits: consent decisions 60/h, acceptances 60/h, notices 300/h, pair create 20 / 15 min. A withdrawal of a granted consent is never refused. | `security.test.ts` › 429 after each limit; the withdrawal still goes through. |
| API-11 | Per-push cache of stored rows (`profile/stored-rows.ts`): one full load, then incremental loads, checked against count and last revision (an erasure forces a reload); each row parsed once per schema. `latestState` filters by record id in SQL. | `security.test.ts` › cache behaviour; the whole suite is unchanged (same outcomes). |
| API-12 | Photo count quota under the user lock. A join-code collision is drawn again (5 draws). `set_logs` and `preferences` are validated (`SetLogSchema`, new strict `PreferencesRecordSchema`). An unknown collection, or one without a validator, fails closed (`sync.collection_not_validated`). | `security.test.ts` › 6 parallel uploads at the limit store exactly one (before: 6); collision redraw. Unit: every `SYNC_COLLECTIONS` entry has a validator; unvalidated collection refused. `privacy.test.ts` › the free-text set log is refused and absent from the export. |
| MOB-08 (server) | `safety_locks` keeps only the S3 facts (kind, time, causal ids; no symptom), and only while the lock is on. It survives a health withdrawal. The session gate reads both logs and retained facts. `GET /v1/safety/intensity-lock` returns `{locked, since, flagIds}`. Export section `safetyLocks`. Migration `0011_…` backfills. See ADR-027. | `recovery.test.ts` › red flag, then withdraw, re-grant and re-onboard: sessions are refused until an attestation names the retained flag; nothing is kept once the lock is lifted; migration backfill. |

Coordinated with FIX-E: `/v1/sync/push` has an explicit 1 MiB body limit (`config/sync.config.ts`). New tests push only schema-valid records (except the deliberately invalid ones, which assert only `rejected`).

### Existing tests touched (none deleted, skipped or loosened)

Each test file below changed only as described.

- **Fixed-date suites.** `session`, `recovery` and `cardio` suites pin the harness clock (`TestClock.set`) to their fixture week. Otherwise the new client-time bound refuses fixtures dated 2026-09-28 … 2026-10-12.
- **Consistent birth dates.** `profile.test.ts` screening now states the profile's birth date. It was 16 years in the profile against 17 in the screening, the inconsistency API-5 now refuses.
- **Valid set logs.** `sync.test.ts` and `privacy.test.ts` push valid `SetLog` records. `privacy.test.ts` export expectations move from 3 stored changes to 2, and the test now also asserts the free text is refused and absent.
- **Eight-character codes.** `pair.test.ts` uses the eight-character code format.
- **New route.** `auth.test.ts` OpenAPI list gains `/v1/safety/intensity-lock`.
- **New table.** `privacy.test.ts` inventory test stores a red flag, so the new export section is non-empty.
- **Harness.** `harness.ts`: `TestClock.set`, `trustProxyHops` option, and `safety_locks` added to TRUNCATE.

## New `validated: false` items (all engineering defaults, source `docs/status/FIX-api-security.md`)

| Config | Key | Value |
|---|---|---|
| `apps/api/src/config/db.config.ts` | `poolMax`, `connectionTimeoutMs`, `statementTimeoutMs`, `idleInTransactionTimeoutMs` | 10, 5 s, 15 s, 30 s |
| `apps/api/src/config/sync.config.ts` | `pushBodyLimitBytes` | 1 MiB |
| `apps/api/src/config/pair.config.ts` | `joinAttemptsPerUserPerWindow`, `joinAttemptsPerIpPerWindow`, `createsPerUserPerWindow`, `pairRateLimitWindowSeconds`, `joinCodeDrawAttempts` | 10, 30, 20, 900 s, 5 |
| same | `sessionRecheckIntervalMs`, `maxPendingHellos`, `maxPendingHellosPerIp`, `maxQueuedMessagesPerSocket`, `messagesPerSocketPerWindow`, `socketRateWindowMs` | 30 s, 200, 10, 32, 60, 10 s |
| `apps/api/src/config/photos.config.ts` | `maxBytesPerUser`, `uploadsPerUserPerWindow`, `uploadRateLimitWindowSeconds` | 1 GiB, 120, 3600 s |
| `apps/api/src/config/privacy.config.ts` | `consentDecisionsPerWindow`, `acceptancesPerWindow`, `noticesPerWindow` | 60, 60, 300 per `privacyRateLimitWindowSeconds` |
| packages/shared `pair.ts` | `PAIR_JOIN_CODE_LENGTH` (a format constant, like `MAX_CHANGES_PER_PULL`) | 8 |
| **Retention (MOB-08, ADR-027)** | `safety_locks` kept after a health-consent withdrawal while the lock is on; proposed basis GDPR Art. 9(2)(f) with 17(3)(e) | **validated: false: B1 and counsel** (also in docs/compliance/retention-schedule.md) |

## Remaining open items

- **API-11, window.** The history window the re-checks read is not bounded. The deload (amber weeks, performance drop) and the HIIT gate read arbitrarily old records, so bounding them would change prescriptions and needs the engine owner (FIX-A). The quadratic factor is removed; cost is now linear per push.
- **API-5, back-dating.** A back-dated `generatedAt` within the 30-day offline window can still evaluate the deload and readiness at an earlier day. S3 and S2 are not date-filtered. Tightening needs a product decision on how long a session may be synced after it was generated.
- **Engine side of SAF-5.** An assert that `today` is within ±1 day of the engine clock is FIX-A's scope. The server check above does not depend on it.
- **MOB-08, device side.** The device must read `GET /v1/safety/intensity-lock` and attest naming `flagIds` (FIX-D). Until then a reinstalled device shows unlocked, and its sessions are refused on sync.
- **MOB-08, residuals R1–R3** (ADR-027):
  - R1: account deletion followed by a new sign-up starts unlocked.
  - R2: the red-flag deload after an attestation is not enforced once the logs are erased.
  - R3: the retained reading can be stricter than the logs', never looser.

  Proof sketch for R3: rows are pruned only at an unlocked state. `intensityLockStatus` over a suffix sees fewer attestations, so its `latestAttestAt` is no later; every flag of the pruned prefix was named by, or older than, a prefix attestation.
- **Pair: pre-existing possible deadlock.** A host's partner_sharing withdrawal (host lock, then host chain lock, then session rows) can meet a partner's join (partner lock, then session row, then host chain lock for `challenge_started`). PostgreSQL detects it and aborts one; the client retries. Not introduced here; lock ordering is for M09.
- **WebSocket revocation push is per instance.** Other instances close a revoked socket within `sessionRecheckIntervalMs` or on its next message.
- **Merge with FIX-E.**
  - Drizzle journal and snapshot chain: FIX-E adds `0009_fix_defensibility_heads`; mine are 0010 and 0011.
  - FIX-E's collection schemas vs `PreferencesRecordSchema` (locale, units, gym, displayName): the two definitions must agree.
  - Pre-existing tests that assert the API's own `*.invalid` codes (e.g. `readiness_check.invalid`, `body_metric.invalid`) will see FIX-E's `<collection>.invalid` once enforcement is on.

## Checks (this worktree)

Run against the private database `fitadapt_fix_api_test`:

| Check | Result |
|---|---|
| `pnpm --filter @fitadapt/api test:integration` | 19 files, 176 tests passed (baseline before the fixes: 16 files, 139). Coverage: lines 96.93 %, statements 95.23 %, branches 90.88 %, functions 92.74 %. |
| apps/api unit tests (`pnpm test`) | 4 files, 27 tests; lines 94.91 % |
| packages/sync tests | 2 files, 32 tests; lines 97.3 % |
| packages/shared tests | 11 files, 64 tests; lines 98.96 % |
| `pnpm -w typecheck` | 26/26 tasks |
| `pnpm -w lint` | 26/26 tasks |
| `pnpm security:sast` | exit 0 |
| `pnpm legal:claims` | exit 0 |
| `pnpm compliance:check` | exit 0 |

Every regression test was also run against the code before its fix (source reverted, tests kept) and failed there. Two exceptions pass on both, as guards:
- the push that reaches its consent check while a withdrawal is committing (the old store already locked before validating);
- "X-Forwarded-For is ignored by default".
