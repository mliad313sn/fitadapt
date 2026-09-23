# M02 — Adaptive Training Engine & Session Execution

| Status | Phase | Depends on |
|---|---|---|
| Enhanced (original Modules 2 and 4.3) | Phase 1 | M00, M01, M06, M07, M08; reads M04, M05 |

## Purpose
A deterministic, explainable, offline engine that turns profile, program, history and today's context into a session — and a gym-proof screen to execute it.

## Why (committee review)
Karim: '2 sessions hitting reps → +2.5–5 kg' ignores rep ranges, reps in reserve and exercise size; use double progression with autoregulation. Dr. Julien: bodyweight scaling needs variant ladders with per-variant load coefficients, not one formula. Ousmane: show why a load was chosen or users won't trust it. David: the plan must fit the clock. Thomas: slow eccentrics are a tool, not a default for heavy novices.

## Scope
- Session generator: inputs (profile, SafetyProfile, program block from M08, history, readiness from M05/M12, active equipment profile, minutes available) → SessionPlan (warm-up, blocks, exercises, sets, rep range, target RIR, load or variant, tempo, rest, reason codes).
- Movement-pattern slots (squat, hinge, lunge, horizontal/vertical push and pull, carry, core) filled from the M06 graph by equipment, level and limitations.
- Variant ladders — pull: dead hang → scapular pulls → inverted row (height-adjusted) → band-assisted → negatives → strict → weighted; push: wall → incline (by height) → knee → standard → deficit/diamond → archer; squat: box squat → air squat → goblet → split squat → barbell or leg press.
- Load prescription from e1RM (Epley, valid ≤ 12 reps, RIR-adjusted) and target intensity, rounded to the smallest increment available on the active equipment profile (plates, dumbbell pairs, machine stack steps).
- Time-boxing: fit to minutes available by trimming accessory sets first, then pairing non-competing patterns as supersets; never cut the warm-up below its minimum.
- Execution screen: current set, target, load or variant, client-side rest timer that survives backgrounding (lock-screen notification), 2-tap logging of reps/load/RIR, swap, skip, pain flag.
- Anywhere Switcher: changing location mid-program maps each slot to the nearest-stimulus exercise on the new equipment.
- Explainability: each prescription carries reason codes rendered as a FR/EN sentence (e.g., '+2.5 kg: you reached 3×12 at RIR 2 in your last two sessions').

## Rules
- Double progression: work within a rep range (e.g., 6–10 strength-hypertrophy, 8–15 hypertrophy). When all working sets reach the top of the range at or below target RPE, increase load by the smallest increment ≥ ~2.5% (upper body) or ~5% (lower body) and return to the bottom of the range.
- Regression: two consecutive sessions below the bottom of the range, or RPE ≥ 9.5, → reduce load 5–10% or step down one variant.
- Bodyweight: top of range on all sets for two sessions → next variant at the bottom of its range. Variants are equated with %-bodyweight coefficients; e.g., push-up variants per Ebben et al. (2011): knee ≈ 49%, standard ≈ 64%, feet elevated 60 cm ≈ 74%, hands elevated 60 cm ≈ 41% (to be validated).
- Slow eccentric tempo is prescribed only for specific progressions (e.g., negatives), not as a default.
- S1 and S2 caps override any prescription; S5 caps weekly load increase at 10% per exercise.
- The engine is pure and deterministic (injected clock and seed, no I/O) and stamps engineVersion on every plan.
- L4: stop and skip are available in every execution state; the first session shows the L3 notice.
- Every prescription records engineVersion and reason codes in the defensibility log (L11).

## Core data entities
SessionPlan, PlannedExercise, PlannedSet, ReasonCode, ExecutionLog, SetLog (append-only)

## Acceptance criteria
- Golden plans for the six committee personas are stable and reviewed.
- Property tests over random valid inputs never violate safety caps, time budget or equipment availability.
- A full session can be executed offline with 2-tap logging per set.
- Every prescription has a FR and EN explanation.

## KPIs
- Session completion ≥ 85%
- Manual override rate < 15%
- App open → first set < 30 s

## Out of scope
- Machine-learning prescription (deferred; rules first)
- Camera rep counting (M14)
