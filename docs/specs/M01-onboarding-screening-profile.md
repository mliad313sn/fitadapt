# M01 — Onboarding, Health Screening & Dynamic Profile

| Status | Phase | Depends on |
|---|---|---|
| Enhanced (original Module 1) | Phase 1 | M00, M06 (equipment taxonomy) |

## Purpose
Learn who the user is, what they want, what they have and whether it is safe to train them — in under four minutes — and keep that profile current automatically.

## Why (committee review)
Dr. Amina: a product that targets 120 kg beginners and offers HIIT cannot ship without pre-participation screening. Ibrahima: 'Don't make me measure body fat on day one — I'll quit.' Dr. Sofia: the user's reason and realistic schedule predict adherence better than biometrics. Léa: people train in several places, so equipment must be per location.

## Scope
- Progressive onboarding (≤ 4 min to first workout): primary + secondary goal, experience, schedule (days/week, minutes/session), locations and equipment, then biometrics, then screening.
- Goals: fat loss (séchage), muscle gain, strength, calisthenics skills, general health/longevity, endurance.
- Health screening based on PAR-Q+ (licence to be checked) with outcomes Cleared / Cleared with restrictions / Consult a professional; re-screen every 12 months or on a newly reported condition.
- Multiple equipment profiles (Home, Gym, Travel, Park) built from a checklist; location chosen at session start.
- Limitations by body region, exercises to avoid, preferred training times, reminder preferences and a one-line motivation anchor.
- Dynamic profile fields updated automatically: bodyweight trend (M04), training age, capacity estimates (M07).

## Rules
- Age gate at 16; users aged 16–17 have deficit nutrition features disabled (S4, S7).
- Screening outcome produces a SafetyProfile (maxRPE, allowHIIT, allowMaxTests, impactCeiling) consumed by M02, M03, M07 (S1).
- Pregnancy/postpartum routes to professional guidance and a low-intensity library only (S7).
- Weight and body fat are optional at onboarding and can be deferred; language is neutral and non-judgemental.
- One screening question asks whether a health professional has advised against calorie restriction (feeds S4).
- L2: the first workout is unreachable until current Terms, Privacy Policy, health-data consent and exercise-risk acknowledgment are accepted; acceptance is recorded with version, locale, jurisdiction and timestamp.
- The age gate uses 16 or the higher minimum required in the user's jurisdiction.

## Core data entities
Profile, Goal, EquipmentProfile, ScreeningResponse, SafetyProfile, Limitation

## Acceptance criteria
- Onboarding path completes in ≤ 12 screens in FR and EN.
- Every screening branch yields the correct SafetyProfile (table-driven tests).
- Switching equipment profile changes the available exercise pool.
- Skipping weight and body fat never blocks progress.

## KPIs
- Onboarding completion ≥ 80%
- Median time to first workout < 10 min
- Share of users with ≥ 2 equipment profiles

## Out of scope
- Medical diagnosis
- Uploading or storing medical documents
