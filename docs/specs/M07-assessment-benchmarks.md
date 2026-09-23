# M07 — Assessment & Benchmark Testing

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 1 | M00, M01, M06 |

## Purpose
Measure starting capacity safely so the engine starts at the right ladder rung and load, then re-measure every block.

## Why (committee review)
Karim: you cannot scale without a baseline. Dr. Julien: use submaximal tests (reps at a set RIR) rather than 1RM tests for novices. Ibrahima: '0 pull-ups' must place him on a ladder, not fail him. Mariam: older users need age-appropriate tests.

## Scope
- Home assessment ≤ 15 min: push-up variant max reps (user picks a level), dead-hang time, inverted-row reps, bodyweight squat reps or 30-second chair stand (Jones et al., 1999, for 55+), plank hold.
- Gym assessment: submaximal rep tests (a load for 6–10 reps stopped at RIR 2) → e1RM via Epley with RIR adjustment.
- Re-assessment at the end of each mesocycle (4–6 weeks) and on demand.
- Mapping of results to ladder levels and starting loads; a Capacity model stored in the profile.

## Rules
- No test to failure when SafetyProfile.allowMaxTests is false; tests stop at RIR 2.
- A result of zero maps to the lowest rung of that ladder with encouraging copy.

## Core data entities
AssessmentProtocol, AssessmentResult, CapacityModel

## Acceptance criteria
- Mapping tables are unit-tested; results feed M02's first session.

## KPIs
- Assessment completion ≥ 75% of new users
- Share of first-week prescriptions overridden (target < 20%)

## Out of scope
- Laboratory tests (VO2max, body composition scans)
