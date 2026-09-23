# ADR-015 — Program architect: periodization, scheduling, reflow, and the API M02 builds on

- Status: Accepted (M08)
- Date: 2026-09-23
- Deciders: M08 engineer; templates, volume targets and every coefficient pending review by seats A3 (S&C coach) and A5 (exercise physiologist); S1 behaviour of the program by A1

## Context

M08 must give every session a place in a plan: a split chosen by days per week and goal, mesocycles of 4–6 weeks ending in a deload, weekly hard-set targets per muscle by goal and training age ("starting points, to be validated"), a calendar with reflow when a session is missed (≤ 1 extra session per week, never two hard sessions for the same pattern on consecutive days, no punitive copy), concurrent-training placement (no hard intervals the day before a heavy lower-body day when avoidable) and a transition week on goal change. The scheduler must be deterministic and live in `packages/engine/program`. Programs must respect the SafetyProfile (S1, S7) and the equipment profile of each scheduled place (M01), without re-implementing screening. M07 left a re-assessment prompt at "4 weeks after the assessment until M08 supplies the real mesocycle end". M02 (session generation) comes next and must build on this model. Any defensibility event must be written in the same transaction as the change it records (ADR-009, fixed in `3bff4b8`).

## Decision

### Model (contracts in `packages/shared/src/program.ts`)

- `Program` → `Mesocycle[]` (4–6 weeks each, schema-enforced; last week is the deload) and `Microcycle[]` (one calendar week: kind `accumulation | deload | transition`, volume factor, `VolumeTarget[]`, aerobic minutes, `ScheduledSession[]`).
- `ScheduledSession`: date and weekday (local calendar dates `YYYY-MM-DD`, no time zone), focus, the M01 equipment profile and location it is planned for, `ProgramSlot[]` (movement pattern, role primary/secondary/accessory, intent strength/hypertrophy/general/skill/balance/mobility, hard sets), optional conditioning (steady or intervals, whole session or finisher), `targetRpe` (already capped by S1), `hardPatterns`, `heavyLower`, `priority`, estimated minutes and reason codes.
- `VolumeTarget` per muscle group (chest, back, shoulders, arms, quads, glutes/hamstrings, core): range min/max by training age, this week's target, `planned` (fractional counting of secondary muscles) and `direct` sets.
- Synced records: `ProgramRecord` = the program **with the inputs it was derived from** (`ProgramInput`: goals, experience, days, minutes, optional chosen days, start date, SafetyProfile, places, per-weekday place, previous goal), collection `programs`; `ReflowRecord` (program, session, the day it was reported, outcome shifted/merged/skipped, engine version, reason codes), collection `program_reflows`. Both append-only; both health collections (the input embeds the SafetyProfile), erased when health consent is withdrawn.

### Engine (`packages/engine/src/program`)

- **Templates are data** (`templates.ts`): week templates per goal × 1–6 days following the spec (2–3 full body, 4 upper/lower, 5 hybrid push/pull/legs + upper/lower, 6 push/pull/legs; fat loss keeps the strength sessions and adds finishers or cardio days; endurance and health alternate full body with cardio or mobility/balance days; calisthenics adds skill days), session templates as movement-pattern slots. They are the engineer's drafts, not committee-authored: A3 must review them. 7 days → 6 (one rest day kept, config).
- **Layout** (`schedule.ts`): session templates are assigned to training days by trying permutations in lexicographic order (≤ 720); the first that never puts a shared hard pattern on consecutive days (also Sunday → Monday, since the week repeats) and lets the week's intervals sit on a session that is not the day before a heavy lower-body day wins, so the template order is kept when valid. The user's chosen days are used if valid, otherwise evenly spread defaults (every template is proven schedulable on them).
- **Concurrent training**: one intervals element per week for fat loss and endurance, only from week 3 (M03: two weeks of training first), never in deload or transition weeks, only when S1 (`screeningGateCheck`) allows HIIT. If no layout of the user's days keeps it off the day before a heavy lower-body day, the week stays steady (`program.concurrent.intervals_replaced`) — i.e. the program never places intervals there at all, which is stricter than "when avoidable".
- **Volume** (`volume.ts`): weekly target = min + goal position × (max − min), plus one set per accumulation week, capped at max; deload × 0.5, transition × 0.7. Sets are allocated greedily, one at a time, to the slot whose main group is furthest below target (relative), with small bonuses for primary/secondary slots and a spread penalty; never above a group's cap, a slot's maximum or the session's time (warm-up + 3 min per hard set + finisher). Balance/mobility slots have fixed sets and do not count. When time is short, the week says so (`program.volume.time_limited`) rather than overrun the session.
- **Mesocycles**: 3 per program; 6/5/4 weeks for beginner/intermediate/advanced (bounded by the spec's 4–6 as constants); goal-specific intents (e.g. strength: hypertrophy → strength → strength); effort ramps RPE 7 → 8 through a block, 6 in deload, 6.5 in transition; every week's RPE is capped through `screeningGateCheck` (S1: ≤ 7 while a flag is unresolved). The program starts on the Monday on or after the start date.
- **Places**: each session is planned for its place (`locationByWeekday` → default → first place); a slot is kept only if the place's equipment and the SafetyProfile allow at least one exercise of its pattern, using the M06 `blockingReasons` (never a re-implementation); a session with nothing possible is dropped with a reason.
- **Safety**: S7 (no automatic programming / low-intensity library), `blocked` and `not_screened` → no program; S1 caps → returned as `safety.event`s.
- **Reflow** (`reflow.ts`): `decideReflow(program, reflows, sessionId, reportedOn)` → (1) shift to the earliest free day from the report day to the end of the week that keeps every week rule; (2) otherwise, for a strength session, merge its primary slots (≤ 2 sets each, within the session time, as secondary slots) into the next strength session of the week that keeps the rules; (3) otherwise skip — the week goes on. Week rules (`weekViolations`): no more sessions than planned, at most one on a day that was not a planned training day, one per day, inside the week, no shared hard pattern on consecutive days (including the neighbouring weeks), no intervals the day before a heavy lower-body day. `effectiveWeeks(program, reflows)` replays the records in order and ignores any record the engine would not decide at that point, so the calendar always keeps the rules.
- **Queries** (`queries.ts`): `programDay` (M02), `scheduledDeloads` / `deloadOn` (M05), `reassessmentDateFor` (M07: the day after the end of the mesocycle containing the assessment; an assessment made in a deload week counts for the next block; null after the program).
- Every coefficient is in `PROGRAM_CONFIG` with `source` and `validated: false`; spec rules (4–6 weeks, ≤ 1 extra session) are constants. `PROGRAM_RULES_VERSION` is stored with each program. Deterministic: injected clock and seed (program id from the seeded RNG).

### Device, server and defensibility

- The app builds programs and decides reflows **on the device** with the engine (offline), stores them as sync records and shows them on the calendar screen (`/calendar`, behind the same L2 gate as the first workout). S1 caps go to the device defensibility buffer.
- The server re-derives: a program must equal `generateProgram(input)` (same engine and rules versions, clock = `generatedAt`, the recorded seed) for the SafetyProfile it derives from the user's latest stored screening (`evaluateScreening`), with every place equal to a stored equipment profile; a reflow must equal `decideReflow` over the stored program and the reflows already stored. Refusal codes: `program.invalid`, `program.engine_version_unsupported`, `program.safety_profile_mismatch`, `program.equipment_mismatch`, `program.not_allowed`, `program.mismatch`, `program.reflow_*`.
- New defensibility event types `program.generated` (program id, engine version, rules version, template id, reason codes) and `program.reflowed` (program id, session id, outcome, engine version), plus the program's S1 `safety.event`s, are appended **by the sync listener, inside the sync transaction** of the record (`LegalService.recordProgramGenerated/Reflowed` require the transaction). A failed log write rolls the record back and fails the push; the device retries (integration test with an injected trigger failure). The legal-hold export has a `programs` section and counts their engine versions.
- M07: when a program exists, `useReassessment` passes `reassessmentDateFor(...)` at local midnight to `reassessmentStatus`; otherwise the 4-week default stays.

### The API M02 builds on

M02 generates the session for a day from the program, not instead of it:

1. `programDay(program, reflows, date)` → `{ sessions: EffectiveSession[], microcycle, mesocycle }` after the recorded reflows. Each `EffectiveSession` is a `ScheduledSession` plus `state` (planned/shifted), `originalDate` and `mergedFrom` (merged-in slots are already in `slots`, as secondary).
2. For each `ProgramSlot`, M02 picks an exercise of `pattern` from the M06 graph for the session's `equipmentProfileId` (or the place the user switches to: Anywhere Switcher), the SafetyProfile, joint flags (M05) and the capacity rung (M07), and prescribes **exactly `hardSets` hard sets** at an effort **≤ `targetRpe`** (S1 is already applied; M02 re-checks with `screeningGateCheck`), with a rep range from `intent` and the mesocycle intent. Its time-boxing must not exceed `estimatedMinutes` rounding; trimming removes accessory then secondary sets first.
3. `microcycle.kind === 'deload'` (and `deloadOn` for M05) tells M02 and M05 that volume and effort are already reduced; M05 adds triggered deloads as its own records on top (it must not edit a program).
4. `conditioning` is handed to M03 (steady or intervals, whole session or finisher after the strength work); M03 keeps its own HIIT gate.
5. M02 should extend `generateSession()` with an optional `programSession: EffectiveSession` input (plus `microcycle` and `mesocycle`), keep every guarantee of ADR-014 (S1, S2, S5, time), and record its prescriptions with `recordPrescription(userId, payload, tx)` in the transaction that stores them.

## Alternatives considered

- **Store only the program, recompute reflows on read**: loses what the user was told; append-only reflow records keep the history and let the server check each decision.
- **Mutable program record edited by reflow**: conflicts across devices and breaks re-derivation; append-only + replay avoids both.
- **Schedule intervals the day before a heavy lower-body day when the user's days leave no other spot ("unavoidable")**: rejected; the week keeps steady cardio instead, which also satisfies the rule.
- **Absolute weekly set targets without fractional counting**: overstates arm and shoulder work from presses and rows; fractional counting is reported (`planned`) next to direct sets, and caps apply to each group's own work.
- **Start the program on the day it is made**: partial first weeks would break the weekly volume model; programs start on the next Monday (the M07 first session covers the days before).
- **Bump `ENGINE_VERSION`**: changes the engine version recorded for M01/M07 events and existing test expectations; the program carries its own `rulesVersion` instead (open question for M19).

## Consequences

- Nothing here is validated: templates, volume ranges and positions, contributions, mesocycle lengths, RPE ramps, deload/transition factors, time model, allocation weights and reflow merge size are `validated: false` and need A3/A5 (and A1 for the S1 behaviour).
- A changed profile (goal, days, minutes, places) needs a new program (the calendar offers it on a goal change or after the program ends); a program whose inputs no longer match the latest screening is refused by the server.
- A client with another engine or rules version cannot sync programs or reflows until it updates (as for M07 assessments).
- Reflow records are ordered by their decision time on the device; two decisions in the same millisecond could replay in another order, in which case the second is ignored (the calendar still keeps the rules).
