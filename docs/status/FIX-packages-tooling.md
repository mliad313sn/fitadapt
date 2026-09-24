# FIX — packages and tooling review (PKG-01 … PKG-15): status

- Run date: 2026-09-24
- Scope: FIX-E of the post-review fix wave — packages/legal (defensibility, claims), packages/sync, packages/privacy (scrubber), packages/shared (record chain, PKG-12), tooling/legal, tooling/security, tooling/eslint-plugin, .github/workflows, pmo/meridian/meridian-client.mjs and drive.mjs (PKG-14 only).
- Input: `review/packages-tooling.md` (findings PKG-01 … PKG-15, probes in `pkgrev/`).
- Commits: one per finding or tight group, signed, not pushed.
- ADRs: [ADR-024](../adr/ADR-024-defensibility-anchored-heads-and-purge.md) (amends ADR-009), [ADR-025](../adr/ADR-025-sync-rejections-quarantine-and-timeouts.md) (amends ADR-002). Amendment notes in ADR-007 and ADR-009; M20 deviation 6 updated.
- Nothing was set `validated: true`; nothing is marked counsel-approved; no safety constant (S1–S7) was touched.

## Findings

| ID | Status | What changed |
|---|---|---|
| PKG-01 | Fixed | `defensibility_heads` (length, head hash, open holds, tombstone) maintained by trigger in the append transaction; inserts that do not extend the head are refused; `verifyChain(events, expected)` reports `truncated` / `head_mismatch`; `verify` and the legal-hold export compare against the head read in one snapshot (export carries `anchoredHead`). GUC delete gate removed: DELETE only of a whole, unheld, non-global chain with a matching `retention.purged` record (deferred check); TRUNCATE refused; heads not writable directly. Purge only through `defensibility_purge_chain()`; where the migrating role can create roles, it is owned by the NOLOGIN role `fitadapt_defensibility_purger` and every other role (the application's included) is refused. Migration `0009_fix_defensibility_heads`. Integration tests passed with a non-superuser migrating role and with a superuser one. |
| PKG-02 | Fixed | Validate on write (`invalid_mutation`); SQLite store quarantines unparsable stored rows (`invalid_local_mutation`); byte budget per push; a request-level 400/404/409/413/414/415/422 splits the batch and quarantines only the offending mutation (`http_<status>`). |
| PKG-03 | Fixed | A rejection reverses the record on the device (out of `get`/`list`; cursor moved back so pull restores the server copy); `rejectedMutations()` / `rejectedCount()`; home screen notice `home.syncRejected` (FR/EN). |
| PKG-04 | Fixed | Name keys by suffix (`ownerName`, `partnerName`…) with a technical allowlist; hyphenated, apostrophe, inner-capital, all-capitals, punctuated names; runs of names in sentences and the pino `msg` (detected and scrubbed); `%40`, fullwidth `@`, IDN emails; FR national phones; IPv6; `sk-`, GitHub, Slack, AWS key prefixes. Corpus test with every probe and a clean corpus. |
| PKG-05 | Fixed | Claims text normalised (NFKC, invisible characters, dashes, apostrophes, whitespace runs and line breaks); broader FR/EN inflections, "up to" / "jusqu'à", number words, "burn more fat", noun-first "injury prevention". Every evasion of the review is a test. `pnpm legal:claims` still passes on the repository. |
| PKG-06 | Package side fixed; server side is FIX-C's | `CollectionPolicy.schema` required (a policy without it does not type-check); shared record schemas per collection; `recordDataIssue()`; `SyncServer({ enforceCollectionSchemas: true })` rejects `<collection>.invalid` (off by default so the API can switch it on with its fixtures). |
| PKG-07 | Fixed | `HttpTransport` aborts after `requestTimeoutMs` (headers and body) with `OfflineError('timeout')`; the shared sync run settles; the next sync is a new run. |
| PKG-08 | Fixed | Recursive-descent SPDX evaluator (parentheses, AND over OR, WITH only if listed, malformed fails closed). |
| PKG-09 | Fixed | SAST processor adds a non-suppressible `sast/justified-suppression` error for bare or reason-less disable directives and inline rule configuration. `reportUnusedDisableDirectives` stays off in the SAST config (directives for main-lint rules would always look unused there); the main lint reports unused directives. |
| PKG-10 | Fixed | `Object.hasOwn` for event types (`isDefensibilityEventType`). |
| PKG-11 | Fixed | `occurredAt` must be ISO 8601 UTC with `Z`, in `chainEvent` and `verifyChain` (`invalid_timestamp`); the purge function also requires it for the cutoff. |
| PKG-12 | Fixed | Legacy records chained per instant; ranks order only ranked records of an instant; an unranked one stays a head (A/B(1)/C(2) → heads [A, C]). |
| PKG-13 | Fixed | `permissions: contents: read`; every action pinned by commit SHA with the tag in a comment; a test keeps both. |
| PKG-14 | Fixed | `MERIDIAN_URL` must be https (plain http only for loopback) before any request; `MERIDIAN_HOME` version mismatch stops `drive.mjs` before its engine is imported, unless `--allow-meridian-version-mismatch` / `MERIDIAN_ALLOW_VERSION_MISMATCH=1`. |
| PKG-15 | Fixed | The i18n rule also checks `Alert.alert` / `Alert.prompt` (incl. button text), `ToastAndroid.show`, `options` / `screenOptions` / `setOptions` titles and labels, notification content, and runs on app `.ts` files. No violation found in apps/mobile, apps/coach-web or packages/ui. |

## Existing tests whose assertions changed (none deleted, skipped or loosened)

- `packages/sync` › "marks rejected mutations and clears the pending marker": asserted that the rejected record stays live; it now asserts the reversed record, the rejection report and the server copy restored by pull (PKG-03).
- `packages/sync` › "registers profile and equipment profiles as mutable …": `toEqual({ appendOnly })` → `toEqual({ appendOnly, schema: <shared schema> })` (PKG-06).
- `apps/api/test/integration/harness.ts` `truncateAll`: the defensibility tables refuse TRUNCATE now; between tests the harness lifts their user triggers inside one transaction.

## New `validated: false` values

| Package | Key | Value | Source |
|---|---|---|---|
| packages/sync (`src/config.ts`) | `pushBatchMaxBytes` | 524,288 bytes | engineering choice: half of Fastify's default `bodyLimit` (1 MiB) |
| packages/sync (`src/config.ts`) | `requestTimeoutMs` | 30,000 ms | engineering choice, no external source |

## Open items

- **FIX-C (apps/api):** turn on `enforceCollectionSchemas` in `app.ts` (and update fixtures that push free-form `set_logs`/`preferences`), replace `default: return null` in `sync-hooks.ts`, and set Fastify `bodyLimit` for `/v1/sync/push` to match `pushBatchMaxBytes`.
- ~~**`preferences` has no shared schema** (generic record schema in the policy).~~ Done at integration: the policy uses FIX-C's strict `PreferencesRecordSchema`, and the API runs `SyncServer({ enforceCollectionSchemas: true })` (malformed records are refused as `<collection>.invalid`).
- **FIX-D / M01 + A1:** when a new screening or assessment is rejected, the device falls back to the previous accepted one; if the rejected one was stricter, require a re-screen (ADR-025, Consequences).
- **M19:** a runtime application role that does not own the tables, and external anchoring of chain heads (daily digest in write-once storage). With both, a table owner rewriting events and heads consistently is also covered (ADR-024, Consequences).
- The scrubber still misses a single first name inside a message ("sent to Jeanne") and all-capitals names with a word under 4 letters (ADR-007 note).
