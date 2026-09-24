# ADR-019: Tracking and analytics — pure engine analytics, the progress dashboard, body data, the M10 guardrail hand-off and export

- Status: Accepted (M04)
- Date: 2026-09-24
- Deciders: M04 engineer. Nothing here is validated. The coefficients, thresholds and models need:
  - A5 (exercise physiologist): the bodyweight trend (EWMA factor, rate window), the hard-set definition, the forecast model;
  - A3 (S&C coach): milestone paths on the ladders, forecast windows and confidence, the adherence window;
  - A4 (dietitian) with A1 (physician): the sustained-loss guardrail and its supportive notice (hand-off to M10, S4);
  - counsel: the "estimate, not a guarantee" wording (substantiation SUB-D5 / SUB-D6) and the body-data copy.
- Companion: [ADR-020](ADR-020-device-encryption-and-photo-backup.md) (health data encrypted at rest on the device, progress photos and their end-to-end-encrypted backup).

## Context

M04 turns logs into understandable progress: strength, volume, variants unlocked, body trends, adherence and milestones, privately (docs/specs/M04-tracking-progress-dashboard.md). The committee asked for a smoothed bodyweight trend, e1RM, weekly hard sets per muscle and adherence rather than raw logs (Dr. Julien), progress in the unit that matters (Dr. Sofia), "roughly when" for a first pull-up (Awa, P2), and that progression logic stays in M02 (Raj): **M04 only reads**.

Already there: M02's session history (`buildSessionHistory`), M07's Epley e1RM, M08's weekly volume ranges and muscle contributions, M06's ladders, M03's aerobic ledger, M17's analytics allowlist and scrubber, M20's defensibility log. M10 (nutrition) is not built.

## Decision

### Pure analytics in the engine (`packages/engine/src/analytics`)

- **Strength** (`strength.ts`): per-exercise history from M02's session history — e1RM (M07 Epley with the reserve; unreported reserve counts as 0, the lower estimate), best set (highest e1RM; unloaded: most reps, then longest hold, then fewest reps in reserve), volume load (Σ reps × load of done, loaded sets), ladder rung (variant level) — and weekly volume load.
- **Volume** (`volume.ts`): weekly hard sets per M08 muscle group against M08's ranges for the training age (read from `PROGRAM_CONFIG`, not copied). A hard set is done with ≤ `hardSet.maxRir` reps in reserve (the prescribed reserve when unreported); each movement pattern gives its groups M08's fractional contributions, so planned and done volume are measured the same way.
- **Body** (`body.ts`): entries in force (a correction replaces the entry it names; a correction without a value removes it; several entries of a day are averaged); a **gap-aware EWMA** (after d days the new value weighs 1 − (1 − α)^d, so a week without weigh-ins neither freezes the trend nor over-weights daily weigh-ins); the rate in % of body weight per week over `rate.windowDays`, only with `rate.minEntriesPerWeek` weigh-ins.
- **Guardrail** (`sustainedLossEvent`): a loss faster than `guardrail.lossPercentPerWeek` (1 %, the spec's rule and S4's planned-loss ceiling) in each of the last `guardrail.consecutiveWeeks` (3) weeks emits a `GuardrailEvent` (`bodyweight.sustained_loss`, the weekly rates, the threshold, a reason code); a gain, a slower loss or a week without enough data emits nothing. `guardrailDue` repeats it at most every `guardrail.repeatAfterDays`.
- **Adherence** (`adherence.ts`): planned (M08 schedule after reflows) vs done sessions; a streak that planned rest days continue; only a planned session not done ends it; today is still in progress; extra sessions never count against the plan; no streak without a plan.
- **Forecasts** (`forecast.ts`): a least-squares line through the recent progress points (`forecast.windowDays`), a **date range** from the slope ± `forecast.intervalZ` standard errors (never narrower than `forecast.minRangeDays`, never a single date), capped at `forecast.horizonDays`, with a **confidence** (points and R²). Statuses `forecast`, `achieved`, `insufficient_data`, `no_trend`, `beyond_horizon`; every result has `estimate: true` and the reason code `progress.forecast.estimate_only`. Ladder milestones (rung reached + share of the rung's top reps, holds as a share of M02's longest hold) and load milestones (best e1RM).
- All numbers are `ANALYTICS_CONFIG` (in `ENGINE_CONFIGS`), `validated: false`, with `ANALYTICS_RULES_VERSION` 0.1.0. **ENGINE_VERSION is unchanged (0.4.0)**: no prescription changes. Unit tests cover every function; property tests (fast-check) cover the trend range, the guardrail condition and the forecast window.

### Milestones on the seed (`packages/exercise-library/src/progress.ts`)

Five skill milestones on M06's ladders (first strict pull-up, push-up, dip, pistol squat, bar muscle-up), with gym and home equivalents placed on the rung they stand for (e.g. the assisted pull-up machine beside the band-assisted pull-up), shown only when the user trained on the path. The placement is the engineer's reading of the ladders (A3).

### The dashboard on the device (`apps/mobile/src/progress`, `ProgressScreen`)

- Computed on the device, offline, from the stored records with the engine functions (`buildDashboard`); nothing is fetched. Charts show a bounded number of points (`dashboard.config.ts`, `validated: false`), so two years render quickly: on the reference profile (P2-like, fictional: 311 sessions, 3,732 sets, 728 weigh-ins read from the encrypted database) the render is measured in jest at ~280 ms (< 1 s asserted).
- Without the health consent nothing of the health data is shown. Body weight is optional and can be hidden (kept on the device); the supportive notice still shows, with no number.
- Accessible charts in `packages/ui` (`BarChart`, `LineChart`): plain views, no chart library or asset; a text summary for screen readers, values written out (nothing by colour alone), a "show as table" button ≥ 48 dp.
- Units per user preference (metric internally; lb and in converted at input and display).

### Body data (`progress-store.ts`, sync collections `body_metrics`, `measurements`)

Append-only sync records (a correction is a new record naming the one it corrects), in the encrypted device database; on the server they are **health collections**: health consent required, schema-checked, erased on withdrawal (`apps/api/src/profile/sync-hooks.ts`). Progress photos are never synced (ADR-020).

### Sustained-loss hand-off to M10 (stub)

M10 is not built: `NutritionGuardrailPort` is its stub, an inbox in the encrypted device database that M10 will consume. The dashboard shows a supportive, non-judgemental notice once (FR/EN) and hands the event off; the hand-off is written to the device defensibility buffer as a safety event (S4, action `handed_off`, reason code, engine version — never a body value). Nothing reaches analytics.

### Wording and copy guards (`packages/i18n`)

FR/EN catalogues for every M04 string and reason code. A **body-shaming denylist** (EN > 40, FR > 30 terms; accents, case and apostrophes normalised; whole words; neutral measure names such as "body fat" allowed) scans every catalogue message in a test, with a mutation check; guilt phrases are scanned too. Forecasts always carry "Estimate, not a guarantee" / "Estimation, pas une garantie" (component test), recorded as disclaimers in the substantiation file.

### Export and import (`export.ts`, `import.ts`)

All training and body data (started sessions, set logs, execution logs, readiness checks, assessments, programs, reflows, body metrics, measurements) as JSON (complete, lossless) or CSV (flat columns for sets and body data; nested records as JSON in one column, so the importer rebuilds them exactly), made on the device offline and handed to the share sheet (the temporary file is deleted after). Photos only on request and only in JSON (then unencrypted in the file: the screen says so). The importer keeps ids, never overwrites (append-only), is idempotent and sends imported records through the outbox (the server validates them like any other). zod at the boundary.

### Analytics (M17 allowlist)

Only `screen_viewed` (progress, photos), `progress_export_requested` (format, with photos yes/no) and `photo_backup_toggled` (on/off): never a body value, a date or a count.

## Alternatives rejected

- **Analytics in the app** (next to the screens): the engine is the one source of numbers the coach portal and the AI coach will also read; it is pure and tested at 95 %+.
- **A plain moving average**, or an EWMA per entry: gaps and uneven weigh-in frequency distort both.
- **A single forecast date**: reads as a promise (L1). **Model-based forecasts** (growth curves): no validated model; the linear trend is honest about its uncertainty and easy to explain.
- **A chart library**: bundle size, licences, and weaker accessibility than written values plus a table.
- **Server-side dashboard**: breaks offline and sends more health data than needed.

## Consequences

- M10 must consume the guardrail inbox (`createGuardrailInbox().consume()`) and decide what follows (e.g. pausing any deficit suggestion, S4).
- The coach portal and the AI coach must read progress through these engine functions.
- The adherence window, chart limits and every analytics threshold await the seats above; the forecast model awaits A5/A3.
