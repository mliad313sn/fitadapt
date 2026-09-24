# FIX — latest-record ordering (safety defect): status

- Run date: 2026-09-24
- Branch: `claude/vigilant-franklin-76iok4` (committed locally, signed, not pushed)
- Kind: safety defect fix (not a module). Commits `fix(safety): …`, `test(safety): …`, `docs(safety): …`.
- ADR: [ADR-023](../adr/ADR-023-latest-record-ordering.md) (record model changed: optional `supersedes` / `eventId` / `after` / `attests` / `checkId` fields, migration `0008_fix_consent_supersedes`). Amendment notes in ADR-004, ADR-012, ADR-022.
- **No threshold or coefficient was added or changed**; nothing was set `validated: true`; nothing is marked counsel-approved. S1–S7 constants untouched.

## The defect

PO finding: `apps/mobile/__tests__/nutrition.test.tsx` › "a stored numeric plan turns supportive at once when a re-screen switches deficit features off" failed in a full-workspace run — after a re-screen answering "advised against calorie restriction" the screen still showed "Energy: about 2,820 kcal a day".

Root cause, **verified** (the test failed deterministically on the PO's working tree: `Tests: 2 failed, 10 passed` — the original test and the PO's new S4 test, whose `selectSafetyProfile(...).deficitNutritionAllowed` was `true`): `profile-store.ts` sorted screenings only by `completedAt` (line 209 at `e852b04`) and `selectSafetyProfile` took `screenings[screenings.length - 1]` (`selectors.ts:17`). The test clock is frozen, so both screenings shared an instant and the older, looser one could be "latest"; the whole app then applied its SafetyProfile (S1/S4/S7). A device clock that goes backwards, or records from another device, cause the same. Other stores broke ties on a random record id — still chance — and the server picked "the last pushed" screening, which can differ from the device.

## Audit: every place that selects a "latest"/"current" record

(a) identical timestamps · (b) device clock goes backwards · (c) records from another device via sync. File:line at `e852b04` (before the fix).

| # | History (invariant) | Where (before) | (a) | (b) | (c) | Now |
|---|---|---|---|---|---|---|
| 1 | Screenings → SafetyProfile (S1/S4/S7), device | `apps/mobile/src/profile/profile-store.ts:209` (sort by `completedAt` only), `selectors.ts:17` (`screenings[length-1]`) | **unsafe** (PO case) | **unsafe** | **unsafe** | Chain (`ScreeningRecord.supersedes`, record ids) — `safetyProfileFromScreenings` (packages/safety); several heads → `strictestSafetyProfile` (+ reason `safety_profile.ambiguous_latest`, FR/EN). |
| 2 | Re-screen due date (M01) | `selectors.ts:24` | arbitrary | **unsafe** (the older screening with the later date → due later) | unsafe | `lastScreenedAt`: chain head; several → the earliest (due soonest). |
| 3 | Screenings on the server (programs, sessions, assessments, nutrition plans are validated against it) | `apps/api/src/profile/sync-hooks.ts:84` (`desc(revision)`, last pushed) | safe | safe for one device | **unsafe** (an offline device pushes an older screening last; device and server disagree) | Same function as the device on all stored screenings. |
| 4 | Consents (a withdrawal vs an older grant) | `packages/privacy/src/consent.ts:61` (newest `recordedAt`, tie → later in list); server `apps/api/src/privacy/service.ts:159` (`recordedAt`, `seq`) | safe (tie → append/insert order) | **unsafe** (a withdrawal dated before the grant it withdrew loses) | **unsafe** | Chain (`ConsentRecord.supersedes`, column `consent_records.supersedes`); several heads → withdrawn if any withdrawal, else the oldest text version. Legacy: time then ledger position (unchanged). Web/API decisions are stored with the server's heads. |
| 5 | Consent upload order | `apps/mobile/src/account/account-sync.ts:79` (sorted by `recordedAt`) | safe | **unsafe** (withdrawal uploaded before its grant) | — | Chain order (legacy: time, then ledger position — the existing test is kept). |
| 6 | Partner-sharing consent shown in Fair Pair set-up | `apps/mobile/src/pair/PartnerSetup.tsx:197` (`.at(-1)` of the ledger) | safe (append order) | safe (append order) | n/a (ledger local) | `consentState` (same rule as everything else; also honours the minimum version). |
| 7 | Nutrition plans (S4) | `apps/mobile/src/nutrition/nutrition-store.ts:120` (`createdAt` first, chain depth only for ties), `:165`, `NutritionProvider.tsx:50,92`, `screens/NutritionScreen.tsx:222` | safe (depth) | **unsafe** (a plan made with the clock moved back sorts first) | **unsafe** (forks) | Chain first (`orderPlans`, `latestPlan`, `planHeads`); several heads → no stored plan shown, engine answer for the current profile; the next plan names all heads. |
| 8 | What the nutrition screen shows (S4) | `NutritionProvider.tsx` `useCurrentNutrition` (stored plan shown until the effect re-stored it) | — | — | — | PO's pending `currentNutrition()` kept and finished: a stored plan is shown only while `planUpkeep` says it is current. |
| 9 | S3 lock (red flag vs attestation) | `apps/mobile/src/profile/profile-store.ts:240` (execution logs by `at`, id), `packages/safety/src/session-safety.ts:216`; server `session-hooks.ts:122` (push order) | safe (the time reading locks on equal instants) | **unsafe** (a new flag dated before an old attestation sorts before it: both readings unlock) | **unsafe** | Red flags carry `eventId`; attestations `attests` (the flags they cover). A flag with an id stays locked until an attestation names it — added to the existing readings. |
| 10 | S2 joint flags (red vs clearing report) | same logs, `session-safety.ts:114`; server `session-hooks.ts:126` | **unsafe** (equal instants, id order puts a green of another session after the red: it clears) | **unsafe** | **unsafe** (a report that never saw the red) | Pain reports carry `eventId` + `after`; a red with an id is cleared only by a report that follows it causally, and the sessions seen up to the red include its causal ancestors — added to the existing rules. |
| 11 | S5 load ceiling | `session-safety.ts:41` | safe | safe (min of every reference from 7 days ago on, future-dated included) | safe | Unchanged. |
| 12 | Session history / progression "last session" | `packages/engine/src/session/history.ts:36` (`startedAt`, planId), `progression.ts:100,183`, `profile-store.ts:229` | arbitrary | may progress from an older session | same | **Not changed** (residual): the prescribed load is still capped by S5 (row 11); see Deferred. |
| 13 | Set logs (e1RM, S5 references) | `profile-store.ts:235` | safe (all counted) | safe | safe | Unchanged. |
| 14 | Readiness check of the day | `packages/engine/src/recovery/readiness.ts:54` (last in list), device list by `at`; server `session-hooks.ts:140` (push order) | arbitrary | wrong (older replaces newer) | device ≠ server | Chain (`checkId`, `supersedes`); several → the lowest readiness. Legacy: list order (unchanged). |
| 15 | Low-readiness deload | `packages/engine/src/recovery/deload.ts:134` | as 14 | as 14 | as 14 | Uses `readinessCheckOn` per day. |
| 16 | Assessments → CapacityModel (M07) | `profile-store.ts:214`, `selectors.ts:33` | arbitrary | **unsafe** (an older, higher capacity) | unsafe | Chain; several → the most conservative starting point. Server accepts any stored assessment (unchanged). |
| 17 | Programs (M08) | `profile-store.ts:219`, `selectors.ts:56` | arbitrary | wrong | wrong | Chain; several → the one made on the strictest SafetyProfile. Server selects by programId (unchanged). |
| 18 | Reflows of a program (replayed) | device `profile-store.ts:224` (`decidedAt`) vs server `program-hooks.ts:75`, `session-hooks.ts:158` (push order) | arbitrary | device ≠ server | device ≠ server | Chain on both (`orderedReflows`); legacy by `decidedAt` on both. |
| 19 | Legal acceptances (L2) | `packages/legal/src/acceptance.ts:59`, server `legal/service.ts:111` | safe | safe (versions only rise: a clock moved back can only pick the lower version → re-acceptance asked) | safe | Unchanged. |
| 20 | L3 notice acknowledgments | `packages/legal/src/notices.ts:82` | safe (order-independent) | safe | safe | Unchanged. |
| 21 | Defensibility log (L6/L11) | `apps/api/src/legal/defensibility-log.ts:45` (`chainSeq`), device `legal-store.ts:107` (append) | safe | safe | safe | Unchanged. |
| 22 | Body metrics, measurements (M04 guardrail) | `progress-store.ts:65,72`, `engine/src/analytics/body.ts:28` (explicit `correctionOf`, per-day mean) | safe | safe | safe | Unchanged. |
| 23 | Intake logs (corrections) / habit ticks ("latest of a day") | `nutrition-store.ts:143,144` | safe / arbitrary | safe / wrong | safe / wrong | Unchanged: habit ticks carry no safety meaning (Deferred). |
| 24 | Pair sharing choice | `apps/mobile/src/pair/pair-store.ts:266` (device-local append-only list) | safe | safe | n/a | Unchanged. |
| 25 | Profile, equipment profiles (mutable) | sync `baseRevision`, server wins (ADR-002); server `nutrition-hooks.ts:23` | safe | safe | safe (conflict, server wins) | Unchanged. |

## What changed and why

| Area | Files | Change |
|---|---|---|
| The chain | `packages/shared/src/record-chain.ts` (new), `common.ts` (`SupersedesSchema`), `profile.ts`, `assessment.ts`, `program.ts`, `recovery.ts`, `session.ts`, `nutrition.ts`, `privacy.ts` | `orderChain` / `soleHead` / `supersededIds` (pure; SCC + heap, 3,000-record chain in ~25 ms). Optional link fields on every "latest counts" record (backward compatible: absent on stored records). Nutrition `supersedes` also accepts a list. |
| Safety | `packages/safety/src/screening-history.ts` (new), `session-safety.ts` | `orderScreenings`, `safetyProfileFromScreenings`, `strictestSafetyProfile`, `isAtLeastAsStrict`, `lastScreenedAt`, `screeningHeads`. S2 `painTrafficLight` and S3 `intensityLockStatus` honour the causal links on top of the existing rules. |
| Privacy | `packages/privacy/src/consent.ts` | `latestRecord` follows the chain and fails closed; `consentHeads`. |
| Engine | `packages/engine/src/recovery/readiness.ts`, `deload.ts`, `facts.ts` | `readinessCheckOn` chain + fail closed; `readinessHeadsOn`; the low-readiness deload uses it; facts carry the links. `ENGINE_VERSION` unchanged. |
| Sync | `packages/sync/src/client/sync-client.ts` | `newRecordId()` so an event can carry its own record id. |
| i18n | `packages/i18n/src/catalogues/onboarding.{en,fr}.ts` | `reason.safety_profile.ambiguous_latest` (FR/EN, no claim, no guilt; `pnpm legal:claims` green). |
| Mobile | `src/profile/history.ts` (new), `profile-store.ts`, `selectors.ts`, `nutrition/nutrition-store.ts`, `nutrition/NutritionProvider.tsx` (PO's `currentNutrition`, finished: chain head, ambiguity), `screens/NutritionScreen.tsx`, `privacy/consents.ts`, `account/account-sync.ts`, `pair/PartnerSetup.tsx` | Stores order by chain and write the links; selectors use the shared functions. |
| API | `src/profile/sync-hooks.ts` (`latestSafetyProfile` exported), `program-hooks.ts` (`orderedReflows`), `session-hooks.ts`, `src/privacy/service.ts`, `src/db/schema.ts`, `drizzle/0008_fix_consent_supersedes.sql` | Same functions as the device; consent `supersedes` stored, exported, filled with the server's heads for web/API decisions. |

## Tests

- `packages/shared/src/record-chain.test.ts` — the chain: links over clocks, equal instants, forks, legacy, upgrade, cycles, unknown/duplicate ids, 3,000-record chain.
- `packages/safety/src/latest-record.property.test.ts` (fast-check) — screenings: linked history with equal/backwards timestamps in any arrival order = exactly the profile written last (1,000 runs); the PO case (and its legacy form fails closed); two devices offline → never looser than either, the next screening resolves it (2,000); legacy duplicates never looser than the last written (2,000); upgrade (1,000); `strictestSafetyProfile` never looser than any input (2,000); `isAtLeastAsStrict` detects each field. S3: truly locked → locked for any clock and order (2,000). S2: red in truth → red for any device clock and order (10,000); explicit regression cases (which the pre-fix rules got wrong, asserted).
- `packages/privacy/src/consent-order.property.test.ts` (fast-check) — one device, any clock, any server order → exactly the last decision (2,000); two devices → withdrawn if either withdrew (1,000); the regression case.
- `packages/engine/src/recovery/readiness-order.property.test.ts` (fast-check) — readiness chain, two devices → reduced if either, legacy behaviour kept, deload reads the same check; facts carry the links.
- `apps/mobile/__tests__/latest-record.test.tsx` (jest-expo; fast-check added as a mobile devDependency, same version 4.10.2 already in the workspace, lockfile: 3 lines) — device stores with a clock the test moves: PO case, clock moved back, two devices through the in-memory sync server (both devices derive the same profile), consent withdrawal with the clock moved back (and upload order), S3/S2/readiness links through `logExecution`/`logReadiness`, assessment/program forks, **nutrition plans (fast-check): the plan written last counts for any clock and arrival order and the screen never shows a deficit the current SafetyProfile forbids**; two devices' plans → no stored plan shown.
- `apps/mobile/__tests__/nutrition.test.tsx` — the PO's describe block "S4: what the screen shows never outruns the stored plan" (two tests) kept as written.
- `apps/api/test/integration/latest-record.test.ts` — server: a newer stricter screening pushed first and dated earlier counts; equal legacy instants → strictest; withdrawal dated before its grant → withdrawn in either upload order and health collections refused; web decisions store the server's heads; the export shows the links.
- No test was deleted, skipped or loosened. No existing assertion changed.

### The originally failing test, 20 runs

```
$ cd apps/mobile && for i in $(seq 20); do npx jest __tests__/nutrition.test.tsx || break; done
run 1: Tests:       12 passed, 12 total
…
run 20: Tests:       12 passed, 12 total
passed 20/20
```

## Gates (working tree, before the fresh clone)

All exit 0: `pnpm -w build` (13/13), `pnpm -w typecheck`, `pnpm -w lint` (26/26), `pnpm -w test` (26/26), `pnpm --filter api test:integration` (16 files, 139 tests), `pnpm security:audit` (0 high/critical), `pnpm security:secrets` (no leaks), `pnpm security:sast` (0 — the pmo findings were fixed by the PO's `e852b04`), `pnpm compliance:check`, `pnpm licences:check`, `pnpm legal:claims`, `pnpm legal:licences`, `pnpm legal:docs`.

Coverage (lines / branches): engine 99.52 % / 95.97 %, safety 100 % / 98.35 %, shared 98.96 %, privacy 100 %, sync 97.3 %, mobile 95.52 %, api (unit) 88.99 %.

## Deviations and residual risks

1. **Legacy records** (stored before the links) keep their clock order among themselves; nothing better is known about them. Equal legacy instants now fail closed instead of being chance.
2. **Mixed-version fleets**: old app versions parse records with `z.strictObject` and would ignore records carrying the new optional fields. Nothing is released; to handle before launch if old builds can coexist (open question).
3. A linked readiness check cannot name an unlinked one of the same day: on the upgrade day both are candidates and the lower readiness counts (fail closed).
4. S3: the existing time reading still locks when an attestation is dated before the flag it attests (clock moved back after the flag); the user can unlock only once the device clock passes the flag's time. Pre-existing, stricter, kept (never weaken).
5. Concurrent screenings stay combined (strictest) until the next screening; the user sees the reason `safety_profile.ambiguous_latest`. The combined profile is one no single screening produced (open question for A1).
6. A mobile consent decision uploaded without links (an old client) is stored as legacy; after a web/API decision that names the server's heads, such a legacy grant cannot overtake a linked withdrawal (both are heads → withdrawn). Stricter than before for old clients.

## Needs a qualified human (docs/governance/03 §3)

- **A1 (physician)**: the strictest-combination rule for concurrent screenings (row 1) and the conservative choice for concurrent assessments (row 16).
- **B1 (data protection)**: consent chains and the new `consent_records.supersedes` column (records of processing unchanged: no new data category; the column holds record ids only).
- **M05 owner / A2 (physiotherapist)**: S2/S3 causal links (rows 9–10).

## Deferred

- Row 12: order session history by a chain too (progression "last session" under a clock moved back). S5 already bounds the load.
- Row 23: habit ticks "latest of a day" by time (no safety meaning).
- validated:false items: none added.

## Fresh clone

See the next commit (recorded after the verification run).
