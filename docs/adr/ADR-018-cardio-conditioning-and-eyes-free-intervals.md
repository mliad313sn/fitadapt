# ADR-018: Cardio and conditioning — one generator, HIIT and impact gates, zones, eyes-free interval timer, weekly aerobic ledger

- Status: Accepted (M03)
- Date: 2026-09-24
- Deciders: M03 engineer. Nothing here is validated. The formulas, zones, protocols and gates need:
  - A5 (exercise physiologist): Tanaka HRmax, the heart-rate-reserve bands, the RPE bands, the talk test;
  - A1 (physician): the zones and the HIIT gate for people with screening flags, older adults (P4);
  - A3 (S&C coach): interval design (work, rest, rounds, blocks, reps), the movement pools and venue swaps, the cue timing;
  - A2 (physiotherapist): the impact default for knee/ankle/hip flags and the joint loads of the new seed movements;
  - counsel: the first-HIIT intensity notice (M20 draft) and the WHO citation in the copy.

## Context

M03 adds structured conditioning — HIIT, Tabata, EMOM, AMRAP, custom work/rest and steady state — adapted to equipment, bodyweight, joints and screening, and guided mainly by audio (Marco: nobody looks at a screen mid-interval). It builds on:

- M02 (ADR-016): the one session generator and the on-device execution screen; M08 already hands it a `conditioning` block (steady or intervals, finisher or whole session) and places intervals away from the day before a heavy lower-body session (ADR-015);
- M05 (ADR-017): the warm-up, readiness, the pain model (S2) and the S3 red-flag flow;
- M06: impact levels per exercise; M01: SafetyProfile (allowHIIT, impact ceiling, limited joints) and biometrics;
- M20: the `first_hiit` point-of-risk notice (trigger `hiit.start`) already existed as a draft.

The brief is explicit: one engine, one execution screen family, one S3 flow — never parallel copies. Wearables (M12) do not exist yet.

## Decision

### One generator (engine `src/cardio`, inside `generateSession`)

- A standalone cardio session is `mode: 'cardio'` with a `cardio` request (protocol, optional preferred movement, custom structure). It runs after the same gates as every session (blocked, not screened, S7, the S1 effort cap, the M17 age gate, the S3 lock), then `cardioSession`. The plan kind is `cardio_session`: no exercises, a warm-up (the M05 builder), a `conditioning` block, and the new `cardio` field.
- A program session's conditioning (M08) becomes a cardio block too (`cardioBlock`), built after the M02 time-boxing has set its minutes. Nothing else of the program session changes. `plan.cardio` is optional in the schema, so records made before engine 0.4.0 still parse.
- `CardioPlan` (the spec's CardioSession) holds the protocol, `IntervalProtocol` (work, rest, rounds, blocks), the movements, the impact ceiling, the `HRZoneSet`, and a contiguous whole-second **timeline** that fills exactly the block's minutes (so time-boxing, `planSeconds` and the estimated minutes stay right). Every step has an intensity: HIIT/Tabata/vigorous-custom work is vigorous (the only vigorous work), EMOM/AMRAP/steady/moderate-custom work is moderate, warm-up, recoveries, rests and the easy end are light. The schema refuses a plan whose vigorous work does not match its `hiit` flag.
- Protocols: Tabata 20 s/10 s × 8 per block with a minute between blocks (spec); HIIT 30 s work / 60 s easy; EMOM a set of reps at the top of each minute; AMRAP one block of a short circuit; steady one moderate block; custom as asked, rounds cut to fit. All numbers are `CARDIO_CONFIG`, `validated: false`.
- `ENGINE_VERSION` 0.3.0 → **0.4.0** and `SESSION_RULES_VERSION` 0.2.0 → **0.3.0**: program sessions with conditioning now carry a cardio block and intervals can become steady (the training-history gate). The persona goldens were updated deliberately (engine version in the safety events; P1's finisher block, now shown in the projection).

### Gates (fail closed)

- **HIIT (S1 first):** `screeningGateCheck({ hiit: true })` — an unresolved screening flag or `allowHIIT: false` refuses it. Then "≥ 2 weeks of consistent training are logged": the first logged session is at least two weeks old and each of the last two 7-day windows has at least two logged sessions (a done set or a cardio block run; records dated after the engine clock never count). A standalone HIIT request is **refused with its reason**, never silently downgraded; a program's intervals become steady and say why. A "less ready" day (M05) also keeps HIIT for another day.
- **Impact:** knee, ankle or hip in the M01 limitations or amber/red in the M05 pain model, or BMI ≥ 35 (stored height and weight), set the conditioning impact ceiling to low until the user opts up. Opting up never goes above the SafetyProfile ceiling and is ignored while a knee, ankle or hip is red (S2). Movements also pass the M06 `blockingReasons` (equipment, avoid tags, exclusions, S2 red joints). A conditioning movement left out for a red joint logs S2 "blocked".
- **Server (ADR-009 re-derivation, plus):** HIIT needs the two weeks in the records the **server** stores; a cardio block's height and weight must equal the stored profile's; a `cardio_done` log must belong to a stored block with the same protocol and never count more moderate or vigorous seconds than it planned.

### Zones (honest physiology, C9)

- With a resting heart rate and a date of birth: HRmax = 208 − 0.7 × age (Tanaka et al. 2001 as cited) and heart-rate-reserve bands (Karvonen) for light, moderate and vigorous. Otherwise (no resting heart rate, no age, or a reserve under 40 bpm): perceived exertion (0–10) and the talk test only. Every zone always carries its RPE range (capped by the SafetyProfile, S1) and a talk test.
- Zones are named by effort only. `pnpm legal:claims` gained `en.lipolysis`, `en.fat_zone`, `fr.lipolyse`, `fr.zone_graisses` (the existing rules already caught "fat-burning" and "zone de combustion des graisses"), with EN and FR fixtures; packages/i18n has its own `fatBurnClaims` guard over every catalogue message.

### Eyes-free execution (device only; no server timer state)

- The engine computes the **cue schedule** (`cueSchedule`): an announcement and a haptic at the start of every step (strong for work, light for rest), a 3-2-1 countdown before each hard step and the end, "halfway" and "one minute left" in long steps, "done" at the end. Speech is an i18n key with numbers; the app adds the exercise name. Every key exists in FR and EN.
- The app's `IntervalRunner` plays it against the **wall clock**: one timeout aimed at the next cue from `now − start`, so a late JS timer never accumulates drift (a fake-timer test: every cue < 100 ms late over a 25-minute Tabata session with 0–80 ms late callbacks; a tick counter on the same timers drifts by seconds). After a suspension it catches up: stale countdowns are not replayed, the running step and the end are. Pause, skip a step and skip the block are always available (L4), with the M02 stop and the M05 S3 sheet unchanged. It records the time actually lived in each step, so the weekly minutes are what was done.
- Outputs are ports: `CueOutput` (expo-speech with the FR or EN system voice, expo-haptics) and `BackgroundAudio` (expo-audio `shouldPlayInBackground`, with the expo-audio config plugin: iOS `UIBackgroundModes: audio`, the Android media-playback foreground service, **no microphone permission**). No sound file is shipped (asset register AST-003).
- The **heart-rate port** (`HeartRateSource`: resting heart rate, optional live readings) is what M12 plugs into; today the only source is the resting heart rate the user types. No vendor SDK. Live readings are shown, never logged or sent.

### Weekly aerobic ledger

- `cardio_done` execution logs (append-only, health data like every execution log) carry the moderate and vigorous seconds actually done. `aerobicMinutesLedger` counts a week (moderate + 2 × vigorous) against 150–300 minutes (WHO 2020 as cited by the spec, `validated: false`), and the app shows it in cardio mode and after a cardio block. The copy is neutral: below, within or above the range, never a promise.

### L3

- Before the first high-intensity session the `first_hiit` notice (M20 draft, "requires counsel review") is shown and recorded; Start stays disabled until it is acknowledged; the acknowledgement goes to the device defensibility chain. A later HIIT session does not ask again (once per notice version).

## Alternatives considered

- **A separate cardio generator or a separate interval screen.** Rejected: it would duplicate the S1/S3/S7 gates and the stop/S3 flow, and drift from them.
- **Downgrading a refused HIIT request to steady silently.** Rejected for a standalone request: the person chose HIIT and must see why it is not offered. For a program's intervals the block becomes steady and says why (the program is not the person's choice of the day).
- **Treating EMOM and AMRAP as HIIT.** Not taken: they are prescribed at a moderate, controlled effort and count as moderate minutes. Open question for A3/A1.
- **A JS interval counting seconds.** Rejected: it drifts when the JS thread is late or suspended (the control test shows seconds of drift). The wall clock cannot drift.
- **Local notifications with sounds for background cues.** Rejected for now: they need licensed sound files and cannot speak FR/EN text; the audio session keeps the system voice available instead.
- **Counting warm-up and recovery minutes toward the WHO target.** Rejected: they are light effort.
- **A vendor heart-rate SDK now.** Out of scope (M12); the port is enough.

## Consequences

- Clients on engine 0.3.0 can no longer sync new sessions.
- A cardio session made offline on one device can be refused as HIIT on the server if the two weeks of training were logged on another device that has not synced (the server's history is the one that counts; fail closed).
- Background cues rely on the OS keeping the app's audio session alive; this is proven only by a manual device test (docs/status/M03.md). Android may still throttle a backgrounded JS thread; the runner then catches up on return without replaying stale countdowns.
- Nothing here is validated: every value in `CARDIO_CONFIG` and the cardio input bounds are `validated: false`; docs/status/M03.md lists them with their sources and seats.
