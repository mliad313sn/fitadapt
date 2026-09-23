# M09 — Fair Pair — Partner & Group Training

| Status | Phase | Depends on |
|---|---|---|
| New (from original 1.2 / 2.3) | Phase 2 | M00, M02, M04, M06 |

## Purpose
Let two people of very different capacity train the same session together — on one phone or two — with individual prescriptions and fair competition.

## Why (committee review)
Ibrahima and Awa: 'We share one phone on the living-room floor.' Karim: equalise by relative intensity (e1RM %, ladder level, RIR), not absolute load. Dr. Sofia: partners improve adherence; design for cooperation as well as competition. Raj: WebSockets only for multi-device sessions.

## Scope
- Modes: single-device (shared screen, 'I go / you go' turns), multi-device (real-time via WebSocket with local-network fallback), remote 'ghost' session (train asynchronously against a partner's recorded session).
- Pair planner: merges two SessionPlans into one timeline — same pattern, individual variant and load; one partner's set is the other's rest when rest targets allow; shared circuits with individual reps.
- Fair Challenge Score: points relative to each person's own baseline (completed volume × variant/load coefficient ÷ personal expected volume).
- Equipment conflict handling (one barbell → staggered turns or swap).
- Privacy controls: partners see only what is shared; bodyweight hidden by default.
- Group mode up to 6 people for coaches/classes (v2).

## Rules
- Each partner's SafetyProfile and pain flags apply independently.
- Logs stay per user (append-only), so sync conflicts cannot mix partners' data.
- Equal relative effort yields equal Fair Challenge Scores within ±5%.
- Each partner accepts their own terms and acknowledgment; sharing any data with a partner requires that partner-specific consent; Fair Challenge scoring is opt-in and never rewards training through pain.

## Core data entities
PairSession, Participant, SharedTimeline, FairScore

## Acceptance criteria
- Single-device E2E session for P1 + P2; multi-device sync test; fairness tests.

## KPIs
- Share of paying users using Fair Pair ≥ 25%
- Paired users' W4 retention vs solo

## Out of scope
- Public matchmaking with strangers
