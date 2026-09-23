# M16 — Monetization & Subscriptions

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 3 | M00, M17 |

## Purpose
A clear freemium model with partner and coach plans, store-compliant billing and regional pricing.

## Why (committee review)
Sam: Fair Pair naturally supports a two-seat plan. Me. Hélène: payment and paywall rules differ by store and region. Committee: safety features are never behind a paywall.

## Scope
- Tiers: Free (home programs, tracking, safety features); Premium (full adaptive engine, gym programs, AI coach, nutrition, multi-device Fair Pair); Duo (two seats); Coach plans.
- In-app purchases via App Store and Google Play with an entitlement service (e.g., RevenueCat); server-side entitlement checks.
- Regional pricing; web checkout with local payment methods (cards, mobile money) only where store rules allow.
- Trials, paywall experiments (via M18), refunds and restore purchases.

## Rules
- Screening, pain monitoring, red-flag handling and data export are free forever.
- Entitlements are verified server-side; the client cannot unlock features locally.
- L8: cancellation reachable in no more steps than purchase; trial-end reminder; prices with applicable taxes; withdrawal-right handling per jurisdiction.

## Core data entities
Plan, Entitlement, Subscription, Seat, Transaction (processor references only)

## Acceptance criteria
- Entitlement tests with sandbox/webhook fixtures; paywall never gates safety features.

## KPIs
- Trial → paid conversion
- Duo plan share
- Monthly churn

## Out of scope
- Ads
- Selling user data
