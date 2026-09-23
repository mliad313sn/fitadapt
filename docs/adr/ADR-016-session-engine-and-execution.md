# ADR-016: Session engine (double progression, increments, time-boxing) and offline execution

- Status: Accepted (M02)
- Date: 2026-09-23
- Deciders: M02 engineer. Every rule and coefficient still needs review: seats A3 (S&C coach) and A5 (exercise physiologist) for prescription, progression, time-boxing and increments; A2 (physiotherapist) for the joint rules (S2 substitution, amber penalties, pain flag during a session).

## Context

M02 turns the M08 program day, the M07 CapacityModel, the M06 graph and the user's history into today's session. It also provides the screen that runs the session in the gym, offline. ADR-014 already defined a pure `generateSession()` for the M07 first session, with S1, S2, S5 and time guarantees. ADR-015 designed the API M02 builds on (`programDay`, `ProgramSlot`, `targetRpe`, `recordPrescription` in the transaction). Every issued prescription must be defensible (L11). The user must be able to stop and skip in every state (L4), and the first session must show the L3 notice.

## Decision

### One generator, extended (never a second one)

- `generateSession(input, ctx)` in `packages/engine/src/session/generate.ts` is the only entry point. The M07 `firstSession` and the new `programSession` are the two routes behind it. The input and the result are zod-parsed at the boundary (`GenerateSessionInputSchema` and `GenerateSessionResultSchema` in `packages/shared/src/session.ts`).
- Gates run in this order, before any route:
  1. blocked;
  2. not screened;
  3. professional guidance, or the low-intensity library (S7/M01);
  4. the S1 effort cap (from `screeningGateCheck`);
  5. the M17 age gate: under 16 on the engine clock's date (S7);
  6. the S3 intensity lock.
  Each gate returns `unavailable` with a reason code. None of them can be configured.
- Routing:
  - with `programSession` (ADR-015 item 5), the program session;
  - otherwise, with a capacity model, the M07 first session;
  - otherwise, `session.unavailable.no_program`.
- The engine is pure. It uses only the injected clock and seed, and the plan id comes from the seeded RNG. `purity.test.ts` checks that there are no I/O imports and that output is the same for the same clock and seed. ESLint bans `Date.now`, `Math.random`, `node:` imports and `fetch` in the engine.
- `ENGINE_VERSION` goes from 0.1.0 to 0.2.0, because the M07 first-session prescriptions change: equipment-aware rounding, and future-dated loads now count for S5. `SESSION_RULES_VERSION` (0.1.0) is stored in every plan, next to the engine version.

### Prescription rules (`packages/engine/src/session`)

- **Slots come from the program.** Each `ProgramSlot` gets exactly its `hardSets`, at the session's reps in reserve. The RIR comes from `targetRpe` (already capped by S1) and is re-checked through `screeningGateCheck`.
- **Exercise choice, in order:**
  1. continuity: the same exercise last used for this pattern and role;
  2. a ladder move decided by `evaluateProgression`;
  3. the M07 capacity rung;
  4. a default ranked among the allowed exercises only, with a penalty for skill above the user's level and for loading amber joints.
- **Blocked exercises.** A blocked or unavailable choice is mapped in this order:
  1. down its ladder, to siblings on the same rung first, then lower rungs (`session.exercise.stepped_down`);
  2. then through M06 `substitute()`: `switcher.mapped` after a place change (Anywhere Switcher), or `substituted`, with the S2 code when a red joint caused it.
  A loaded exercise already used in another role is avoided, so that its S5 references stay separate.
- **Double progression** (`evaluateProgression`):
  - when every working set reaches the top of the range at or below the target effort, the load rises by the smallest achievable step that is at least 2.5 % (upper body) or 5 % (lower body), and the reps go back to the bottom of the range;
  - two sessions below the range, or a set at RPE ≥ 9.5 (RIR 0), cut the load by 10 %;
  - a bodyweight exercise at the top of the range for two sessions moves to the next ladder variant at the bottom of its range; two sessions below the range step it down one variant;
  - holds go up by 5 s, and move to the next variant at 60 s;
  - a deload week never progresses;
  - S5 then caps the result.
- **Autoregulation during a session.** A set two or more RIR harder than planned lowers the remaining sets of that exercise by 5 %, rounded down to an achievable load. It never raises them.
- **Equipment-aware increments** (`increments.ts`). The equipment profile can carry `loads`: bar and plate pairs, dumbbells, kettlebells, and a machine stack (minimum, step, maximum). Achievable loads are:
  - barbell: the bar plus any sum of plate pairs;
  - dumbbells and kettlebells: the listed weights;
  - stack: min + n × step, up to max.
  Loads are rounded **down**, in integer hundredths, so a rounding step never breaks a cap. When a place has no loads, the location's defaults in `INCREMENT_CONFIG` apply.
- **Time-boxing** (`timebox.ts`). The plan is cut to the minutes available, in this order:
  1. accessory sets;
  2. supersets of non-competing patterns;
  3. the warm-up, down to its minimum (8 → 5 min, never lower);
  4. conditioning shortened, then the finisher dropped;
  5. secondary sets;
  6. accessory exercises;
  7. primary sets;
  8. whole exercises.
  `planSeconds` recomputes the duration from the plan alone, and the property test holds it to ≤ the minutes available.
- **Reason codes.** Every `PlannedSet` carries at least one reason code, plus numeric `reasonParams` for the ICU message ("why this load"). `M02_REASON_PARAMS` lists the parameters each code needs. A test renders every code in FR and EN.

### Safety invariants (`packages/safety/src/session-safety.ts`, constants, never config)

- **S1:** the effort is capped at RPE 7 (RIR ≥ 3) while a screening flag is unresolved, through the SafetyProfile.
- **S2:** a joint rated red (pain ≥ 6/10, `jointFlagsFromPain`) means any exercise that loads it at a medium or high level is substituted or dropped in the next session. During a session, `painAdjustments` does the same for the rest of that session.
- **S3:** a red-flag symptom ends the session, shows the seek-care notice and locks intensity. `intensityLockStatus` is fail-closed in both record order and time: a flag counts as later than an attestation unless it is strictly earlier in time and in order. The lock lifts only with a `medical_review_attested` log. This is the hook M05 extends.
- **S5:** load ≤ 1.1 × the lowest reference load for that exercise within the last 7 days. References dated in the future also count, so time travel cannot loosen the cap. The server repeats this check over its own stored history.
- **S7:** covered by the M01 and M17 gates above.
- `properties.test.ts` runs 15,000 random valid inputs, with at least 10,000 of them producing a plan. The inputs include adversarial histories, clock jumps and equipment changes. The test proves that the caps, the weekly S5 limit, the time limit and equipment availability always hold, and that red joints are never loaded.

### Execution on the device (`apps/mobile`)

- `/workout` sits behind the same L2 gate as the first workout. `todayInput` collects the facts from stored records, and the engine runs on the device.
- **Starting a session:**
  - saves a `WorkoutSessionRecord` (the plan together with its full input) in `workout_sessions`;
  - logs `prescription.issued` (engine version, rules version, every reason code) and the plan's safety events to the device defensibility buffer.
- **Logging:**
  - a set takes two taps: reps, then RIR; the load defaults to the planned load and a stepper edits it;
  - set logs go to `set_logs`, and swaps, skips, pain, end, red flags and attestations go to `execution_logs`;
  - all three collections are append-only (a correction is a new record with `correctionOf`) and sync through the existing outbox.
- **Rest timer:**
  - it is an end time kept on the device only (never on the server, never in Redis), and the remaining time is always `endsAt − now`;
  - the display refreshes every second and again when the app returns to the foreground;
  - in the background it schedules a `RestNotifier` port, which does nothing until M13 wires OS notifications.
- **L4:** a stop control is in the header of every execution state. Skip is present as skip set, skip rest, or skip exercise. Every sheet (swap, pain, stop) repeats a skip control and a stop control.
- **L3:** the first-workout notice (`packages/legal`, trigger `workout.start`) is recorded as shown, and Start stays disabled until it is acknowledged.

### Server and defensibility (ADR-009)

- `workout_sessions` and `execution_logs` are health collections. `validateWorkoutSession` refuses a session:
  - from another engine or rules version;
  - without the L2 acceptances;
  - whose SafetyProfile differs from the latest screening, or whose birth date, S3 lock, equipment and loads, capacity model or program session differ from what the server stores;
  - with any load above the S5 ceiling computed from the server's own history;
  - whose plan and safety events differ from a re-run of the engine with the recorded clock and seed.
- The sync listener writes the following **inside the sync transaction** (the pattern of `3bff4b8`), so a failed log write rolls the record back:
  - `LegalService.recordPrescription` (M02 is its first production caller; the payload carries the engine version, the rules version and the reason codes);
  - the plan's `safety.event`s;
  - for a red flag, the S3 `session_ended` and `intensity_locked` events;
  - for an attestation, the new `safety.attested` event.

### Golden personas

`packages/exercise-library/src/session.test.ts` simulates two weeks for each persona P1–P6 through the real seed library. It compares the result with the reviewed files in `src/__golden__/P{n}.sessions.json` using `toMatchFileSnapshot`. A missing file fails. Any engine change that alters a golden session fails until someone deliberately updates the file.

## Alternatives considered

- **A second generator for program sessions.** Rejected. It would duplicate the S1/S2/S5/time guarantees of ADR-014 and let the two drift apart.
- **Counting down the rest timer with a JS interval.** Rejected. Intervals pause in the background, so the time shown would drift; an end time cannot drift.
- **Server-side timers, or Redis.** Excluded by the brief. They would also break offline use.
- **Rounding loads to the nearest achievable value.** Rejected. Rounding up could exceed S5 or a regression target, so loads always round down.
- **An S5 window that ignores future-dated loads.** Rejected. A device whose clock jumps backwards could then loosen the cap.
- **Keeping ENGINE_VERSION at 0.1.0 (as ADR-015 did for programs).** Rejected, because M02 changes the M07 first-session prescriptions.

## Consequences

- Nothing here is validated. The 63 coefficients in `SESSION_CONFIG`, `INCREMENT_CONFIG` and `PAIN_CONFIG` are `validated: false`, and `docs/status/M02.md` lists each one with its source.
- Clients on engine 0.1.0 can no longer sync new sessions until they update. Existing M07 assessment records are not affected.
- Because S5 is inclusive at 7 days, a load can stay capped when sessions are exactly 7 days apart and the only step up on the user's equipment is more than 10 % (for example, 2 kg dumbbell steps at low loads). This is an open question for A3.
- Two devices that train offline in the same week can have a session refused on the server by S5, because the server's history holds more than either device had. The device keeps its record in the outbox as rejected. M19 needs to decide how this is shown.
