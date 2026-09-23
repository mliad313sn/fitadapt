# ADR-014 — Assessment protocols, CapacityModel and the first session

- Status: Accepted (M07)
- Date: 2026-09-23
- Deciders: M07 engineer; protocols, mappings and coefficients pending review by seats A3 (S&C coach) and A5 (exercise physiologist), the S1 reserve by A1

## Context

M07 must measure a starting capacity safely (C7: submaximal tests), place each movement on an M06 ladder rung with a starting load, store a CapacityModel with the profile, and feed the first session. S1 forbids maximal tests and prescriptions above RPE 7 while a screening flag is unresolved; L3 requires a notice at every assessment; L11 requires safety events in the defensibility log. M02 (session generator) and M08 (mesocycles) are not built. The engine must stay pure (no I/O, injected clock and seed) and must not depend on `packages/exercise-library`, which itself depends on the engine.

## Decision

- **Contracts in `packages/shared/src/assessment.ts`**: `AssessmentResult` (what the user did; `stopRir ≥ 2` in the schema), `CapacityModel` (per slot: ladder, rung, e1RM, starting load, target, reason codes), the synced `AssessmentRecord` and the `SessionPlan` returned by `generateSession()`.
- **Protocols are data in `packages/engine/src/assessment`**: `home` (push-up variant reps with a user-picked level, dead-hang time, row/pull-up reps, squat reps, plank; 14 min estimated), `home_55plus` (30-second chair stand paced and stopped at a reserve, wall/incline push-ups, plank) recommended from 55, and `gym` (submaximal load tests capped at 12 reps + plank). Every shipped test is `effort: 'submaximal'` and has a rep, time or window cap.
- **The S1 gate is the M01 one.** `buildAssessmentPlan` calls `screeningGateCheck` from `packages/safety`: every test stops at RIR 2 (the M07 rule, a constant), raised until the gate accepts the matching RPE (RPE = 10 − RIR), i.e. RIR 3 while a flag is unresolved. A test marked `maximal` is only given as such when the gate allows a maximal test; otherwise it is downgraded and an S1 event is returned. Blocked, not-screened and S7 (no automatic programming) users get no assessment. Variants are filtered by the M06 `blockingReasons` (equipment, SafetyProfile, joint flags).
- **Mapping** (`capacity.ts`): zero → lowest rung of the ladder (spec rule); below `stayMin` → one step down; from `promoteAt` → one step up (one step at most); otherwise the tested variant with a working target derived from the result. Several tests on one slot: highest rung wins, but a gated test (rows) counts only if its gate (dead hang) reached `stayMin`. Untested slots start at the lowest rung of a default ladder. Loaded tests: RIR-adjusted Epley `w × (1 + (reps + RIR)/30)` for 1–12 reps, starting load = load for 8 reps at the reserve × 0.9, rounded down; above 12 reps no estimate, the tested load × 0.9 is used. Ladders and "is a hold" come in as data (`CapacityLibrary`), so the engine has no dependency on the seed; `packages/exercise-library/src/assessment.ts` binds it to the seed like `substitute()`.
- **First session** (`session/first-session.ts`, `generateSession`): one exercise per capacity slot at the assessed rung; if not allowed, a lower step of the same ladder, else the best graph substitute (S2 event when a red joint forced it), else the slot is dropped. Target RIR 3 raised by the same S1 gate; loads recomputed from the e1RM for the top of the rep range at that RIR; S5 caps a load at +10 % over any load prescribed in the last 7 days (constants, not configuration); fitted to the minutes available (one set per exercise, then fewer exercises). Deterministic plan id from the injected seed. M02 extends this generator; it must keep these guarantees.
- **Re-assessment**: `CapacityModel.reassessDueAt` = assessment + `defaultMesocycleWeeks` (4, config); `reassessmentStatus(latest, clock, mesocycleEndsAt?)` follows the M08 end when one exists.
- **Storage and sync**: collection `assessments` (append-only, latest counts), a health collection (health consent required, erased on withdrawal). The device selector fails closed without the consent. The server re-derives the CapacityModel from the result on the seed and refuses any mismatch, another engine version, or a stop reserve below what S1 requires for the user's latest stored screening; an S1-capped record writes its `safety.event` in the sync transaction (ADR-009, the M01 fix in `3bff4b8`).
- **App**: `/assessment` sits behind the same L2 route guard as the first workout. The L3 `assessment` notice (every time) is shown and must be acknowledged; both impressions go to the device ledger and its defensibility buffer, as do the plan's S1 events. "Stop the assessment" is visible on every step (L4); each test can be skipped or stopped for discomfort. The first-workout screen shows the plan from `generateSession()` once a CapacityModel exists.

## Alternatives considered

- **1RM or to-failure tests**: rejected (C7, Dr. Julien); the schema can express a maximal test only so the S1 gate can be proven.
- **Stopping at exactly RIR 2 for everyone**: RIR 2 is RPE 8 on the RIR-RPE scale, above the S1 cap of 7; S1 wins, so flagged users stop at RIR 3.
- **Capacity as a field of the Profile document**: would change the M01 Profile schema and lose the history needed for re-assessment; an append-only collection keeps both, and the "profile" on the device reads the latest record.
- **Ladders duplicated in the engine**: would fork the M06 graph; ladders are passed in instead.
- **Waiting for M02 to build `generateSession()`**: the M07 goal requires the first session to use the CapacityModel; a minimal first-session generator in the engine is the smallest honest way, and M02 extends it.

## Consequences

- Every threshold, formula and default in `ASSESSMENT_CONFIG` / `FIRST_SESSION_CONFIG` is `validated: false`; a production release needs A3 and A5 sign-off (and A1 for the S1 reserve and the chair-stand protocol for older adults).
- The chair stand stops at a reserve, so counts are not comparable with published Jones et al. norms; mapping thresholds do not claim to be norms.
- A client with an older engine version cannot sync assessments until it updates (`assessment.engine_version_unsupported`).
- `generateSession()` is a first-session generator only: no progression, no history other than S5 recent loads, no pain model (M05), no program block (M08).
