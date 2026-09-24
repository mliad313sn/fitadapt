# Assessment 01: Planning and execution (prefix PLN)

> Assessor: planning and execution seat. Date: 24 Sep 2026.
> Meridian: `/home/user/meridian` at `main` 0687333 (v5.36.0). The working tree also holds the other engineer's uncommitted 5.36.1 patch (DF-13/DF-14 in `server/src/v1write.js`), and my instance ran with it (`/api/health` → 5.36.1).
> Instance: PORT 4191, PGlite at `scratchpad/meridian-assess-pln`. I seeded it, then imported the FitAdapt book with the engineer's own `bootstrap.mjs`, then ran their `drive.mjs --as-of 2026-09-24 --in-progress M10:2026-09-24`. Both ran from a scratch clone of the FitAdapt branch, so nothing was written into `/home/user/fitadapt/pmo/meridian`. I stopped the instance with SIGTERM. Probe scripts: `scratchpad/pln-{1,2,3,4}.mjs`.
> Upstream checked: issues #1–#18 (open: #5, #10, #15, #16, #17, #18), CHANGELOG 5.10 → 5.36.1-unreleased, docs/41 (FX-01…FX-16, D-41.00…03), and docs/23 §5 refusals.

## The situation in one paragraph

FitAdapt's v2.1 plan spreads 21 modules over **36 weeks** (build-book.mjs `PLAN_WEEKS`, weeks 1–36 from 28 Sep 2026). The AI agent delivered 12 module stages (M00 … M09) between **23 Sep 15:53 and 24 Sep 05:17 UTC, about 13.5 hours**. The v2.1 baseline had planned that same work for 28 Sep 2026 → 22 Jan 2027. Meridian 5.36 records those actuals correctly: typed links, actual start and finish, `progressSource`, and typed references to the commit and the status file. But nothing it computes from them is true. The forecast finish of a phase that is 100 % complete is in December. The forecast of an unstarted phase comes before its own planned start. Every unbudgeted project forecasts zero slip until its finish date has passed. The Monte Carlo collapses to one bin. Two cross-project FS links run out of sequence and nothing flags them. The gate dates stay where the v2.1 plan put them, even though the network now says the Gate 1 review could finish on 25 Nov. ASM-02 asks for a re-plan and re-baseline after Phase 0 "using the turn counts". Meridian has no programme re-baseline, no way to re-forecast from observed pace, and no unit to hold turn counts in (FitAdapt's status files don't record them either).

Scope note, which matters for every proposal below: docs/23 §5 **refusal n° 1** ("no new portfolio function before R2; CPM deepening named") was lifted by D-41.00 **for FX-01…FX-16 only**. Anything here that touches the scheduler must name its requesting seat and what its absence costs. I do that per finding. Every proposal is additive under D-41.01: a book that doesn't use the new field computes exactly as 5.36.0. And it proposes rather than imposes, per D-41.02.

---

## Ranked findings

| ID | Title | Severity | Kind |
|---|---|---|---|
| PLN-01 | Forecast finish is fabricated for every unbudgeted project | **Blocking** | Defect (REQ-33 class) |
| PLN-02 | No schedule performance measure without money | High | Gap |
| PLN-03 | Re-plan after a phase: no re-forecast into the plan, no programme re-baseline, and the re-baseline audit loses its "before" | High | Gap + defect |
| PLN-04 | Out-of-sequence progress is invisible | High | Gap |
| PLN-05 | Gates are dates, not nodes of the network: no gate forecast, no link to a gate | High | Gap |
| PLN-06 | Agent-speed work (hours, not weeks) can't be planned, estimated or simulated | High | Gap + defect |
| PLN-07 | "Done" is a percentage anyone with a key can write; there is no acceptance on a stage | Medium-High | Gap |
| PLN-08 | Programme roll-up: no % complete, no finish, "On track 0 %" | Medium | Gap |
| PLN-09 | Schedule risk is per project; the programme finish (Gate 4) can't be simulated | Medium | Gap |
| PLN-10 | Standing (level-of-effort) activities drive the programme's critical chain | Medium | Gap |
| PLN-11 | Capacity is modelled as human FTE; the real constraints are one agent and a few reviewers | Low-Medium | Gap |

---

### PLN-01 · Forecast finish is fabricated for every unbudgeted project

- **Severity:** Blocking. It is the date a sponsor reads, and it is wrong in both directions.
- **Who feels it:** sponsor, PO, auditor.
- **Situation.** FitAdapt budgets are zero on purpose until Gate 0 (build-book.mjs `budget: 0`; RAID ASM-03). This is exactly the case MER-04/REQ-33 made honest for indices. The weekly agenda (`shared/meetings.js:138`), the portfolio register's "Forecast finish" column (`web/src/views/index.js:1026, 6419`), the period snapshots (`server/src/routes/portfolio.js:3554`, stored `forecast_finish`), schedule tolerance (`shared/engine.js:1022`) and scenario comparison (`shared/scenario.js:305`) all read `metrics().forecastFinish`.
- **Evidence.** `shared/engine.js:342-347`: `forecastFinish = today + (remaining / spi)` when SPI exists, else `today + remaining`. Here `remaining = span − clamp(today − start)`, so the CPM, the actuals and the physical % are never read. On my instance (status date 24 Sep 2026):

  | Project | % complete | Planned finish | `forecastFinish` | What is true |
  |---|---|---|---|---|
  | PRJ-202 Phase 1 | **100 %** (all 8 stages have an actual finish of 23–24 Sep) | 2027-01-01 | **2026-12-07** | Finished 24 Sep. The CPM (`programmeSchedule` ownFinish) says 2026-09-24 |
  | PRJ-205 Phase 4 | 0 %, not started | 2027-06-04 | **2026-11-09** (before its own start, 2027-04-19) | Unknown |
  | PRJ-203 Phase 2 | 25 % | 2027-02-26 | 2026-11-16, "slip −102 d" | CPM: 2027-02-19 |

  I then moved the status date on a copy of the served book (`pln-2.mjs`). At **2027-03-01**, PRJ-206 is 0 % done against 82 % planned, and it forecasts **2027-06-04, slip 0**. At 2027-06-01 it is 0 % done against 97 % planned: still **slip 0**. Without a budget, the forecast equals `max(today, planned finish)` once the project has started. An unbudgeted project never forecasts a slip before its deadline has passed. That is the "ON TRACK 100 %" lie of REQ-33, told about dates instead of indices.
- **Proposal** (defect, PATCH; `engine.js` is behaviour-frozen, so this is argued):
  1. When `measurable` is false, `forecastFinish` and `slipDays` return `null`. That is the rule REQ-33 set for SPI/CPI ("an index we don't have is worth nothing, not 1").
  2. Add a `scheduleFinish`: the latest CPM early finish of the project's leaves from `criticalPath()`. It already honours actuals, `remaining`, the status date and calendars. Add `forecastBasis: "evm" | "schedule" | null` beside it. Screens and the agenda show `scheduleFinish` labelled "from the schedule" when there is no EVM, and "—" when neither exists.
  3. Budgeted projects are unchanged. For them D-41.01 holds on every number.
- **Test.** Engine test on a hand-built book: an unbudgeted project 100 % complete with actual finish F gives `forecastFinish` null and `scheduleFinish` F. An unstarted one never has a `scheduleFinish` before its start. At status date 2027-03-01 with 0 % done against 82 % planned, `slipDays` is not 0; it is null, or positive via PLN-02. The whole demonstration book, budgeted projects only, equals 5.36.0.
- **Not proposing:** a new forecasting method here. That is PLN-02.

### PLN-02 · No schedule performance measure without money

- **Severity:** High. **Who feels it:** PO, delivery lead, sponsor.
- **Situation.** FitAdapt has no budget until Gate 0, and its progress unit is modules, not money. The question every weekly review asks is "ahead or behind, by how much". drive.mjs has to compute that itself: it writes "ahead of the baseline by 2–17 weeks" from its own `wk()` over the named baseline (drive.mjs:495-500).
- **Evidence.** `metrics()` computes `physical` and `physicalPlanned` from stage weights (`engine.js:337-341`), but SPI is `null` whenever `bac = 0` (`engine.js:325-327`). So `health()` returns N ("Nothing measured — no budget") for all 7 FitAdapt projects, and `roll()` gives `spi: null, notMeasured: 7` (`pln-1.mjs`). Weighted physical progress is measured and then thrown away for schedule purposes.
- **Proposal.** An additive `earnedSchedule` on `metrics()`, weight-based (ES from physical % against the time-phased planned physical %): `es` (date), `spiT = ES / AT`, `svT` in days, and `ieacT` (independent schedule estimate). It is computed only when the project has a governed or named baseline to read the planned curve from (`baseStart`/`baseEnd`). A stage's planned share accrues **in working days of its calendar**, so this also closes the calendar-day half of FX-08 bis for progress. `health()` stays N on cost. It gains a schedule reading labelled "schedule only — no cost baseline". It never turns green on an absence: with no baseline, there's no reading.
  - Seats: S1 (planificateur) and S3 (agile/hybrid, FitAdapt's seat in docs/41 §1).
  - Cost of its absence: the programme's one schedule question is answered outside Meridian, by a script.
- **Test.** Hand-worked: 4 equal stages over 4 weeks, 2 done at the end of week 1 → ES = 2 weeks, SPI(t) = 2.0. On the FitAdapt shape, PRJ-202 at 24 Sep gives ES = baseline finish and SPI(t) ≫ 1. A budgeted project's `spi` and `cpi` are unchanged.
- **Not proposing:** cost EVM without a budget (MER-04 stands), or a RAG derived from SPI(t) alone by default. Keep that a setting, off by default.

### PLN-03 · Re-plan after a phase: no re-forecast into the plan, no programme re-baseline, and the re-baseline audit loses its "before"

- **Severity:** High. **Who feels it:** PO, sponsor, auditor.
- **Situation.** RAID ASM-02 (build-book.mjs:288): "Re-plan and re-baseline after Phase 0, using the turn counts and status files of M00, M17 and M20. The named baseline 'v2.1 plan' keeps the original 36 weeks." drive.mjs:499 says: "a re-baseline is a change request for the sponsor, not something this script does". Meridian doesn't offer that path either:
- **Evidence.**
  1. **Planned dates never learn from actuals.** The CPM computes early dates from actuals and the status date, but only on the fly. `start`/`end` stay as typed. After drive.mjs, M11 has an ES of 2026-10-14 (driven by M10's actual start), while M12, which has no predecessor, keeps its v2.1 date of 2027-02-08. An ASAP activity with no predecessor "starts on its own date" (`schedule.js:223-227`), so every typed date behaves as a hidden SNET. The re-forecast pulls in the dependent half of the plan and leaves the other half where it was (`pln-1.mjs`, PRJ-203 rows).
  2. **Re-baseline is per project, is not tied to a change request, and freezes the stale plan.** `PATCH /projects/:id/baseline` (`portfolio.js:482-506`) with `rebaseActivities: true` copies `start_date/end_date` into `base_start/base_end`. On PRJ-202 that re-baselined M06 to 19–30 Oct 2026, not to its actual 23 Sep (`pln-3.mjs`). Gate milestones' `base_date` isn't touched (MS-202-G2 stays 2027-01-01 / 2027-01-01). No CR or decision id is asked for or recorded. A programme re-baseline is 7 calls, and 7 audit rows that nothing groups.
  3. **Defect: the audit row loses what the baseline was.** `before: { baseline: p.baseline_finish }` (`portfolio.js:492`) reads from `projectFor()`, which doesn't select `baseline_finish` (`server/src/portfolio.js:1226-1231`). On my instance the audit row reads `before_json: {}`. The rewrite of every activity's `base_start/base_end` isn't in before/after at all. For the one act that moves the governed reference, the trail can't say what it moved from.
  4. A CR moves only `finish_date`, and only in whole weeks (`portfolio.js:1375, 1538`). A scenario `shift` moves typed dates by whole weeks and keeps every duration (`shared/scenario.js:148-168`). Neither can express "the remaining 9 modules take days, not weeks; the gates are held by human acts".
- **Proposal** (the leveling pattern of FX-09, reused):
  - **Re-forecast proposal.** `GET /api/programmes/:id/reforecast?asOf=&scale=` returns, for every unstarted, non-summary, locally-owned leaf, `start/end` set to the programme run's early dates (`programmeSchedule`). Optionally each remaining duration is multiplied by a declared factor. The factor is typed by the caller, or computed from completed stages as Σ actual ÷ Σ baseline duration, and shown with its basis ("12 stages, 13.5 h against 17 weeks"). Nothing is written (D-41.02). `POST …/reforecast/apply` writes the ticked moves as audited activity updates under their `row_version`, all or nothing. Authority is `schedule.level` or a new `schedule.reforecast` in `shared/rbac.js`.
  - **Programme re-baseline.** `POST /api/programmes/:id/rebaseline { crId | decisionId, name }`: `project.baseline` on every project of the programme, plus an **approved** CR or ratified decision that names the programme. In one audited transaction it:
    - takes a named baseline "before <name>" on every project (so the old plan survives, FX-07);
    - sets `base_*` = the current plan for activities **and** `base_date` for not-done milestones;
    - sets `baseline_finish` per project;
    - writes one audit row per project, each with real `before`/`after` and the CR id.
  - **Defect fix now:** select `baseline_finish` in the re-baseline route, and put the activity base rewrite into the row's before/after.
  - Seats: S1, S2 (PMO), S5 (a baseline change is a cost-control act).
  - Cost of its absence: ASM-02 can only be done by editing build-book.mjs and re-importing. The operating model (docs/governance/04 §2) forbids that after go-live, because the import erases meetings and approvals.
- **Test.** Engine: a reforecast on the FitAdapt shape proposes M12 at the status date, not 2027-02-08. A proposal writes nothing (audit count and row versions unchanged, as `resources.test.js` already does for leveling). Route: re-baseline without an approved CR → 409 naming the missing decision. With one → N named baselines "before …", milestones rebased, and each audit row's `before.baselineFinish` is the old date. A regression test for the `{}` before-image fails on 5.36.0.
- **Not proposing:** automatic re-forecasting on every actual (it would move committed dates silently), or rescaling durations without a stated basis.

### PLN-04 · Out-of-sequence progress is invisible

- **Severity:** High. It is the exact breach FitAdapt's governance cares about.
- **Who feels it:** PO, sponsor, council, auditor.
- **Situation.** DEP-01: "Gate 0 must clear before Phase 1 starts". The book encodes it as cross-project FS links G10 → M06 ("Gate 0: advisory-board agreements drafted") and G11 → M09 ("Gate 1 sign-off before Phase 2"). In reality M06 finished on 23 Sep and M09 on 24 Sep. G10 and G11 are 0 % done and not started. Their programme early finishes are 19 Nov and 25 Nov 2026 (`pln-4.mjs`).
- **Evidence.**
  - `crossDepBreaches()` → `[]` and `depBreaches()` → 0 for every project (`pln-1.mjs`). Both compare **planned** `start`/`end` only (`engine.js:446-495`), never actuals.
  - The forward pass takes an actual start as the start, whatever the predecessors say (`schedule.js:213-221`). That is P6's "progress override", silently.
  - `Engine.decisions()` returns 32 items, none of them about sequence.
  - The only thing that says it is drive.mjs's own prose ("Phase 1 work began before Gate 0 cleared").
- **Proposal.** An additive `outOfSequence(db, projects)` in `shared/engine.js`, covering intra- and cross-project links. For each link it checks whether the successor has an actual start (or pct > 0) while an FS predecessor has no actual finish and pct < 100. For SS, it checks the successor actually starting before its predecessor started. Each item: `{ link, pred, succ, predState, succActualStart, label }`. It is surfaced as a "Schedule — out of sequence" decision owed and in the master schedule (a red link). It never blocks and never moves a date. An authorised person acknowledges it with a reason (audited), so an intended overlap is recorded, not nagged.
  - Seats: S1, S9 (a gate-order breach is a control failure).
  - Cost of its absence: the programme broke its own gate order on day 1 and Meridian's agenda didn't mention it.
- **Test.** The FitAdapt shape yields exactly 2 items (G10 → M06, G11 → M09). When the predecessor has an actual finish, 0. A 5.28.0 book with no actuals yields 0, and every existing key is deep-equal.
- **Not proposing:** retained-logic rescheduling (moving the remaining duration after the predecessor). That is a CPM change the committee should decide separately.

### PLN-05 · Gates are dates, not nodes of the network: no gate forecast, no link to a gate

- **Severity:** High. **Who feels it:** sponsor, council, PO.
- **Situation.** FitAdapt's gates are what matter: five programme-scoped rungs held by human acts and council sign-offs (build-book.mjs `LADDER`, drive.mjs §4). The gate milestones are typed dates (`MS-206-G2` 2027-01-01). The network says the Gate 1 council review (G11) can finish on **25 Nov 2026**, and the Phase 1 stages are done. The milestone stays on 1 Jan 2027, and nothing reconciles the two (`pln-4.mjs`). "Gate 0 must clear before Phase 1" can only point at a *stage* (G10) standing in for the gate, because a cross-dep names `(project, stage)` only (`programme.js:14-22`).
- **Evidence.**
  - `programmeSchedule` and `criticalPath` take `Engine.activities` only. Milestones never enter the passes (`programme.js:51-60`).
  - The milestone schema has `date`, `baseDate`, `done`, `doneOn/doneBy` (REQ-45) and `dateBasis`/`condition` (#13, placeholder vs commitment), but no predecessor.
  - `scopedGateStatus` returns a state and the milestone date ("At risk · 2026-10-16"), not a forecast.
- **Proposal.** Milestones gain optional typed predecessors (`milestone_dep`: activity or cross-project stage, FS/FF with lag). The scheduler reads a milestone as a zero-duration node, additively (no predecessor → exactly 5.36.0).
  - Each gate milestone shows three dates: **committed** (its `date`, untouched), **forecast** (network early date), and **actual** (`doneOn`).
  - A cross-dep may target a milestone, so "gate k before phase k+1" is one link to the gate itself.
  - The gate state doesn't change: a gate still passes only on evidence and human acts. The forecast says when the *work* allows it. The holds say what else is owed.
  - A `dateBasis: placeholder` milestone (#13) shows its forecast as the proposed date to commit.
  - Seats: S2 and the sponsor seat of docs/00. Cost of its absence: the steering pack's gate dates are the v2.1 plan's, forever.
- **Test.** A milestone with FS from G11 reads forecast 2026-11-25 while committed stays 2027-01-01. With no predecessors, every 5.36.0 number is unchanged. A cross-dep to a milestone shows in the master schedule and in PLN-04's sequence check.
- **Not proposing:** a gate that clears on its date, or a date that clears a gate. Evidence stays the only way through (R-01, gate lock).

### PLN-06 · Agent-speed work (hours, not weeks) can't be planned, estimated or simulated

- **Severity:** High for AI-agent programmes. **Who feels it:** delivery lead, PO, engineer/agent.
- **Situation.** Each `/goal` has a **turn cap** (GOALS.md: "cap 60 turns", "cap 90 turns"). That is the natural effort and estimate unit, and the one ASM-02 names for re-planning. Twelve module stages took about 13.5 h, several finishing the day they started (M05 23 Sep 23:40 → 24 Sep 00:33). The human work that holds the gates runs on a Mon–Fri calendar and a monthly council sitting (docs/governance/04 §4).
- **Evidence.**
  - The scheduler counts whole days. A planned duration is at least one day (`schedule.js:196-197`, `Math.max(1, span)`), and a sampled one is rounded to whole days (`Math.round(a.duration)`).
  - Three-point estimates are stored to a tenth of a day (`server/src/schedwrite.js:138`). I sent 0.05/0.1/0.3 d; it answered **201** and stored 0.1/0.1/0.3 without a word.
  - The simulation then rounded every draw to 0 days. The result was `histogram: [["2027-02-06", 1000]]` and **P50 = P80 = P90**, earlier than the deterministic finish (2027-02-19) (`pln-3.mjs`, run MCR-1). The only uncertainty the tool can express is gone.
  - A calendar is per project (or site/group). One project can't hold agent work on 7×24 and council work on Mon–Fri with sittings.
  - There is no field for a planned/actual effort quantity other than FTE-days of assignments (calendar days, FX-08 bis).
  - FitAdapt's status files don't record turn counts either (grep over docs/status). So ASM-02's input exists nowhere.
- **Proposal** (don't make the scheduler hourly: that breaks D-05 and the tool's positioning):
  1. **Measured effort, by reference.** Activity `effortPlanned`, `effortActual` and `effortUnit` (free text such as `turns` or `agent-hours`, declared per programme), with `effortSource` and `effortAt` like `progressSource`/`progressAt`. They are writable on `PUT /api/v1/activities` (the integration can push "57 of 60 turns, source docs/status/M09.md@a9c31fd"). Meridian holds the number and its provenance, not the work. PLN-03's reforecast factor can then be computed in the programme's own unit (Σ actual effort ÷ Σ planned effort over completed stages).
  2. **A calendar per activity** (optional `calendarId` on the activity, falling back to project → site → group). `schedule()` already takes `calendars` by activity id since FX-15, so this is plumbing, not a new pass. Agent stages go on a 7-day calendar; council reviews on a calendar whose working days are its sittings.
  3. **Defect:** a three-point estimate below the scheduler's resolution must be refused with 400 ("the schedule counts whole days; an estimate under half a day becomes 0"), not silently rounded twice. Alternatively, `simulate()` keeps fractional durations and rounds only the finish index. Either way, a histogram of one bin with P50 < deterministic should never be presented as a risk result.
  - Seats: S3 (FitAdapt), S7 (risk: a simulation that loses its input isn't reproducible in any useful sense).
- **Test.** v1 PUT with 0.05/0.1/0.3 → 400 naming the resolution (or the simulation yields more than one bin). An activity on its own 7-day calendar inside a Mon–Fri project finishes on a Saturday when its successor is on the 7-day calendar too. Effort fields round-trip through export, import and F13, and don't change any metric.
- **Not proposing:** hour-level scheduling, timesheets or token accounting. Meridian references the run, it doesn't hold it.

### PLN-07 · "Done" is a percentage anyone with a key can write; there is no acceptance on a stage

- **Severity:** Medium-High. **Who feels it:** PO, council, auditor.
- **Situation.** FitAdapt's definition of done: acceptance criteria demonstrated and a PO verification **on a fresh clone** (CLAUDE.md "Definition of done"; each `docs/status/Mxx.md` has a "Fresh clone" section). drive.mjs sets `pct: 100` and `actualFinish` when a status file says "met" (drive.mjs:156, 240-243), including for M09, whose status file says "Committed locally and signed; **not pushed**". Its references are skipped until pushed, but its 100 % is not.
- **Evidence.**
  - `PUT /api/v1/activities` accepts `pct: 100` + `actualFinish` from the integration key, and the scheduler, `late` and roll-up treat that stage as complete (`schedule.js:207, 309`).
  - Milestones have `acceptanceCriteria`/`acceptedBy`/`acceptedOn` (PM-04, `portfolio.js:620-636`). Activities have none (the activity fields listed in `pln-1.mjs`, migration grep).
  - The references of 5.25 give the evidence (commit, status file sha256), which works well, but nothing says "a named person accepted this stage on this evidence".
- **Proposal.** Optional stage acceptance:
  - an activity may carry `acceptanceCriteria`; when it does, `accepted_by` (person), `accepted_on`, and `accepted_ref` (an ext-link id of 5.25) record who accepted it on what;
  - a project setting `stageAcceptance: required` makes progress roll-up and earned value count a stage as 100 % only once accepted, and shows "reported 100 %, awaiting acceptance" otherwise (the `reportedPct` field already exists for the hybrid mode);
  - `stage.accept` in `shared/rbac.js`: a person with project write authority other than the stage owner (the SoD pattern of documents), **never an integration key**;
  - audited and versioned.

  This keeps "reference the work, don't hold it": the proof stays in git, and Meridian holds the human act.
- **Test.** v1 PUT pct 100 on a stage requiring acceptance → the stage reads "awaiting acceptance" and EV counts it at its last accepted %. An integration key calling accept → 403. The owner accepting their own stage → 403. With the setting off, every number is unchanged.
- **Not proposing:** the Definition of Done as a checklist inside Meridian. The criteria text points at the spec. It doesn't copy it.

### PLN-08 · Programme roll-up: no % complete, no finish, "On track 0 %"

- **Severity:** Medium. **Who feels it:** sponsor, PO.
- **Situation.** The sponsor opens Programmes → FAD to see where the programme stands. The 5 phase projects run 100 %, 100 %, 25 %, 0 %, 0 %, plus governance and dogfooding.
- **Evidence.**
  - The programme card (`web/src/views/index.js:858-900`) shows Projects, Value (`money(roll.bac)` = 0), **"On track" = green ÷ count = 0 %** (all 7 are N), decisions owed, risk posture and value promised. There is no % complete (`roll()` sums money only, `engine.js:385-407`) and no finish date.
  - The master schedule does compute the programme finish (`programmeSchedule().finish` = 2027-06-17), but only inside the lazily loaded Gantt.
  - "On track 0 %" counts "not measured" as "not on track": the same absence-as-colour error REQ-33 removed at project level.
- **Proposal.** On the programme card:
  - % complete weighted by each project's planned working duration (or an explicit programme weight if the committee prefers), with its basis named;
  - the programme finish from `programmeSchedule` beside the governed baseline, plus earned schedule from PLN-02;
  - the next gate, with its committed and forecast dates (PLN-05);
  - "On track" computed over measured projects only, as "0 of 0 measured" rather than "0 %".

  `programmeSchedule` is in a lazy chunk (D-41.03, NEW-25 bundle cap), so the card either reads a server-computed summary (`GET /api/programmes/:id/summary`) or shows "open the master schedule".
- **Test.** The FAD fixture shows a weighted % with its basis, finish 2027-06-17 (or the PLN-10 value), and "On track: nothing measured". The bundle stays under its cap.
- **Not proposing:** a programme-level RAG derived from these.

### PLN-09 · Schedule risk is per project; the programme finish (Gate 4) can't be simulated

- **Severity:** Medium. **Who feels it:** sponsor, delivery lead.
- **Situation.** FitAdapt's real uncertainty is cross-project and human: when will the council be seated (DEP-02), when does counsel review (G13), and is Gate 4 in June 2027. The agent work is near-certain and fast.
- **Evidence.** `POST /projects/:id/risk-runs` simulates one project (`server/src/routes/risk.js:61-72`) with `simulate(acts, { calendar, statusDate })`. `programmeSchedule` is never simulated, and a run can't cross the links that carry the governance dependencies (G10/G11/G12/G13 → phases).
- **Proposal.** `POST /api/programmes/:id/risk-runs` runs `simulate` over the programme run's acts, with `calendars`/`statusDates` (`schedule()` already accepts them, FX-15). Stored read-only like `risk_run`, with the programme id and the per-project finish percentiles. Authority: `risk.run` on every project of the programme (the both-sides rule of `crossdep.write`), or a programme-read variant that stores nothing.
- **Test.** A two-project programme with a cross SS+3 link reproduces the hand example of `programme-schedule.test.js` as its deterministic finish. The same seed gives the same P80. No row is written but the run's own.

### PLN-10 · Standing (level-of-effort) activities drive the programme's critical chain

- **Severity:** Medium. **Who feels it:** PO, sponsor.
- **Situation.** G04 "IP assignment from every contributor; start the register" (weeks 2–36, SS+10 after G03) and D03–D05 are standing activities. The book already had to retype them SS because FS "pushed the programme to 2028" (build-book.mjs:383-386).
- **Evidence.** The weekly review's critical chain is G02 → G03 → **G04**, and the programme finish is **2027-06-17**, 13 days *after* Gate 4 (2027-06-04). A register that runs for as long as the programme runs sets the programme's end (drive output; `pln-4.mjs`: G04 EF 2027-06-17). FX-05 summaries compute dates from children, not from links. There is no hammock or level-of-effort type (grep: none).
- **Proposal.** Activity `kind: "loe"`: its dates are the span from its start-driving predecessor to its finish-driving successor. It carries no float, is never on the critical path, and doesn't set `projEnd`. Its weight is optional (default 0) so earned value isn't distorted. Additive: no LOE → exactly 5.36.0.
- **Test.** The FitAdapt shape with G04 as LOE: the programme finish becomes the last delivery or gate node, not G04. LOE dates follow a predecessor moved by 5 days.

### PLN-11 · Capacity is modelled as human FTE; the real constraints are one agent and a few reviewers

- **Severity:** Low-Medium. **Who feels it:** delivery lead.
- **Situation.** The book allocates 9 "to appoint" engineers at 90 % to each phase (build-book.mjs:420-433). In reality one agent session delivers and the PO verifies, so throughput is bounded by the verification queue and the council sittings.
- **Evidence.** FX-08 load is per person/role in FTE-weeks against effective availability (calendar days, FX-08 bis open). Leveling (FX-09) levels against those invented engineers. Seats are not resources. An assignment can name the seat's person row (`seatPerson`), so review load *can* be assigned, but nothing expresses "at most N concurrent agent runs" or "a sitting reviews at most K packs".
- **Proposal (small):** a resource `capacityKind` of `fte` (default) or `concurrency`, where an agent pool's capacity is a count of parallel runs, not FTE, and never enters cost. Plus FX-08 bis (working calendars in load) first. Leave the rest until PLN-06's effort unit exists.
- **Not proposing:** modelling agents as people, or cost per token.

---

## What works well (don't break it)

- **Typed links, working calendars, constraints, actuals** (5.29): they behaved exactly as documented. M11's early start follows M10's actual start. The status-date rule is honoured.
- **One programme schedule** (5.36): `programmeSchedule` over mixed calendars, with the critical chain walked back along driving links. drive.mjs reads it directly. This is the base PLN-03/05/09 build on.
- **Named baselines are immutable** (5.30, DB-enforced). "v2.1 plan" is still intact after my re-baseline, which is what makes plan-vs-actual possible at all.
- **Typed references** (5.25) and the v1 idempotent upserts with `progressSource`/`measuredAt`. With the 5.36.1 patch (DF-13/14), a second drive.mjs run writes nothing.
- **The D-41.02 pattern** (propose, then an authorised person applies audited moves) is the right shape for re-forecast and re-baseline. Reuse it rather than inventing another.
- **MER-04/REQ-33 honesty** (N, not green, for unmeasured work). PLN-01 and PLN-08 ask only that the same rule reach dates and the programme card.
- **Reproducible Monte Carlo** (seed, stored read-only, through the one scheduler) is sound design. It just needs input resolution and programme scope.

## Not proposing, and why

- **Sprints and velocity for FitAdapt.** FX-14 is fine as built. FitAdapt doesn't run sprints, and forcing `/goal` runs into one-day sprints would give a velocity with no meaning. The effort unit (PLN-06) is the right measure.
- **Holding the work** (turn logs, PR states, CI results) in Meridian. Issue #5 (inbound events with provenance) and #17 (GitHub links) already cover the reference side. Everything here holds a number or a human act, with a pointer to the proof.
- **Hour-level CPM.** Out of proportion to the positioning and to D-05, for a benefit PLN-06's effort unit and per-activity calendars deliver.
- **Auto-rescheduling on actuals** or retained logic. Both move committed dates without a decision.

## Quick wins for a first PR (defects, PATCH-sized)

1. PLN-03 (3): the re-baseline audit row has an empty `before`, and the activity base rewrite is unaudited (`server/src/routes/portfolio.js:492` against `server/src/portfolio.js:1226`).
2. PLN-06 (3): refuse, don't silently round, a three-point estimate below the scheduler's resolution (`server/src/schedwrite.js:138` then `shared/schedule.js:196`).
3. PLN-01 (1): `forecastFinish`/`slipDays` return `null` when nothing is measured, the REQ-33 rule for dates.
