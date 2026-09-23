# M08 — Program Architect — Periodization & Scheduling

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 1 | M00, M01, M06, M07 |

## Purpose
Give every session a place in a plan: split, mesocycle, weekly volume targets, calendar, and graceful reflow when life happens.

## Why (committee review)
Karim: the original spec generates days without a plan. Claire: concurrent training needs rules so hard intervals don't wreck heavy leg days. David: 'When I miss Friday, reflow the week — don't guilt me.'

## Scope
- Split selection by days/week and goal: 2–3 days full body, 4 days upper/lower, 5–6 days push/pull/legs or hybrid, calisthenics skill days.
- Mesocycles of 4–6 weeks (accumulation → deload); goal-specific phases (e.g., fat loss keeps strength work and adds aerobic volume).
- Weekly hard-set targets per muscle by goal and training age (starting points: beginner 8–12, intermediate 10–16, advanced 12–20; to be validated).
- Calendar with reflow: a missed session is shifted or merged by priority; no punitive messaging.
- Concurrent-training placement rules; transition week on goal change.
- Committee-authored program templates plus auto-generated programs.

## Rules
- The scheduler is deterministic and lives in packages/engine/program.
- Reflow never produces more than one extra session per week or two hard sessions for the same pattern on consecutive days.

## Core data entities
Program, Mesocycle, Microcycle, ScheduledSession, VolumeTarget

## Acceptance criteria
- Split, volume and reflow rules are unit-tested; persona programs are golden-tested.

## KPIs
- Planned-session adherence ≥ 70%
- Reflow acceptance rate

## Out of scope
- Competition peaking for athletes (v2)
