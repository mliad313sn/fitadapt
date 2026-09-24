# ADR-025: Sync — validate on write, quarantine what the server refuses, time out hung requests

- Status: Accepted (fix, FIX-packages-tooling, findings PKG-02, PKG-03, PKG-06 package side, PKG-07)
- Date: 2026-09-24
- Deciders: fix engineer, on the packages/tooling review. Needs review by the M01 owner (what the user is told) and A1 (a rejected screening or assessment on the device, see Consequences).
- Amends: ADR-002 (sync).

## Context

ADR-002 gave `rejected` a meaning only for conflicts. Since M01 the server also rejects mutations for validation and safety reasons (`screening.profile_mismatch`, `safety.s1.assessment_reserve_too_low`, `safety.s7.under_minimum_age`, `privacy.consent_required`…), and that rejection is final (idempotency ledger). The review found:

- **PKG-02 poison pill.** `write()` never validated the mutation. A non-UUID record id made every outbox read of the SQLite store throw, and every push fail with 400 for ever. A request the server refuses as a whole (400 schema, 413 body size) was retried unchanged, so one bad mutation blocked the whole outbox.
- **PKG-03.** A rejected record stayed live on the device, forever: the device kept using a screening or assessment the server's safety re-check refused, and nothing told the user.
- **PKG-06.** A collection policy had no schema, so a new collection was accepted with any JSON.
- **PKG-07.** No request timeout, and all `sync()` calls share one run: one hung request stalled sync until the app was killed.

## Decision

1. **Validate on write.** `SyncClient.write` parses the mutation with `SyncMutationSchema` before it reaches the outbox and throws `SyncPolicyError('invalid_mutation')`. The SQLite store no longer throws on a stored row that does not parse (written by an older build): the row is marked `rejected` / `invalid_local_mutation` and left out of listings.
2. **Byte budget per push** (`syncConfig.pushBatchMaxBytes`, 512 KiB, `validated: false`) as well as the 500-mutation count; a single larger mutation still goes alone.
3. **Request-level refusals are split, then quarantined.** On HTTP 400, 404, 409, 413, 414, 415 or 422 for a whole request, the batch is split in halves, in order, until the offending mutation is alone; that one is settled as `rejected` with `http_<status>` and the others go through. 401, 403, 408, 429 and 5xx are retried as before.
4. **A server rejection is reversed on the device.** When the rejected mutation is the record's latest local change, the record is marked deleted (it leaves `get` and `list`), its revision is cleared and the pull cursor moves back to just before the revision the device had, so the same sync's pull restores the server's copy if there is one. The written data stays in the outbox item: `rejectedMutations()` / `rejectedCount()` list every rejection that is not a conflict, with the server's reason, and the home screen says how many changes were not accepted and removed (FR/EN, `home.syncRejected`). A rejected mutation that is no longer the latest local change leaves the record to that newer change.
5. **Every collection policy carries a schema** (`CollectionPolicy.schema`, required by the type). The registered collections use the shared record schemas (`SetLogSchema`, `ScreeningRecordSchema`, …); `preferences` has none yet and uses the generic record schema (open item). `recordDataIssue()` exposes the check and `SyncServer({ enforceCollectionSchemas: true })` rejects `<collection>.invalid` before the domain validator. It is off by default so that the API (FIX-C) turns it on with its fixtures.
6. **Request timeout.** `HttpTransport` aborts a request (headers and body) after `syncConfig.requestTimeoutMs` (30 s, `validated: false`) with a timer and an `AbortController` (older Hermes lacks `AbortSignal.timeout`), and reports `OfflineError('timeout')`. The shared run then settles, and the next `sync()` is a new run.

## Alternatives considered

- **Keep rejected records visible with a `rejected` flag.** Needs a new SQLite column and every consumer to filter it; forgetting one keeps the refused data in use, which is the defect.
- **Full re-pull after a rejection.** Correct but costly; moving the cursor back to the record's own last revision is enough, since earlier changes are skipped by revision.
- **Validate `data` against the collection schema on the device too.** Right in the end, but today's fixtures and several app paths write free-form data to some collections; it is left to the owners together with server enforcement.

## Consequences

- One bad mutation can no longer block the outbox; the user sees what was not accepted.
- **Safety note for A1 and the M01 owner:** when a new screening or assessment is rejected, the device falls back to the previous one (the latest accepted record). If the rejected record was stricter than the previous one, the device is looser until the user re-screens. The home screen tells the user; requiring a re-screen after a rejected screening is recommended as a follow-up (FIX-D / M01).
- The API should set Fastify's `bodyLimit` for `/v1/sync/push` explicitly to match the client budget (FIX-C).
