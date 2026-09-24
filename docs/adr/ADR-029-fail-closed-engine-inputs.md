# ADR-029: Engine inputs fail closed — required safety facts, bounded history, versioned goldens

- Status: Accepted (FIX-A, fix wave after the deep review)
- Date: 2026-09-24
- Deciders: fix engineer (FIX-A), on the review findings SAF-1…SAF-12 and the AI pre-reviews. Needs review by A1 (the S4 absolute floor, the first-exposure interval caps), A4 (the floor, the activity factors, the adaptive band) and the M02/M05 owners.
- Amends: ADR-016 (session contracts), ADR-022 (nutrition energy balance), ADR-023 (the deload chain resolution).

## Context

The review found the engine boundary failing **open** when a safety fact was missing (no S3 lock read as "unlocked", no joint flags as "no red joint", no history as "no S5 reference", no date of birth as "no age re-check"), and failing **hard** when a long-time user's history exceeded its caps (every session after the 60th threw). It also found safety windows evaluated at times the caller chooses, configs mutable at runtime, and goldens that could be regenerated without a version bump.

## Decision

1. **Required facts.** `GenerateSessionInputSchema` requires `intensityLock`, `jointFlags`, `history`, `recentLoads`, `birthDate` (nullable: no date of birth on the account) and `localDate` (nullable: unknown). "Nothing reported" is an explicit value (`{ locked: false, since: null }`, `{}`, `[]`). `buildAssessmentPlan` requires the same facts. An absent fact is an error, never the permissive value.
2. **Two schemas for one input.** Stored `workout_sessions` records keep a tolerant `StoredSessionInputSchema` so records written before this ADR still parse — dropping them would drop their S5 references (a fail-open). A stored input is never an engine input: the server parses it with the strict schema before re-deriving.
3. **Bounded, never lossy.** The boundary caps stay (60 sessions, 20 exercises per session, 500 references). `boundSessionInput` keeps the newest sessions and folds the S5 references of what it drops into `recentLoads`; `buildSessionHistory` folds entries beyond 20 into `overflowLoads`; the progression gets only the reference S5 reads now. Folding keeps the **lowest** load of an exercise at its **latest** time, so the ceiling is the same or stricter — property-tested.
4. **Times bounded by the injected clock.** A local date or a nutrition `today` more than a day from the engine clock is refused (`clock_mismatch`). The S7 re-check uses the earlier of the local and UTC dates. `s5Violations` evaluates at the earlier of the plan time and the server time.
5. **S4 absolute floor.** No energy number below max(BMR, 1,200 kcal/day); below it the supportive mode. An invariant constant like the other S4 limits (never configuration, may only be raised), `validated: false` in the status file until A4 and A1 settle it.
6. **The RIR→RPE anchor belongs to S1.** `S1_RPE_AT_ZERO_RIR` = 10 in packages/safety; the engine uses max(config, anchor).
7. **Frozen configs, versioned goldens.** `defineConfig` deep-freezes. Goldens carry `engineVersion`/`rulesVersion`, and a digest per `ENGINE_VERSION` fails the tests when goldens change without a bump.

## Consequences

- Every caller (device, pair planner, API tests, future coach portal and AI coach) must pass the facts; forgetting one is a crash in development, not a looser prescription in production.
- An old app build that sends an input without the facts gets `session.invalid` from the server (fail closed); the version bump already refuses it (`session.engine_version_unsupported`).
- A small, older, sedentary user may now see habits instead of a number; that is the intended, stricter behaviour.
