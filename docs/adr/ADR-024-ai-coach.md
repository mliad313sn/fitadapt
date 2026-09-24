# ADR-024 — AI coach: deterministic safety first, engine-only tools, server-side model, runtime output guard

- Status: Accepted (M11)
- Date: 2026-09-24
- Deciders: M11 engineer; to be confirmed by the Product Owner; the eval results and the red-team set are reviewed by seats A1 and B4 at Gate 2 (docs/governance/03 §5)

## Context

M11 adds a conversational coach in FR/EN that explains prescriptions, answers from approved content and changes plans only through the engine (S6). It must never diagnose (L1), must say it is an AI at the start of every conversation and by a persistent label (L5, EU AI Act Art. 50), must hand red flags to the M05 stop flow (S3), must respect the nutrition floors (S4) and must work offline (C8). Model output is untrusted text: prompts are not a safety mechanism on their own.

## Decision

**One pure package, `packages/coach`,** runs the same turn on the server (with a model) and on the device (without one). Its order is the safety argument:

1. **Deterministic pre-screen (FR/EN)** before any model call. Red flags (the five S3 symptoms, incl. "train through chest pain") start the M05 stop flow at once: a `red_flag` execution log, S3 "session ended" and "intensity locked". Crisis, pregnancy (S7), minors (S7; S4 under 18), extreme dieting (S4), role-play as a professional, jailbreaks, attempts to lift a safety limit, "are you human?", requests for a medical assessment and medicine questions get **fixed, reviewed replies**; the model is never asked. The lists fail safe (a false positive costs a fixed reply or a stopped session).
2. **Retrieval over a knowledge registry** (`COACH_CONTENT`: `kb.*` articles in packages/i18n, plus the M06 exercise wording). A question nothing covers gets a scoped refusal, without a model call. Every entry names the seats that must approve it; all are `pending`, and production refuses to start or build with unapproved entries (the M20/M06 rule).
3. **The model** may only answer from the retrieved content, citing it (`[ref:<id>]`), or call **seven tools**: `swapExercise`, `adjustSessionTime`, `requestDeload`, `explainPrescription`, `logPain`, `reschedule` (spec) and `reportRedFlag` (the M20 preamble's "safety tool"). Tool inputs carry **no load, set, rep, reserve, effort or protocol** and are strict (an extra field is invalid); a name outside the list is refused. Each tool calls the engine — M02 `generateSession`/`replacementsFor`, M05 pain classification, M08 `reflowRecord` — and returns only what the engine decided. A refused plan change is explained, and **every other plan-changing tool is blocked for the rest of the turn** (`coach.tool.retry_after_refusal`). Calls per turn and model rounds are bounded.
4. **Runtime output guard** on every model text: the L1 claims linter, no claim to be a human or a professional, no condition named or suspected, no push through pain, no medicine advice, no promise of results, the app's guilt and body-shaming denylists, **every kg/kcal/%/sets/reps number must come from the engine or the cited content**, and only retrieved ids may be cited (a knowledge answer must cite one). A failure is never shown: the user gets a fixed fallback and an **S6 safety event** is logged. A provider refusal or a cut-off answer is treated the same way.

**Replies carry app copy as i18n keys** (the API never returns wording, rule 5): templates are rendered by the client in FR/EN; only the model's own words travel as text.

**Server side (`apps/api/src/ai-coach`).** `POST /v1/coach/conversations` (returns the `ai_coach` notice to show first; recorded as shown), `POST …/:id/messages`, `GET`/`DELETE …/:id`. The **Claude API is called from the API only** (`@anthropic-ai/sdk`, key in `ANTHROPIC_API_KEY` of the API process; none on the device): Claude Opus 5 for plan changes and conversation, Claude Haiku 4.5 for general questions answered from reviewed content (spec: routing simple requests to a smaller model). The stable system prompt — the **M20 legal preamble first**, then the coach rules (`src/ai-coach/prompts`, linted) — and the tool list come first with a cache breakpoint (prompt caching); Opus requests opt into the server-side refusal fallback. Before any tool runs, the server **hardens the device's context** with its own records: the SafetyProfile (the strictest of the stored and the device's), the S3 lock and S2 flags of the stored execution logs (never less strict), the stored program and reflows; today's plan is re-derived by the engine. Records a tool decided (pain report, reflow, red flag) are written **through the sync server with its validators** (M05/M08 re-derivation, S2/S3 events and `program.reflowed` in the sync transaction), as if the device had pushed them; a session proposal is only a proposal: the device starts it and the server re-derives it as any session.

**Audit.** Every tool call (valid or not) is stored with its input in `coach_tool_calls` (health data) and logged in the defensibility file as `coach.tool_call` (tool or `unknown`, outcome, reason code, engine version; never the input). Messages and tool calls are append-only.

**Limits and cache in Redis** (never timer state): per tier (free/premium, M16 decides the tier) and a per-minute burst. A general question is sent to the model **without the user's context or conversation** (data minimisation) and its answer may be cached under a keyed hash; a question with personal data in it is never cached.

**Health data.** Conversations need the `ai_coach` consent; they are exported with the account, erased on withdrawal (in the withdrawal transaction), with the account (cascade), by the user per conversation, and after `conversationRetentionDays`. No message text or tool input reaches a log (redaction paths and the M17 scrubber). No training on user data.

**Offline.** On the device the same turn runs without a model: FAQ from the registry, `explainPrescription` from reason codes, and the deterministic actions (time, lighter day, pain, reschedule, red flag) through the device stores. Workouts never depend on the coach.

**Evals.** `pnpm --filter api eval` runs the golden set (apps/api/eval) through the real turn with deterministic models: a well-behaved one and scripted **misbehaving** ones (the red-team set). Safety-critical cases must pass at 100 % and all at ≥ 95 %, or the command fails; results go to docs/status/M11-evals.md and the rendered outputs through `legal:claims --file`. `pnpm --filter api eval:live` runs the same cases against the real model when a key is present (opt-in, never in CI).

## Alternatives considered

- **Model-only safety (prompt instructions, provider moderation).** Rejected as the only layer: the S3 hand-off and the refusals must hold in airplane mode and whatever the model does. The prompt and the provider's safeguards stay as additional layers.
- **A model-based safety classifier before the main model.** Better recall on paraphrases than keyword lists, but not available offline and itself unvalidated; recommended as a follow-up (open question), with the deterministic screen kept as the floor.
- **The Claude tool runner.** It automates the loop, but every call must be validated by the engine, audited, and blocked after a refusal; a manual loop in `packages/coach` keeps that logic pure and testable on the device.
- **Letting the model write session JSON validated afterwards.** Rejected: S6 says the model never writes prescriptions; with tools that carry no prescription field there is nothing to validate away.
- **Storing conversations on the device only.** Simpler for privacy, but the server needs the history for multi-turn and the audit trail for L11; conversations are consent-gated, exportable, erasable and purged instead.

## Consequences

- The deterministic lists (pre-screen, intents, guard) are the floor of safety and need expert review (A1, A4, B4) and maintenance; their recall on new phrasings is limited (the held-out result is recorded in docs/status/M11.md).
- A device offline for long can hold a stricter SafetyProfile than the server; the server uses the strictest, so a proposal may later be refused at sync until the screening arrives (fail safe).
- Session proposals are applied only when the user taps them; an in-session swap proposal is shown, and the swap itself uses the workout screen's own swap (the same engine function).
- Changing the model ids, the system prompt or the tools requires re-running the evals (and the live run before release).
