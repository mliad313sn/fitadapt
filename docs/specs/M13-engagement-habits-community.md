# M13 — Engagement, Habits & Community

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 3 | M00, M04, M09 |

## Purpose
Help people keep showing up — through habit design, meaningful achievements and partner accountability — without dark patterns.

## Why (committee review)
Dr. Sofia: implementation intentions and forgiving streaks work; guilt and notification spam don't. Sam: partner invites and referrals are the cheapest acquisition. Mariam: 'No leaderboards comparing me to 25-year-olds.'

## Scope
- Smart reminders scheduled from the user's own plan ('after work, Mon/Wed/Fri, living room').
- Weekly check-in and short reflection.
- Streaks that count planned rest days, with a streak-freeze allowance.
- Achievements tied to real progress: personal records, variant unlocks, consistency.
- Private challenges with a partner or small group; referral and partner invites; privacy-safe share cards (no bodyweight by default).

## Rules
- Notification budget: max one per day by default, quiet hours respected.
- No public bodyweight or body-shape leaderboards; social features are opt-in.
- Marketing messages require a separate opt-in; referral programme has its own terms; community content has report/block and a moderation queue (L10); no testimonial without recorded consent (L12).

## Core data entities
Reminder, Streak, Achievement, Challenge, Invite, Referral

## Acceptance criteria
- Notification budget and streak rules unit-tested; share cards contain no hidden personal data.

## KPIs
- Week-4 retention ≥ 35%
- Invite conversion
- Notification opt-out rate < 10%

## Out of scope
- Public social feed
