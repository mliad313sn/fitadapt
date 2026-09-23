# ADR-012 — Onboarding, health screening and the SafetyProfile

- Status: Accepted (M01)
- Date: 2026-09-23
- Deciders: M01 engineer; screening questions, flags and the answer-to-restriction mapping pending review by seat A1 (physician); the choice of a licensed instrument pending A1 and counsel (B3)

## Context

M01 must learn goals, schedule, places and equipment, optional biometrics and a pre-participation screening in under four minutes, then produce the SafetyProfile that M02, M03, M07 and M10 consume (S1, S4, S7). The spec names PAR-Q+, but its licence is unchecked (RSK-08). M06 already defined `SafetyProfile` in `packages/shared` with `maxRPE`, `allowHIIT`, `allowMaxTests`, `impactCeiling`, `avoidTags`, `excludedExerciseIds`. M17 put the S7 age gate (16) in `packages/safety` and keeps only its outcome, never the date. M20 requires recorded acceptance of Terms, Privacy, health consent and the exercise-risk acknowledgment before the first workout (L2). Everything must work offline.

## Decision

- **One SafetyProfile schema, extended in place.** `SafetyProfileSchema` gains `screeningOutcome` (`cleared`, `cleared_with_restrictions`, `consult_professional`, plus the fail-closed `not_screened` and `blocked`), `unresolvedFlags` (S1), `deficitNutritionAllowed` (S4), `specialPopulation`, `automaticProgrammingAllowed` and `lowIntensityLibraryOnly` (S7), `professionalGuidance`, `limitedJoints`, `reasonCodes` and `rulesVersion`. All fields are required: no default can silently loosen a profile.
- **`evaluateScreening(responses)` in `packages/safety`**, pure and fail-closed. Invariants are constants in code: S1 caps (RPE ≤ 7, no HIIT, no maximal tests while a flag is unresolved), S7 minimum age (the M17 constant 16), S4 age 18. The answer-to-restriction mapping (`SCREENING_RULES`) and the numbers (`SCREENING_CONFIG`: re-screen interval 12 months, look-back and postpartum windows, the S7 low-intensity RPE cap) are configuration with `source` and `validated: false`, reviewed by A1. Question kinds: `clearance_flag` (S1 until an attested clearance; residual restrictions stay), `restriction`, `special_population` (pregnancy/postpartum; clearance does not lift it in v1) and `nutrition` (S4). A missing answer is never a "no"; an invalid input gives `not_screened`. Property tests: S1 caps whenever a flag is unresolved; under 18 never gets deficit features; pregnancy never gets automatic programming; an extra "yes" never loosens any field. `screeningGateCheck` exposes S1 to the engine and applies the caps even to a tampered profile.
- **Original questions, not PAR-Q+.** Ten original questions ask what a professional said or what the user noticed, never what the user "has" (no diagnosis). Wording lives in `packages/i18n` `screening.*` content files marked "licence check pending".
- **The profile is re-derived, never trusted.** The device selector (`selectSafetyProfile`) re-evaluates the latest stored answers with the bundled rules and returns `not_screened` without the health consent (ADR-004: safety is never traded for privacy). The server re-evaluates every pushed screening and refuses a mismatch.
- **Storage (ADR-002).** `profile` (one record per user, fixed id) and `equipment_profiles` (one per location, ids from the M06 taxonomy) are mutable sync collections; `screenings` is append-only (a re-screen is a new record, the latest counts). The server validates the M01 collections with zod, requires the health consent for `profile` and `screenings`, applies the S7 age check with the latest calendar date on Earth (UTC+14), and writes the S1/S4/S7 gates a screening switches on to the defensibility log. Withdrawing health consent erases those two collections on the server.
- **Screen order.** Age gate (M17), welcome, goals and experience, schedule, places and equipment, health-data consent (before any health data is entered), about you (date of birth, optional measurements, body areas, motivation), screening, result, Terms and Privacy, exercise risk, first workout: 12 screens. Measurements have a "Skip measurements" action and never block progress. The date of birth entered in the profile goes through the same S7 gate; a block locks the app.
- **L2 in the app.** Acceptances are recorded on the device through `packages/legal` (`renderDocument` hash, version in force, locale, jurisdiction, time) and the first-workout route is a protected route whose guard is `firstWorkoutGate` plus "onboarding complete" and "not blocked". "I accept" appears only once the text has been opened. A new material version makes the guard fail until re-acceptance; the home screen leads to the review.
- **Exercise pool per place.** `allowedBySafetyProfile` (packages/exercise-library) filters by impact ceiling, avoided properties, exclusions and the low-intensity library; the first-workout screen shows the pool of the chosen place.

## Alternatives considered

- **Copy or adapt PAR-Q+**: licence unchecked (RSK-08); adapting keeps the licence question open. Rejected until A1 and B3 decide.
- **A second `M01SafetyProfile` type**: would fork the contract M06 and the engine already use (brief: extend, don't fork).
- **Optional new fields with permissive defaults**: a missing field would read as "allowed". Rejected: required fields, fail-closed profiles.
- **Trust the stored SafetyProfile**: a modified client or an old rules version could store a looser profile. Re-deriving costs microseconds.
- **Store the date of birth from the age gate**: the M17 gate promises the date "is not kept" and its test checks it. The profile asks for it again with its own explanation.
- **Onboarding before the welcome screen**: would change M17/M06 tests that expect the welcome screen after the gate; the welcome screen instead offers "Set up your training".

## Consequences

- M02, M03, M07 and M10 read the profile through `selectSafetyProfile` / `useSafetyProfile` and must call `screeningGateCheck` (S1) before prescribing; M10 reads `deficitNutritionAllowed`.
- Changing a rule changes `SCREENING_RULES_VERSION`; screenings made under an older version are still re-derived with the current rules on the device, and the server refuses pushes whose stored profile differs (the device's next screening fixes it).
- Nothing here is validated. Seat A1 must review every question, flag and mapping before any real user sees them.
