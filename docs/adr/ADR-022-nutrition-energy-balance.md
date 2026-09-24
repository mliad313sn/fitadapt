# ADR-022: Nutrition and energy balance — S4 in packages/safety, the engine's nutrition target, an original food seed, and the M04 hand-off

- Status: Accepted (M10)
- Date: 2026-09-24
- Deciders: M10 engineer. **Nothing here is validated.** Every coefficient is `validated: false` (docs/status/M10.md): the energy equation, activity factors, protein range, adaptive update and guardrail pause need A4 (registered dietitian) with A5 (exercise physiologist) and A1 (physician); the food seed and hand portions need A4; the copy and denylists A6 (behavioural scientist) and a native FR editor; the medical-device and regulated-profession boundary B4 and counsel; the data flows B1.

## Context

M10 (docs/specs/M10-nutrition-energy-balance.md) adds the minimum nutrition a fat-loss or muscle-gain goal needs, inside S4: energy target never below the estimated BMR; planned loss ≤ 1 % body weight a week; no goal weight below BMI 18.5; deficit features disabled under 18 or when the user reports being advised against calorie restriction. M01's SafetyProfile already carries `deficitNutritionAllowed` (minor or advised against); M04 already hands sustained loss (> 1 %/week for 3 weeks) to an M10 inbox stub; M20 already registered the `nutrition_deficit` L3 notice. Risks: RSK-03 (regulated professions — no individual medical nutrition therapy), RSK-08 (licences — share-alike food datasets such as ODbL are refused by `pnpm legal:licences`), disordered eating (no earn/burn-off mechanics, no guilt, no body judgement).

## Decision

### S4 lives in packages/safety, as constants

- `packages/safety/src/nutrition-floors.ts`: `S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK = 1`, `S4_MIN_GOAL_BMI = 18.5` and M01's `S4_DEFICIT_MINIMUM_AGE_YEARS = 18` are constants; there is no switch or option. `deficitFeatures(profile, birthDate, today)` reads the M01 SafetyProfile (extended, not forked: no new field was needed) **and** re-checks the age from the birth date, so a tampered profile cannot open deficits for a minor. It also fails closed for "not screened" and for a special population (S7 pregnancy/postpartum) — stricter than the S4 text (open question for A4/A1).
- `enforceNutritionFloors(proposal, ctx)` turns any proposal (NaN, infinities, negative, 5 %/week, goal weights far below the floor) into one that satisfies S4, or returns `invalid` (no deficit). `nutritionTargetViolations` re-checks a stored target; `nutritionFloorCheck` is the `SafetyCheck`. Adversarial fast-check properties (5,000 runs each) cover both.
- The only coefficient S4 needs — the energy density that converts a daily deficit into a weekly rate (7,700 kcal/kg, a rule of thumb) — is `NUTRITION_SAFETY_CONFIG` in packages/safety with `validated: false`, and the engine reads the same value, so the deficit and the S4 check use one number.
- **Every deficit-disabled user gets no calorie number at all** (supportive mode), whatever the goal — stricter than "deficit features disabled" (a 17-year-old asking for muscle gain gets habits, not a surplus target). Open question for A4.

### The engine prescribes the target; nothing else computes one

- `packages/engine/src/nutrition`: `mifflinStJeorBmr` (10·kg + 6.25·cm − 5·years + 5 / −161; "unspecified" uses the midpoint −78), `activityFactor` (1.2 → 1.9), `adaptiveExpenditure` (weekly: expenditure ≈ mean logged intake − Δtrend × energy density over 14 days, needing 10 logged days; each update moves half-way from the previous estimate and stays within ±25 % of the formula), `computeNutritionTarget(input, ctx)` (goal targets through `enforceNutritionFloors`; rounding only up; protein 1.6–2.2 g/kg on a reference weight at BMI 25 when the weight is higher), `guardrailStatus` / `targetDue`, hand-portion and food estimates. All values in `NUTRITION_CONFIG` (`ENGINE_CONFIGS.nutrition`), all `validated: false`.
- Modes: `numeric` (energy, floor, deficit/surplus, protein, pace), `supportive` (deficit features off, or the user chose "habits, no numbers") and `needs_measurements`. The schema itself refuses numbers outside `numeric`, a target below its floor and a deficit when deficit features are off.
- **`ENGINE_VERSION` stays 0.4.0.** No existing prescription changed (the persona goldens are untouched); nutrition targets carry their own `NUTRITION_RULES_VERSION` (0.1.0) with the engine version, as M09 did for the pair planner.
- Every target carries reason codes with FR/EN sentences (`engine.reason.nutrition.*`), none with a number.

### Records, device and server

- Sync collections `nutrition_plans` (the engine's input and target, the reason it was computed, and `supersedes`, which orders plans made in the same millisecond), `intake_logs` (hand portion or seed food, with the engine's estimate; corrections are new entries) and `habit_checks`, all append-only and health data: synced only with the health consent (feature `nutrition.tracking`), erased on withdrawal.
- The server re-derives every plan with the engine (only the target id, drawn from the device's seed, is not re-derived) for the SafetyProfile of the latest stored screening and the stored birth date, re-checks S4, checks intake estimates on the seed, and writes `nutrition.target_set` (versions, mode, reason, codes — never a calorie, weight or intake value) and the S4 `safety.event`s in the sync transaction (ADR-009).
- On the device, `NutritionProvider` keeps the plan current without the screen being open: a new M04 hand-off, the weekly update or a changed SafetyProfile each store a new plan, logged to the device defensibility buffer.

### The M04 hand-off is handled, not queued

`createGuardrailInbox(kv, onReceive)` now calls the nutrition store when M04 hands an event off. The engine then **pauses any planned deficit for 14 days** (M04's copy promises "will not suggest eating less for now") and afterwards **caps the pace at 0.5 %/week until day 56** (S4 `safety.event`, action `deficit_reduced`, new in the payload schema). The inbox keeps the event until the user has seen M10's supportive notice on the nutrition screen, which then consumes it — M04's inbox semantics and tests are unchanged.

### Point of risk, copy, food data

- **L3:** choosing fat loss with numbers shows the M20 `nutrition_deficit` notice first; the pace and Save appear only after it is acknowledged (once per version; `notice.shown` / `notice.acknowledged` in the device chain).
- **Copy:** `nutritionCopyPhrases` (packages/i18n) denies earn / burn it off / cheat meal / guilt-free / junk food / detox… and the French equivalents (mériter, éliminer, repas de triche, écart, malbouffe, déculpabiliser…), whole words, accent-insensitive; checked with the M08 guilt and M04 body-shaming denylists and the C9 fat-burn guard over every nutrition and food message. No condition-specific diet exists; the copy says "general guidance… not medical advice or a diet for a health condition" and points to a doctor or registered dietitian.
- **Food data:** no third-party database. `packages/food-library` ships an **original seed of 270 foods** (generic foods; dishes of Senegal, West and Central Africa, North Africa, France) with typical portions. Every value is the engineer's estimate: `source: { kind: 'estimate', note }`, `licence: 'Owned'`, `validated: false` per item; the schema refuses an item without a source or a licence, a share-alike licence, or `validated: true` without a sign-off. Names (FR/EN) are in packages/i18n; local names (Wolof or regional usage) are returned by `foodLocalName` and kept out of the FR/EN catalogues, whose parity test requires the two languages to differ. Asset register: DATA-004 in use; DATA-002 (a third-party table) not in use.

## Alternatives considered

- **Import an open food database** (e.g. an ODbL table): refused by the licence policy (share-alike) and RSK-08; also weak on regional dishes. An original, clearly-estimated seed is honest and replaceable once A4 picks a licensed table.
- **Keep deficits for minors but hide numbers** or **allow a surplus for minors**: rejected for v1 (stricter default); open question.
- **Bump ENGINE_VERSION to 0.5.0**: would invalidate stored assessments/programs/sessions (the server refuses other engine versions) without any training prescription changing; the nutrition rules version identifies nutrition behaviour instead.
- **Consume the M04 inbox only when the screen opens**: would leave a deficit running after a sustained-loss signal; the provider applies it at once.
- **Barcode scan and photo estimates**: v1.1 and v2 in the spec; not built.

## Consequences

- S4 is enforced three times: the engine (through packages/safety), the schema refinements, and the server's re-derivation plus re-check.
- Everything numeric is an unvalidated estimate; the release cannot claim accuracy (L1). The seed's values, the energy equation, the activity factors and the protein range need A4/A5 review before launch.
- Nutrition data is health data on the device (encrypted database, ADR-020) and on the server (health consent, erasure on withdrawal); records of processing P10.
- KPIs (weekly logging days, protein attainment, guardrail trigger rate) have no events yet (M18).
