# M04 — Tracking, Analytics & Progress Dashboard

| Status | Phase | Depends on |
|---|---|---|
| Enhanced (original Module 4) | Phase 1 | M00, M02; M10 guardrail hand-off |

## Purpose
Turn logs into understandable progress: strength, volume, variants unlocked, body trends, adherence and milestones — privately.

## Why (committee review)
Dr. Julien: smooth bodyweight with a trend, and show e1RM, weekly hard sets per muscle and adherence rather than raw logs. Dr. Sofia: show progress in the unit that matters to the user. Me. Hélène: progress photos are among the most sensitive data the app holds. Awa: 'Tell me roughly when I'll get my first pull-up.' Raj: progression logic moves to M02; M04 only reads.

## Scope
- Workout history and per-exercise history: e1RM, best set, volume load, variant level over time.
- Weekly hard sets per muscle group against goal ranges (e.g., roughly 10–20 for hypertrophy, following the dose-response trend in Schoenfeld et al., 2017).
- Bodyweight trend (exponentially weighted moving average) with rate of change in %BW/week; circumferences; optional body-fat estimate.
- Progress photos: encrypted on device, optional end-to-end-encrypted backup, side-by-side comparison with a pose-guide overlay.
- Milestones and forecasts (e.g., first strict pull-up) shown as a date range with confidence, never as a promise.
- Adherence: planned vs completed, streaks that count planned rest days.
- Export of all training and body data (CSV and JSON).

## Rules
- Sustained loss > 1% BW/week for 3 weeks triggers a supportive notice and hands off to M10 guardrails.
- Photos never leave the device unless backup is explicitly enabled; backups are end-to-end encrypted.
- No judgemental language about weight or body shape.
- Forecasts and trends are labelled as estimates, never as guarantees (L1).

## Core data entities
BodyMetric, Measurement, ProgressPhoto (encrypted blob ref), Milestone, AdherenceStat

## Acceptance criteria
- Dashboard renders two years of data in < 1 s on the reference device.
- Network tests prove photos stay local by default.
- EWMA and forecast functions are unit-tested.

## KPIs
- Weekly dashboard visits per active user
- Photo feature opt-in rate
- Export usage

## Out of scope
- Social sharing of photos
