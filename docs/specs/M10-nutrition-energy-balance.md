# M10 — Nutrition & Energy Balance

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 2 | M00, M01, M04 |

## Purpose
The minimum nutrition a fat-loss or muscle-gain goal needs — energy and protein targets, quick logging, local foods — inside hard safety guardrails.

## Why (committee review)
Nadia: séchage cannot be delivered by training alone. Dr. Amina and Dr. Sofia: disordered-eating guardrails are mandatory. Ibrahima: 'Calorie apps don't know our dishes' — a regional food database with typical portions is a differentiator. Me. Hélène: nutrition logs are health-adjacent; collect the minimum.

## Scope
- Energy estimate: Mifflin-St Jeor BMR × activity factor, then adaptive expenditure updated weekly from bodyweight trend and logged intake.
- Targets by goal: fat loss sized to ~0.5–1% BW/week, muscle gain with a small surplus; protein ≈ 1.6–2.2 g/kg/day (Morton et al., 2018 found benefits plateau around 1.6 g/kg; the upper end is often used in a deficit).
- Logging modes: hand-portion quick log, food database search, barcode scan (v1.1), photo-assisted estimate with mandatory confirmation (v2).
- Regional food database: FR/EN and local dish names, typical portions, community submissions verified before publication.
- Simple habits: protein at each meal, vegetables, hydration.

## Rules
- S4 nutrition floors are enforced in code.
- If a user reports being advised against calorie restriction, deficit targets and number-based tracking are disabled and supportive resources are shown.
- No 'earn your food' mechanics linking exercise calories to allowed intake; no body-shaming copy.
- L3 notice before any deficit target; general guidance only, no individual medical nutrition therapy.
- Every food item records its data licence; share-alike datasets are used only with their attribution and licence obligations met (L6).

## Core data entities
EnergyModel, NutritionTarget, FoodItem, Portion, IntakeLog

## Acceptance criteria
- Floors and disable paths are unit- and property-tested; the quick log takes ≤ 3 taps.

## KPIs
- Weekly logging days per user
- Protein target attainment
- Guardrail trigger rate (monitored, not optimised)

## Out of scope
- Meal plans for medical conditions
- Supplement recommendations
