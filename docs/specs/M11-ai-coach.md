# M11 — AI Coach (grounded, safety-bounded)

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 2 | M00, M02, M05, M06, M10, M17 |

## Purpose
A conversational coach in FR/EN that explains prescriptions, answers questions from approved content, and changes plans only through the engine.

## Why (committee review)
Sam: conversational coaching is expected; it must be differentiated by grounding and safety. Yuki: the LLM is never the source of truth for prescriptions — it proposes, the engine validates. Dr. Amina: no diagnosis; escalate red flags. David: 'I want to say my knee hurts, change today — and have it done.'

## Scope
- Chat (and voice via M14) with minimal context: profile summary, SafetyProfile, current program and recent logs.
- Tool calls to engine APIs: swapExercise, adjustSessionTime, requestDeload, explainPrescription, logPain, reschedule — all validated by the engine and safety layer.
- Grounded answers from committee-approved content (M06 cues, articles) with inline source references; out-of-scope questions politely declined.
- Guardrails: red-flag detection hands off to the M05 flow; S4 respected in nutrition talk; no medical advice.
- Evaluation suite of ≥ 200 conversations (safety, accuracy, tone, FR/EN) run in CI with thresholds.
- Server-side model proxy (e.g., Claude API): no keys on device, rate limits per tier, caching, routing of simple requests to a smaller model.
- Offline fallback: FAQ and deterministic actions.

## Rules
- S6: all plan changes go through engine APIs; the model cannot write prescriptions directly.
- Safety-critical evals must pass at 100%; overall eval pass rate ≥ 95%.
- Conversation data retention is minimal and configurable; no training on user data without explicit consent.
- L5: AI disclosure at the start of every conversation and a persistent AI label; outputs never claim to be from a human professional.
- Model-provider usage policies are followed, including any disclosure requirements for consumer-facing use.

## Core data entities
Conversation, Message, ToolCallAudit, EvalCase, EvalRun

## Acceptance criteria
- Eval suite passes thresholds in CI; tool calls are audited; the red-flag hand-off is E2E-tested.

## KPIs
- Coach-assisted adjustments per active user
- Thumbs-up rate ≥ 85%
- Cost per monthly active coach user

## Out of scope
- Free-form program generation by the model
- Medical triage
