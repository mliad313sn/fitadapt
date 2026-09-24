# FIX-A — engine and nutrition math after the deep review: status

- Run date: 2026-09-24
- Branch: worktree of `claude/vigilant-franklin-76iok4` at `0315a69` (signed commits, not pushed, not merged)
- Scope: `packages/engine`, engine configs, the session/nutrition input schemas in `packages/shared`, the S5/S4 primitives in `packages/safety`, and the mobile/API callers only where a finding required it.
- Inputs: `review/safety-engine.md` (SAF-1 … SAF-12), `fix-queue.md` (AI pre-review corrections), `docs/governance/ai-reviews/*.md`.
- ADR: [ADR-024](../adr/ADR-024-fail-closed-engine-inputs.md) (required safety facts, stored vs engine input schema, bounded history, golden digests).
- Engine version: **0.5.0** (was 0.4.0). Session rules 0.4.0, cardio 0.2.0, recovery 0.2.0, nutrition 0.2.0, analytics 0.2.0.
- Nothing was set `validated: true`; no `validatedBy` / `signOff` was added; nothing is marked counsel-approved. Every pre-review correction applied is **stricter** (safer, or narrower in claims) and cites its pre-review file in `source`.

## Findings (review/safety-engine.md)

| ID | Sev | Status | What changed |
|---|---|---|---|
| SAF-1 | P0 | fixed | `boundSessionInput` keeps the newest 60 sessions and folds every load of the dropped ones that is still in the S5 window into `recentLoads` (lowest load per exercise, at its latest time: the same or a stricter ceiling). `generateSession` applies it before the boundary parse; the pair planner and the workout screen record the bounded input; `todayInput` keeps the newest 60. Tests at 61, 200, 500 sessions (engine) and 61/500 (device). |
| SAF-2 | P1 | fixed | `buildAssessmentPlan` requires the S3 lock, joint flags, date of birth, local date and engine time: locked → `assessment.unavailable.s3_intensity_locked`; under 16 → `s7_age`; wrong device date → `clock_mismatch`; red joints remove the options loading them. `AssessmentScreen` passes the lock and flags. Home still shows the entry; the screen shows the locked reason (device test). |
| SAF-3 | P1 | fixed | `GenerateSessionInputSchema` requires `intensityLock`, `jointFlags`, `history`, `recentLoads`, `birthDate` (nullable), `localDate` (nullable). Stored records use `StoredSessionInputSchema` (tolerant, so old rows and their S5 references still parse); the server re-derives only through the strict schema. `FirstWorkoutScreen` builds its input with `todayInput`. |
| SAF-4 | P2 | fixed | `roundDownToIncrement` floors hundredths (`floor(x·100 + 1e-8)`); regression example 45.45 kg → 49.5 kg; properties with references just under step boundaries. |
| SAF-5 | P2 | engine side fixed | `s5Violations(plan, history, recentLoads, asOfMs)` evaluates at the earlier of `generatedAt` and the server time; `computeNutritionTarget` refuses a `today` more than a day from the injected clock (`nutrition.unavailable.clock_mismatch`); the session refuses a local date more than a day from the clock (SAF-12). **Server wiring (client-time bounds, passing `asOfMs`) is FIX-C's.** |
| SAF-6 | P2 | fixed | `buildSessionHistory` folds the S5 references of exercise entries beyond 20 into `overflowLoads`, which `loadReferencesFor` reads (device and server). |
| SAF-7 | P2 | fixed | the progression gets `s5WindowReferences` (the one reference S5 reads at the engine time, same ceiling), never the whole history. Test: 720 references. |
| SAF-8 | P3 | fixed | `loadCeilingCheck` fails on non-finite or negative loads and uses `!(load <= ceiling)`; an unreadable reference in the window caps at 0. |
| SAF-9 | P3 | fixed | `defineConfig` deep-freezes; tests over every engine config and `NUTRITION_SAFETY_CONFIG`. |
| SAF-10 | P3 | fixed | goldens record `engineVersion`/`rulesVersion`; `golden-versions.test.ts` checks a SHA-256 of all goldens per `ENGINE_VERSION` (a regenerated golden without a bump fails). |
| SAF-11 | P3 | fixed | the low-readiness deload trigger resolves the ADR-023 chain over all checks, then filters by the head's time. |
| SAF-12 | P3 | fixed | the S7 re-check runs on the earlier of the user's local date (new input) and the UTC date; unknown local date → the day before (fail closed). Zones use the local age. |

## AI pre-review corrections (fix-queue.md)

| Item | Status | What changed |
|---|---|---|
| A3/A5 #2 Epley bound | applied | `epleyMaxReps` (12) bounds reps + RIR. The value stays 12 (10 is better supported: open for A5). |
| A3/A5 #64 zone RPE bands (WHO 2020) | **refused** | `zone.moderate.rpeMin` 4 → 5 and `zone.light.rpeMax` 3 → 4 raise the prescribed effort (a light session could go to RPE 4, a moderate one would start at 5): not stricter for safety. Values unchanged; the HRR band source now notes ACSM 2011 as cited by the pre-reviews. Needs A5/A1 (and the WHO-ledger wording is a copy question for B2). |
| A3/A5 #75 forecast horizon | applied | horizon = min(180 d (was 365), 3 × observed span); the window comes from a prediction band; copy (FR/EN) says it assumes the recent pace carries on and progress usually slows. |
| A3/A5 #66 first-exposure HIIT | applied | until 3 interval sessions are completed (to the end, no red flag, no red pain): HIIT/vigorous custom ≤ 6 rounds, Tabata 1 block; `cardio.hiit.first_exposure`. |
| A3/A5 #80 `incline_push_up_low` | applied | 0.41 → 0.48 with source `ebben_interpolated` (P4 golden: "41 %" → "48 %"). |
| A3/A5 #57 HRV 7-day baseline | skipped | not clearly safer (brief: skip unless clearly safer). |
| Docs M02.md / M07.md | applied | M02 `amberPainScore` row now 4; M07 rows updated (the `load.capReps` / `minutes.*` rows were already there). |
| A4/A6 S4 absolute floor | applied | `S4_MIN_ENERGY_KCAL_PER_DAY` = 1200: no number below max(BMR, 1200); below it the supportive mode (`nutrition.supportive.low_energy`, S4 event `safety.s4.absolute_floor`). Spec note added to docs/specs/M10. Property tests (safety and engine). |
| A4/A6 adaptive expenditure | applied (engine) | days logged below `adaptive.minPlausibleDayKcal` never count; only days marked complete count when the caller passes them; band −10 % / +25 %; ≤ 5 % down per update; `nutrition.energy.adaptive_lowered`. **The device has no "day complete" marker yet** (UI/store: FIX-D or a product decision). |
| A4/A6 sedentary activity factor | applied | 1.2 → 1.4 (EFSA low PAL as cited); light 1.375 → 1.5 to stay above it. Higher targets (safer direction). |
| A4/A6 protein | applied | `maxGPerKg` source text; `nutrition.protein.kidney_notice` with every protein range. |
| A4/A6 streaks (L4) | applied | `safetyProtectedDays` (red pain, a session ended for pain/red flag, the S3 lock until attestation, low readiness): neither kept nor missed, the streak goes on, training on them earns nothing; the 28-day count stays the first figure on the card. Illness has no record of its own. |
| A1/A2 CS-8 `rpeAtZeroRir` | applied | `S1_RPE_AT_ZERO_RIR` (packages/safety); the engine uses max(config, anchor) everywhere. |
| A1/A2 `wall_sit` knee | applied | M → H. |
| A1/A2 chair-stand source | applied | `olderAdultProtocolAge` source says 55 is a product choice (paper: 60+). |
| A1/A2 mobility hold note | applied (note only) | `mobility.holdSeconds` source cites ACSM 2011 30–60 s for older adults; value unchanged (benefit more than safety). |
| A1/A2 CS-7 HR medication | applied | the screening records `medication_affecting_effort`; those users get effort and talk-test zones only (`cardio.zones.medication_effort_only`). A dedicated heart-rate-medication question would be FIX-B's. |

## New `validated: false` items

| Where | Key | Value | Source |
|---|---|---|---|
| packages/safety `nutrition-floors.ts` | `S4_MIN_ENERGY_KCAL_PER_DAY` (invariant constant) | 1,200 kcal/day | A4-A6 pre-review (M10-16, NICE NG246 as cited); A4 + A1 settle it |
| packages/safety `effort.ts` | `S1_RPE_AT_ZERO_RIR` (invariant constant) | 10 | RIR-based RPE scale (Zourdos 2016, as listed); CS-8 |
| `CARDIO_CONFIG` | `hiit.firstExposureMaxRounds` / `tabata.firstExposureMaxBlocks` / `hiit.rampCompletedSessions` | 6 / 1 / 3 | A3-A5 pre-review #66; A3, A5, A1 |
| `ANALYTICS_CONFIG` | `forecast.horizonDays` (changed) / `forecast.horizonSpanMultiple` (new) | 180 d / 3 | A3-A5 pre-review #75; A5, A3, B2 |
| `NUTRITION_CONFIG` | `activity.sedentary` / `activity.light` (changed) | 1.4 / 1.5 | A4-A6 pre-review M10-3 (EFSA, FAO/WHO/UNU as cited); A4, A5 |
| `NUTRITION_CONFIG` | `adaptive.maxDownwardFraction` / `adaptive.maxDecreasePerUpdateFraction` / `adaptive.minPlausibleDayKcal` | 0.10 / 0.05 / 1,200 kcal | A4-A6 pre-review M10-8/9; A4, A5 |
| `ASSESSMENT_CONFIG` | `epleyMaxReps` (now on reps + RIR) | 12 | A3-A5 pre-review #2; A5 |
| seed `incline_push_up_low` | `bodyweightLoad` | 0.48 | A3-A5 pre-review #80 (Ebben 2011 interpolated); A5 |

## Cross-scope changes (minimal)

- `apps/api/src/profile/session-hooks.ts`: parses `record.input` with the strict `GenerateSessionInputSchema` before re-deriving (`session.invalid` otherwise). FIX-C owns the rest of the SAF-5 server fix (client-time bounds; pass the server time to `s5Violations`).
- `apps/api/test/integration/{session,recovery,cardio}.test.ts`: inputs pass the explicit facts.
- Mobile: `workout/today.ts`, `WorkoutScreen`, `PairScreen`, `FirstWorkoutScreen`, `AssessmentScreen`, `progress/dashboard.ts`, `ProgressScreen` (callers only; no store touched).
- `packages/exercise-library`: wrappers, seed values, golden headers and the digest test.

## Remaining open items

- SAF-5 server side (FIX-C). A device can still set `hiitCompleted` in the history it sends; the server should re-derive the interval ramp from its own records like the HIIT gate (FIX-C).
- A "day complete" marker for intake logs (device UI/store) so the adaptive update counts only confirmed days.
- The zone RPE bands (#64) and the HRV method (#57) need A5/A1.
- Home still shows the assessment entry while locked (the screen shows the reason); hiding it is a UI choice.
- Session-history order by `startedAt` string compare (FIX row 12) is unchanged.
