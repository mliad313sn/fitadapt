# M19 — Launch Readiness & Go-to-Market

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 4 | All |

## Purpose
Turn a working product into a launched one: quality gates, accessibility, localisation, store readiness, beta, expert sign-off and go-to-market.

## Why (committee review)
Élise: define 'ready' in numbers. Me. Hélène: store data-safety forms and claims review block launches. Sam: launch with a partner story (Fair Pair) and a coach channel. Committee C10: a real advisory board signs off before public launch.

## Scope
- Quality gates: crash-free sessions ≥ 99.5%, API p95 < 300 ms, cold start < 2.5 s on the reference low-end device, offline session success ≥ 99%.
- Accessibility audit (WCAG 2.2 AA) and FR/EN localisation QA.
- Store readiness: listings and screenshots FR/EN, App Store privacy details and Google Play data-safety form, review notes, content rating.
- Beta programme via TestFlight and Google Play closed testing, with structured feedback.
- Real advisory board sign-off on all validated:false items (C10).
- Go-to-market: positioning, pricing test, coach and gym partnerships, content plan, launch analytics dashboard, support and FAQ.

## Rules
- Launch is blocked while any gate fails or any safety-relevant item is unvalidated.
- Launch is blocked until counsel sign-off per launch jurisdiction, trademark clearance, bound insurance, company incorporation, green licence scan and green claims linter are recorded.

## Core data entities
LaunchGate, ChecklistItem

## Acceptance criteria
- A launch-check script reports all gates green; store metadata committed; advisory sign-off recorded.

## KPIs
- Activation ≥ 60%
- W4 retention ≥ 35%
- Store rating ≥ 4.5

## Out of scope
- Paid acquisition at scale before retention targets are met
