# ADR-017: Recovery, pain monitoring, triggered deloads and the S3 red-flag flow

- Status: Accepted (M05)
- Date: 2026-09-24
- Deciders: M05 engineer. Nothing here is validated. The thresholds and rules need:
  - A2 (physiotherapist): the pain model, the next-morning rule, the physiotherapist rule, the amber tips and the drill lists;
  - A1 (physician): the red-flag list, the self-attestation and the red-flag deload;
  - A3 and A5: the warm-up, readiness and deload numbers;
  - counsel: the review statement and the seek-care notice.

## Context

M05 adds these on top of M02 and M08:

- warm-ups of at most about 8 minutes, and cool-downs;
- a readiness check;
- a physio-grade pain model with a next-morning check;
- triggered deloads (M08 already has scheduled ones);
- the full S3 stop-and-seek-care flow;
- a mobility and balance session for P4.

M02 left hooks in `packages/safety`:

- `jointFlagsFromPain` (S2);
- `intensityLockStatus` (S3);
- an S3 self-attestation button.

M08 exposes `scheduledDeloads` / `deloadOn`. The brief is to build on these, and never to add a second pain model or a second lock.

## Decision

### One pain model (`packages/safety/src/session-safety.ts`)

- `painTrafficLight(reports)` replaces the "latest report decides" rule inside `jointFlagsFromPain`. It keeps the same name and signature, so M02 callers and tests are unchanged.
- Each report carries:
  - its phase: during a session, after it, or at the next morning;
  - `settled` (next morning only);
  - its session id.
- Thresholds:
  - green is 0–3;
  - amber is 4–5 (`PAIN_CONFIG.amberPainScore = 4`, config, `validated: false`; M02's placeholder was 3);
  - red is a score of 6 or more (the S2 constant), or a next-morning answer of "not settled".
- A red joint stays red for the next session. Only a report below 6 from a later session can bring it back:
  - "later" means a session with no report of that joint before the red rating;
  - the report must not be dated before the red one;
  - a next-morning check never clears a red joint;
  - an unreadable date never clears it.
- This fails closed on record order, on time and on session identity. An adversarial fast-check property found the "older session clears it" hole during this module, and it is now closed.
- `physioRecommendations`: amber or red on the same joint for more than 14 days (`PAIN_CONFIG.persistenceDays`) suggests a physiotherapist. This is guidance only.
- `painReportsFrom` and `safetyStopsFrom` (engine) read these facts from the append-only execution logs. The device and the server therefore derive the same flags, the same lock and the same deloads.

### S3 red-flag flow (extends M02; no second lock)

- The red-flag screen appears in two places, and both write the same `red_flag` execution log:
  - the stop sheet during a session;
  - the optional readiness check-in, where `planId` is null.
- The effects:
  - the session ends;
  - the M20 `seek_care` notice is shown every time, with the emergency guidance of the jurisdiction from `packages/legal`. Numbers are shown only where M20 is confident: FR 112, GB 999, US 911. Every other market gets generic guidance.
  - `intensityLockStatus` locks intensity; no training or mobility session is generated;
  - the device's hash-chained log records S3 "session ended" and "intensity locked" at once;
  - the server writes the same events in the sync transaction (ADR-009).
- **Who may attest (M02 open question 4).** S3's own wording decides it: "until the user attests medical review". So the user self-attests in two steps. They read a versioned statement that a doctor or another qualified health professional has checked them since the warning signs and agrees they can exercise again, then confirm. The log keeps `statementVersion`.
  - Whether a clinician must attest instead, and whether a waiting time applies, is left to seat A1 and counsel.
- After the attestation a triggered deload runs for 7 days.

### Warm-up and cool-down (engine `recovery/warmup.ts`)

- The warm-up fills exactly the minutes the session keeps for it. That is 5–8 minutes (M02 `SESSION_CONFIG`); time-boxing never cuts below 5.
- Its blocks:
  - 2–3 minutes of low-impact general movement;
  - ramp-up sets before the first loaded exercise: 40/60/80 % of the working load, only 60/80 % in a short warm-up. Loads round down to the equipment. A load the equipment cannot make becomes "no added weight".
  - mobility drills for the day's patterns in the time left. They come from per-pattern drill lists (M06 seed content `WARM_UP_DRILLS`, awaiting A2 and A3). A greedy cover makes one drill serve several patterns.
- Every drill is allowed for the person (equipment, SafetyProfile, S2). It is also gentle: no high joint load, and at most "low" on an amber or red joint. Exercises already in the session are not repeated as drills.
- The cool-down uses mobility-tagged drills. It appears only when at least 2 minutes are left, and lasts at most 5.
- The plan carries both: `warmUp.content` and `coolDown`. Both are optional in the schema, so records made before engine 0.3.0 still parse and keep their S5 history.

### Readiness (engine `recovery/readiness.ts`)

- The optional check asks 4 questions on a 1–5 scale. It is stored in `readiness_checks`: append-only, health data, erased on withdrawal.
- The score runs from 0 to 100. It drops by 10 points each:
  - when HRV is more than 10 % below its baseline;
  - when resting HR is more than 5 bpm above its baseline.
- A reading without its baseline, or no wearable at all, is simply not used. Readiness never blocks a session.
- A score below 50 feeds the existing M02 `readiness: 'reduced'` input: one set fewer per exercise (minimum 1), accessories left out, one more rep in reserve.

### Deloads

- **Scheduled deloads** are M08's deload weeks. M05 found that, on the persona programs, they removed between 0 % (P4) and 55 % (P6) of the sets of the accumulation week before (P1 17 %, P2 33 %, P3 8 %, P5 53 %). Time-limited sessions keep the accumulation volume close to the deload target. They now keep the sessions and slots of the accumulation week before and remove 40–50 % of its sets:
  - first per muscle group, so that no group is above half its own volume, which keeps M08's cap;
  - then over the week.
  - `PROGRAM_RULES_VERSION` is now 0.2.0.
- **Triggered deloads** (`recovery/deload.ts`, `deloadStatus`) come from four triggers:
  - two amber (or red) reports 7–14 days apart;
  - a red flag, until 7 days after the attestation;
  - two sessions running in which most exercises' best set is more than 5 % down;
  - three consecutive days with a low readiness check.
- Rules shared by all triggered deloads:
  - each one lasts 7 days;
  - once a deload ends, only data recorded after it counts, so the same data never triggers it again;
  - the device passes it as `input.deload`; the server re-derives it at the plan's generation time and refuses a session that leaves it out (`session.deload_mismatch`);
  - `applyTriggeredDeload` removes 50 % of the session's sets, rounded so at least half stay. From 5 sets up, that is a 40–50 % cut.
  - progression stops, and the session does not count toward progression;
  - in a scheduled deload week it does not stack.

### S2 on the server, and its attribution

- The server now requires the session's `jointFlags` to be at least as strict as its own derivation from the stored pain reports (`safety.s2.joint_flags_mismatch`). Before this, a device could send `{}` and the server would not notice.
- A red pain report writes `safety.event` S2 with the new action `joint_flagged`, in the sync transaction.
- The engine's S2 reason code used to compare against a guess, which missed exercises chosen for another reason, such as another role this week. It now asks the selection itself what it would pick with the red flags lifted.
- A slot that stays empty because every option loads a red joint now says so (`session.s2.slot_dropped.<joint>`) and logs S2 `blocked`.

### Mobility and balance session; amber variants

- `mode: 'mobility_balance'` routes `generateSession` to a standalone session, after the same S1, S3 and S7 gates. It alternates gentle balance holds and mobility reps, easiest and most supported first, at an easy effort, and rotates from one session to the next.
- Exercises loading an amber joint get a hint: a neutral grip for shoulder, elbow and wrist, or a comfortable, shorter range of motion for the lower body. The seed's ring rows remain the substitutes they already are.

### Versions

- `ENGINE_VERSION` goes from 0.2.0 to 0.3.0, because every plan now carries warm-up content and possibly a cool-down. `SESSION_RULES_VERSION` goes to 0.2.0.
- The persona golden files were updated deliberately (see docs/status/M05.md).

## Alternatives considered

- **A separate pain store or a new `pain_reports` collection.** Rejected: it would be a second pain model. The M02 `pain` execution log was extended instead, with phase, `settled` and session.
- **Clearing red on the next report below 6.** Rejected. That was M02's behaviour, and it lets a same-session or next-morning report escape S2 "in the next session".
- **A clinician-only attestation.** Not what S3 says. It is left to A1 and counsel as an option.
- **Triggered deloads the user can decline** (the KPI "deload acceptance"). Not taken for v1, because the pain and red-flag triggers are safety-adjacent. Every set can still be skipped (L4), and acceptance can be measured as completion in M18.
- **Enforcing deloads as a session-level percentage in the engine only.** Rejected for scheduled deloads, because M08's week-level cap must still hold. Both are enforced.

## Consequences

- Clients on engine 0.2.0 can no longer sync new sessions or programs.
- The server refuses a session that ignores a stored red pain report, a triggered deload or a low readiness check of that day.
- A readiness check on another device that has not synced yet cannot be seen. The device only ever makes a session lighter.
- For a first session without a program, the server takes the plan's UTC date as "that day". Near midnight this can differ from the device's local date (open question).
