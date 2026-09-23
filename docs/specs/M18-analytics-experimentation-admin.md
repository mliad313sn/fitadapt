# M18 — Analytics, Experimentation & Admin CMS

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 3 | M00, M06, M17 |

## Purpose
Measure what matters, experiment safely, and manage content and engine coefficients with review and rollback.

## Why (committee review)
Sam: no product decisions without funnels and retention. Dr. Julien: engine coefficients must be tunable without app releases, but only through a reviewed, versioned process. Yuki: analytics must be privacy-respecting.

## Scope
- Product analytics with an event taxonomy, funnels and retention (privacy-respecting tool, EU hosting or self-hosted).
- Feature flags and A/B experiments.
- Remote config for engine coefficients: versioned, two-person approval (expert + engineer), staged rollout, one-click rollback.
- Admin CMS for exercises, programs, articles, food items and translations with two-person review.
- Support tooling: user lookup with audited access.

## Rules
- Analytics events carry IDs and coarse categories only — no health values or free text.
- Safety-invariant parameters (S1–S7 thresholds) cannot be changed via remote config.
- Experiments and remote config can never target legal flows (acceptance, notices, AI disclosure, cancellation) or safety flows.

## Core data entities
Event, Experiment, Flag, ConfigVersion, ContentItem, Review

## Acceptance criteria
- Taxonomy validation; config versioning and rollback tests; CMS review workflow E2E.

## KPIs
- Experiments shipped per month
- Time to publish reviewed content

## Out of scope
- Building a custom BI warehouse in v1
