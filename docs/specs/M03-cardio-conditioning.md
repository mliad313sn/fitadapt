# M03 — Cardio & Conditioning Suite

| Status | Phase | Depends on |
|---|---|---|
| Enhanced (original Module 3) | Phase 1 | M00, M01, M02, M06; optional M12 |

## Purpose
Structured, safe conditioning — intervals and steady-state — adapted to equipment, bodyweight, joints and screening, guided mainly by audio.

## Why (committee review)
Dr. Julien and Nadia: fat-oxidation rate peaks at moderate intensity (Achten & Jeukendrup, 2004), but fat loss is driven by energy balance and sustainable volume, so the 'maximum lipolysis zone' promise is replaced by honest guidance. Dr. Amina and Thomas: HIIT and high-impact moves must be gated. Marco: nobody looks at a screen mid-interval. Claire: use HR reserve when a heart-rate source exists, RPE/talk test otherwise.

## Scope
- Interval engine: HIIT, Tabata (20 s/10 s × 8), EMOM, AMRAP and custom work/rest, with audio, haptic and large visual countdown; FR/EN voice cues.
- Impact levels (low/medium/high) per exercise; the default is set from SafetyProfile, bodyweight and joint flags.
- Steady-state sessions: incline walk, bike, rower, elliptical, outdoor walk/run; zone guidance via HR reserve (Karvonen) when resting HR is known, HRmax estimated as 208 − 0.7 × age (Tanaka et al., 2001), otherwise RPE and talk test.
- Weekly aerobic target against WHO 2020: 150–300 min moderate or 75–150 min vigorous (vigorous minutes count double).
- Venue swaps: e.g., step-ups ↔ stair climber, shadow boxing ↔ rower, marching ↔ bike.

## Rules
- HIIT/Tabata only when SafetyProfile.allowHIIT is true and ≥ 2 weeks of consistent training are logged.
- Default impact is low for users with knee/ankle/hip flags or BMI ≥ 35 until they opt up.
- The terms 'fat-burning zone' and 'maximum lipolysis' never appear in UI copy (C9).
- Heavy lower-body days and hard intervals are not scheduled back to back when avoidable (with M08).
- L3: the first HIIT session requires reading a short intensity notice.

## Core data entities
IntervalProtocol, CardioSession, HRZoneSet, AerobicMinutesLedger

## Acceptance criteria
- Timer drift < 100 ms over 20 minutes; audio cues play with the screen locked.
- Zone calculations match reference values; HIIT is unavailable to gated users.

## KPIs
- Weekly aerobic-minute target reached by ≥ 50% of active users
- Interval session completion ≥ 85%

## Out of scope
- GPS route mapping (v1.1)
- Structured running plans (v2)
