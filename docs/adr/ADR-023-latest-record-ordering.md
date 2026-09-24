# ADR-023: "The latest counts" follows an explicit chain, never a clock — and fails closed

- Status: Accepted (safety defect fix, FIX-latest-record-ordering)
- Date: 2026-09-24
- Deciders: fix engineer, on the PO's finding. Needs review by A1 (physician: the strictest-combination rule for concurrent screenings), B1 (data protection: consent chains, the new `consent_records.supersedes` column) and the M05 owner (S2/S3 links).
- Amends: ADR-002 (sync), ADR-004 (consent model), ADR-012 (screening and SafetyProfile), ADR-017 (S2/S3 on execution logs), ADR-022 (nutrition plans' `supersedes`).

## Context

A full-workspace run failed `apps/mobile/__tests__/nutrition.test.tsx` › "a stored numeric plan turns supportive at once when a re-screen switches deficit features off": after a re-screen answering "advised against calorie restriction" the screen still showed "Energy: about 2,820 kcal a day" (S4).

Root cause (confirmed): the device picked "the latest screening" as `screenings[screenings.length - 1]` after sorting **only by `completedAt`** (`apps/mobile/src/profile/profile-store.ts`, then line 209). The test clock is frozen, so both screenings carried the same instant and the sort left them in the sync list's arbitrary order: the OLD, looser screening became "latest" and the whole app applied a looser SafetyProfile (S1/S4/S7). The same flaw exists wherever a history is ordered by a device timestamp:

- **identical timestamps** (a frozen or coarse clock, two saves in one millisecond) leave the order to chance — the other stores' tie-break on a random record id is still chance;
- **a device clock that goes backwards** makes a NEW record look OLDER;
- **records from another device** carry that device's clock, and the server's own order (push order) differs from the order the records were made in when a device was offline. The server re-derived "the latest screening" as the last one pushed, so device and server could disagree.

The sync layer's order is not authoritative either: the device lists records by `updatedAt` (its own clock), and the server revision is the push order.

## Decision

### An explicit chain: each new record names the records it replaces

`packages/shared/src/record-chain.ts` — `orderChain(items, linksOf)`, pure, O(n + links) (strongly connected components, then a heap):

- A new record carries `supersedes`: the ids of the **heads** its writer knew (the records nothing else supersedes), usually one.
- R is superseded when a record outside R's own cycle reaches R through the links. The **heads** are the records nothing supersedes. **One head is the latest. Several heads** (two devices offline, or ambiguous data) are left to the caller, which **fails closed**; the next record names every head and resolves the fork.
- **Backward compatible**: `supersedes` is optional. Records stored before it ("legacy") are chained among themselves by time, then by a clock-independent rank when the caller has one (a ledger position); equal keys stay ambiguous (both heads → fail closed). A linked record that names a legacy head supersedes every older legacy record too. An unreadable time never orders a legacy record.
- A cycle of links (corrupt data) never elects one of its members.
- `ordered` (oldest first) puts every record after what it supersedes; independent branches are ordered by time then id for display only.

The alternative the PO suggested — the sync layer's own ordering — was rejected: it is not authoritative (see Context). Lamport counters were rejected too: they order concurrent records arbitrarily instead of detecting them, so a concurrent looser record could still win.

### Where it applies, and what "fail closed" means there

| History | Link | Several heads → |
|---|---|---|
| Screenings (S1/S4/S7) | `ScreeningRecord.supersedes` (sync record ids) | `strictestSafetyProfile`: every cap at its lowest, every permission only if all allow it, every restriction of any, reason code `safety_profile.ambiguous_latest` (FR/EN). Never looser than any head (`isAtLeastAsStrict`, property-tested). Re-screen due from the EARLIEST head. |
| Consents (per data type) | `ConsentRecord.supersedes` (decision ids); server column `consent_records.supersedes` (migration 0008) | A withdrawal among the heads wins; otherwise the grant of the oldest text version. |
| Nutrition plans (S4) | `supersedes`: one target id (as in M10) or, when the writer knew several heads, a list | No stored plan is shown; the engine's answer for the current profile is, and the next plan names every head. |
| Readiness checks of one day | `checkId` + `supersedes` | The lowest readiness among the heads. |
| Assessments (M07) | `supersedes` | The most conservative starting point (lowest rungs, then lowest loads). |
| Programs (M08) | `supersedes` | The one made on a SafetyProfile at least as strict as the others'. Sessions are re-checked against the current SafetyProfile anyway. |
| Reflows of a program | `supersedes` (previous reflows of the same program) | Replayed in chain order on the device AND the server (was: device by `decidedAt`, server by push order). |
| S3 red flags and attestations | red flag `eventId`; attestation `attests` (the flags it covers) | A red flag with an id stays locked until an attestation NAMES it — on top of the existing order and time readings (never instead of them). |
| S2 pain reports | `eventId` + `after` (latest reports of the same joint the writer knew) | A red report with an id is cleared only by a report that follows it causally; the sessions "seen up to the red" include its causal ancestors. On top of the existing rules. |

The stores write the links (`apps/mobile/src/profile/profile-store.ts`, `nutrition-store.ts`, `privacy/consents.ts`); `SyncClient.newRecordId()` gives a record its id before it is inserted so an event can name itself.

### Device and server pick the same latest

The server calls the same pure functions on the same set of records: `safetyProfileFromScreenings` (packages/safety) in `latestSafetyProfile`, `orderChain` for reflows (`orderedReflows`, used by reflow and session validation), `consentState`/`latestRecord` (packages/privacy) for consents, `readinessCheckOn` and `intensityLockStatus`/`painTrafficLight` for sessions. For linked records the result is a function of the SET of records, not of their order, so push order and arrival order no longer matter; legacy records keep the readings they had (time, then list position). A decision made on the server itself (web, API) is stored with the server's current heads; a mobile decision without links is kept as legacy (the server cannot know what the device knew).

### What does not change

- S1–S7 constants and checks are untouched. For S2 and S3 every new rule adds a condition to stay red or locked, never one to clear or unlock. For screenings, consents and nutrition plans the chain replaces the clock order and ambiguity fails closed. For readiness, assessments, programs and reflows the chain can now pick a record the clock order did not (a re-check dated before the check it replaces, because the clock was moved back, now counts): that is the record the user actually made last; candidates the chain cannot order still fail closed.
- S5 is order-independent already (the ceiling is 10 % above the LOWEST reference in the 7-day window, including references dated in the future).
- `ENGINE_VERSION` stays 0.4.0: no prescription for a given input changes; readiness and deload inputs only change when a day has several checks.

## Consequences

- The PO's failing test passes deterministically (20/20 runs); adversarial fast-check properties cover duplicate timestamps, shuffled arrival, clock regressions and two-device forks for screenings, consents, S2, S3, readiness and nutrition plans.
- Legacy records keep their clock order (nothing better is known about them); equal legacy instants now fail closed instead of being chance.
- Old app versions would not read records with the new optional fields (`z.strictObject`): mixed-version fleets are out of scope before launch; noted in the status file.
- A linked readiness check cannot name an unlinked one of the same day: on the upgrade day both are candidates and the lower readiness counts (fail closed).
- Several heads persist until the next record: a user whose two devices re-screened offline stays on the strictest combination until they re-screen (shown with its reason).
