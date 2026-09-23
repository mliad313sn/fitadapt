# M12 — Wearables & Health Integrations

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 2 | M00, M03, M05, M17 |

## Purpose
Bring heart rate, HRV, sleep, steps and weight in — and workouts out — with explicit consent, never making data mandatory.

## Why (committee review)
Claire: zone training and readiness improve with real data. Raj: connect heart-rate straps directly over Bluetooth for in-session HR. Me. Hélène: consent per data type.

## Scope
- Apple HealthKit and Android Health Connect: read HR, resting HR, HRV, sleep, steps, weight; write completed workouts.
- Bluetooth LE heart-rate straps via the standard Heart Rate Service during sessions.
- Third-party platforms (Garmin, Polar, Strava) in v2.
- Readiness contribution shown transparently (which inputs changed today's plan).

## Rules
- Explicit consent per data type; revocable at any time.
- Missing or stale data never blocks a session; the engine falls back to self-report.
- L9: data read from HealthKit or Health Connect is never sent to analytics, advertising or third parties and never sold.

## Core data entities
IntegrationConnection, HealthSample, ConsentRecord

## Acceptance criteria
- Adapters tested with mocks; BLE HR parser tested with recorded packets; consent revocation stops reads.

## KPIs
- Share of users connecting ≥ 1 source
- Session HR coverage for cardio sessions

## Out of scope
- Continuous background tracking
- Medical-grade ECG features
