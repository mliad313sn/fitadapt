# ADR-021: Fair Pair — partner training on one phone or two

- Status: Accepted (M09)
- Date: 2026-09-24
- Deciders: M09 engineer. Nothing here is validated. The turn time model, the shared-time rule and the equipment changeover need A3 (S&C coach); the Fair Challenge Score coefficients need A5 (exercise physiologist) and its design A6 (behavioural scientist); the partner's data on the owner's phone and the relay need B1 (privacy) and counsel for the consent text and the challenge notice.

## Context

Decision C4 makes Fair Pair a flagship: two people of very different capacity (P1 Ibrahima, 120 kg; P2 Awa, 60 kg) train the same session, first on one phone ("we share one phone on the living-room floor"), then on two. The spec (docs/specs/M09) asks for: individual variants and loads with the same pattern per block; one partner's set as the other's rest; equipment-conflict handling; a Fair Challenge Score relative to each person's own baseline (equal relative effort ±5 %); privacy controls with body weight hidden by default; each partner's SafetyProfile and pain flags applied independently; per-user append-only logs; each partner's own terms, acknowledgment and sharing consent; the challenge opt-in and never rewarding training through pain. The legal risk register lists "injured during a partner challenge". ADR-001 allows WebSocket only for multi-device Fair Pair and forbids timer state in Redis; ADR-002 left "a very active shared object" to M09.

## Decision

### One engine, two people, never a merged profile

- `generatePairSession(inputA, inputB, place, library, ctx)` (packages/engine/src/pair) calls the one `generateSession` once per person with that person's own input: SafetyProfile, joint flags, history, capacity, program, S3 lock, date of birth, deload, readiness. Only two things are shared: the place (equipment and loads, exactly as the Anywhere Switcher) and the time both have. Every gate applies to each person on their own; if either gets no session there is no pair session and each reason stays with its person. There is no merged, averaged or "pair" SafetyProfile anywhere.
- **Shared time.** Turns make a pair session longer than either solo plan, so both are generated for fewer minutes, one minute at a time, until the shared timeline fits the smaller of the two budgets (the engine's own time-boxing trims each plan: accessories first); never below `time.minimumMinutes` (then the timeline says it runs over). Each result carries the input it came from and the device records that input with the plan, so the server re-derives it like any M02 session.
- **`ENGINE_VERSION` stays 0.4.0.** No individual prescription rule changed: a pair plan is an ordinary plan for a smaller minutes input. The pair planner has its own `PAIR_RULES_VERSION` (0.1.0), stored in every `SharedTimeline`.

### The shared timeline (`mergePlans(planA, planB, sharedEquipment)`)

- Blocks: the two plans are aligned on movement patterns by longest common subsequence, keeping each person's own exercise order. A pattern both have is a `shared` block (each does their own variant at their own load); a pattern only one has is a `solo` block. Warm-up, conditioning and cool-down are `together` blocks, each person following their own content.
- Turns: within a block the partners alternate sets ("I go / you go"), so one partner's set is the other's rest. Rest targets are a minimum the timeline never shortens; a superset's recovery is kept (between two sets of one exercise, the rest target plus the other group exercises' set and rest). A handover time separates turns.
- Equipment: an implement at the place is counted by how often it is listed. When both need a single implement, turns are staggered on it; a changeover time is added only when both load it and the loads differ. Swapping an exercise stays the person's M02 swap or skip.
- The timeline never changes a prescription and never mixes the plans: every set of each plan appears exactly once, for its own person, in their order (property-tested). `remainingTimeline` re-plans what is left after sets, pain adjustments or a partner leaving, and keeps the alternation.

### Fair Challenge Score (`fairScore`)

- Points = completed volume × variant/load coefficient ÷ the person's own expected volume, in %. Expected volume is the bottom of each prescribed rep range (or the hold). The load coefficient is done ÷ prescribed load, the variant coefficient the ratio of the M06 %-bodyweight values after a swap; both are capped at 1, and so is each set's credit (`score.setCreditCap` = 1). Body weight and absolute load never enter it. Equal relative effort gives equal scores within 5 % (unit tests for P1/P2 and two 2,000-run properties).
- Never through pain: nothing counts from the first pain report of the session (paused), a red flag ends it (safety stop). There is no winner field: the two scores are shown side by side only when both completed their plan; stopping early, a pain pause or a safety stop ends the comparison without saying why (L4).
- Opt-in: the challenge is on only when both chose the `challenge` scope, after each acknowledged the `pair_challenge` notice (L3) in their own ledger.

### Consent, acceptance and privacy

- New M17 consent data type `partner_sharing` (text `consent.partner_sharing` v1, draft), feature `pair.share_with_partner`. With it, a person shares only their display name, whose turn it is and which set they are on. Per session they choose scopes: `performance` (exercises, reps, loads, reserve), `bodyweight`, `challenge` — all off by default. Pain, red flags, screening answers and the SafetyProfile are never shared under any scope.
- `projectPairEvent` / `partnerView` (packages/privacy) implement this once for the device and the server; the server projects every relayed event by the **sender's** scopes, so a modified client cannot widen them.
- **A guest on the owner's phone is a second person.** Their own namespace in the encrypted device database (`pair.guest.<id>.`) holds their own M17 consent ledger, M20 acceptances and notices, hash-chained defensibility buffer, screening (SafetyProfile re-derived, fail closed without their health consent), date of birth (the S7/M17 age gate and the jurisdiction's ages), optional body weight, sharing choices and their own append-only records, set logs and execution logs. None of it enters the owner's sync outbox or account. They can export it or delete it. The owner's account wipe also removes it (it is on the owner's device).
- Each person's L2 gate is checked for themselves: the guest before they can be chosen, the account partner at create, join and every connection.

### Multi-device relay (`apps/api/src/pair`)

- REST: `POST /v1/pair/sessions` (a six-character join code, stored as a keyed hash, valid for `joinWindowSeconds`) and `POST /v1/pair/sessions/join`.
- WebSocket `/v1/pair/ws` (library `ws`, MIT; attached to the Fastify server's upgrade event): the access token is in the first `hello` message, never in the URL; messages are never logged. Events are stored before they are relayed (`pair_events`, append-only, ordered by `seq` under a row lock, idempotent on the device's event id). A device that reconnects sends its last contiguous seq and receives exactly what it missed; a resend is acknowledged with its original seq and not relayed twice. The server keeps only who is connected: no timer (rests and turns are timed on the devices) and nothing in Redis.
- Each person's training logs are their own sync collections; the relay carries turns, not logs.
- Defensibility (ADR-009): `pair.joined`, `pair.challenge_started` (both chains), `pair.left` (own chain, own reason) and `pair.partner_left` (the partner's chain, never the reason) are written in the same transaction as the pair data; an integration test injects a log failure and shows neither is stored, and the retry stores both. On the device, each person's events go to their own chain.
- A `partner_sharing` withdrawal erases what the relay holds from that person (their participations and events, the sessions they host) in the withdrawal transaction and ends their connection. The relay tables are in the data inventory and the account export (own participations and own events only).

## Alternatives considered

- **One merged plan for both, or an averaged SafetyProfile.** Rejected: it would weaken S1–S7 for the stricter person and is exactly what the brief forbids.
- **Absolute volume or %-e1RM of the heavier lifter for the score.** Rejected: it rewards size, not effort, and invites loading beyond the prescription.
- **Rewarding reps beyond the target.** Rejected (L4): it pressures people to grind; the credit is capped at the prescription.
- **Timers on the server or in Redis.** Excluded by ADR-001 and useless offline; devices keep end times.
- **Relaying set logs through the pair session.** Rejected: logs stay in each person's own append-only collections, so sync can never mix them.
- **The owner's consent standing in for the guest's.** Rejected: the guest is a separate data subject (L2, GDPR Art. 9).
- **`@fastify/websocket`.** Workable, but it adds two more dependencies; `ws` on the upgrade event is enough for one path.
- **CRDT or shared document for the pair session.** Rejected as in ADR-002: an ordered, append-only event log is enough and easier to audit.

## Consequences

- A pair session is shorter per person than a solo session in the same time (the honest cost of taking turns); the timeline says so (`pair.session.time_shared`).
- The partner's data on the owner's phone is protected by the device encryption (ADR-020) but is not backed up or synced; a multi-device partner uses their own account instead.
- Local-network fallback, the asynchronous "ghost" session, group mode (v2) and a device client for the multi-device relay are not built (docs/status/M09.md).
- Every coefficient (`PAIR_CONFIG`, `pairConfig`) is `validated: false`.
