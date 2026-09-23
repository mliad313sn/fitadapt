# M05 — Recovery, Mobility & Pain-Monitored Safety

| Status | Phase | Depends on |
|---|---|---|
| Enhanced (original Module 5) | Phase 1 | M00, M01, M02, M06; optional M12 |

## Purpose
Keep users training for years: specific warm-ups, readiness-based adjustment, a physio-grade pain model, triggered deloads and a red-flag stop.

## Why (committee review)
Thomas: replace 'discomfort' with a pain-monitoring model (Silbernagel et al., 2007) — pain during exercise can be acceptable below a threshold if it settles by next morning. Dr. Amina: red-flag symptoms need a stop-and-seek-care flow. Karim: warm-ups over ~8 minutes get skipped. Mariam: balance and mobility matter more to her than biceps.

## Scope
- Warm-up generator: 2–3 min general, specific mobility for the day's patterns, ramp-up sets before the first heavy lift (e.g., ~40/60/80% of working load).
- Cool-downs and standalone mobility and balance programs (targeted at 55+).
- Optional 10-second readiness check (sleep, soreness, stress, energy, 1–5) plus HRV/resting HR from M12 → readiness score that trims volume or suggests swaps.
- Pain monitor per joint, 0–10, after the session and at a next-morning check: green ≤ 3, amber 4–5, red ≥ 6 or not settled by next morning.
- Deload engine: scheduled (M08) or triggered (two amber weeks, a red flag, performance drop two sessions running, low readiness three days) → volume −40–50%.
- Alternative grips and variants: neutral grip, ring rows, reduced range of motion.
- Red-flag screen for chest pain/pressure, fainting, disproportionate breathlessness, palpitations, sudden numbness/weakness.

## Rules
- S2 pain gate and S3 red-flag stop are enforced through engine inputs.
- Amber or red on the same joint for more than two weeks → recommend seeing a physiotherapist.
- No diagnostic wording; guidance only.
- Emergency guidance and numbers are configured per jurisdiction and verified before launch; red-flag events are written to the defensibility log (L11).

## Core data entities
ReadinessCheck, PainReport, DeloadEvent, RedFlagEvent, WarmupPlan

## Acceptance criteria
- Warm-ups stay within 5–8 minutes.
- Traffic-light and deload triggers are unit-tested; the red-flag flow is E2E-tested.

## KPIs
- Red pain flags per 1,000 sessions (trend)
- Deload acceptance rate
- Warm-up completion rate

## Out of scope
- Rehabilitation programs for diagnosed injuries
