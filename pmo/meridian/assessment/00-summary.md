# Meridian 5.36 — what it still lacks to drive a project, and what we propose

> Consolidation of three independent assessments run in parallel on 24 Sep 2026, each on its own Meridian 5.36.0 instance loaded with FitAdapt's real book (`bootstrap.mjs` + `drive.mjs`), each claim checked in code or on the running app:
> [01 — planning & execution](01-planning-execution.md) (PLN-01…11) · [02 — governance, quality & people](02-governance-quality-people.md) (GOV-01…10) · [03 — automation & operability](03-automation-operability.md) (OPS-01…12).
> Nothing here is filed upstream yet: publishing to Meridian's GitHub waits on the founder's permission.

## The one-paragraph verdict

Meridian 5.36 is a strong governance record — gate ladders, standing human acts, evidence-review grants, typed references, teams, baselines, a real schedule engine — and most of that arrived from FitAdapt's own session-1 feedback within a day. What it cannot yet do is **tell a human act from an agent's claim**, **say anything true about schedule when there is no money and the work runs at agent speed**, **carry hundreds of expert sign-offs as first-class items**, and **let a bot keep it in step without an administrator's password**. For a project like FitAdapt — built by AI agents, gated by people — those four are exactly where it matters.

## Six themes, 33 findings

| Theme | Findings | Why it matters for FitAdapt |
|---|---|---|
| **A. Human accountability in an agent-driven project** | GOV-01, GOV-02, GOV-03, PLN-07, OPS-02 (part), GOV-05, GOV-10 | An integration key closed the founder's Gate 0 "Insurance" act; a key marked a criterion met by an empty seat; the founder's delegation to an AI PO can only be typed in as a 10-month "absence". Every "a human must do this" control can be satisfied by the agent. |
| **B. Truthful planning without money, at agent speed** | PLN-01…06, PLN-08…11 | 12 modules were delivered in ~13.5 h against a 36-week plan. Meridian records the actuals, then forecasts Phase 1 (100 % done) to finish in December, can't re-plan from actuals, doesn't flag work done before its gate, and rounds sub-day estimates to zero. |
| **C. Expert sign-off at scale** | GOV-04, GOV-09, GOV-08, OPS-11, GOV-03 | ~418 `validated:false` items + 72 counsel texts have no proper home: they are folded into 12 RAID rows. Reviewers are not first-class people, nothing tells them something awaits them, a seat can only say yes. |
| **D. A machine interface for repository-driven delivery** | OPS-01, OPS-03, OPS-04, OPS-05, OPS-06, OPS-09 | The sync needs the admin password and a local engine checkout; it silently reverts screen corrections; Meridian can't tell the repository what a person decided; reported CI state is displayed but never used; a merge import wipes progress. |
| **E. Proof for a regulator or court** | GOV-06, OPS-07, (GOV-05, GOV-10) | No hash chain on the audit trail, no scoped extract; the "secret-free" archive carries a webhook secret and working key hashes; webhook changes are unaudited. |
| **F. Running it for a small team** | OPS-08, OPS-10, OPS-12, GOV-07 | In-process hourly clock, no container, tests never run on PostgreSQL; reporting views stopped at 5.3; the fixed 4-person change chain can't be completed by a small team. |

## Ranked proposals (one upstream issue each)

| # | Proposal | Closes | Severity | Size |
|---|---|---|---|---|
| 1 | **Actor kind + human-only actions + attestation.** Each account is `human` or `agent`; `shared/rbac.js` lists human-only actions (close a human act, approve evidence, find a criterion met, ratify a decision, accept a stage); an act in someone's name counts only when that person confirms it. Opt-in per programme (`requireAttestation`). | GOV-01, PLN-07, OPS-02 (human acts via key) | Blocking | L |
| 2 | **Delegation register.** Powers, scope, instrument, dates; human-only acts never delegable to an agent; `acting_for_person` + `delegation_id` on `audit_event`; the label translated at render time. | GOV-02 | Blocking | M |
| 3 | **Truthful forecast without money.** `forecastFinish`/`slipDays` null when nothing is measured (the REQ-33 rule); a schedule-derived finish; a weight-based earned-schedule measure; programme card % and finish. | PLN-01, PLN-02, PLN-08 | Blocking | M |
| 4 | **Re-plan from actuals.** A re-forecast that *proposes* new dates (a person applies it) and a programme re-baseline tied to an approved change request, with gates moved and the before-image audited. | PLN-03 | High | M |
| 5 | **Gates as schedule nodes, and out-of-sequence detection.** Zero-length gate nodes with committed/forecast/actual dates, linkable across projects; flag progress recorded on work whose predecessors (incl. gates) haven't finished. | PLN-04, PLN-05, PLN-09, PLN-10 | High | L |
| 6 | **Agent-speed estimating.** Sub-day durations or refusal (never silent rounding); an optional effort unit (turns/runs) so a plan can learn from real run counts; capacity that isn't only human FTE. | PLN-06, PLN-11 | High | M |
| 7 | **Sign-off register.** The requirement register carries a sign-off seat, the config path and a digest of the value, Done only by that seat, positions (approve / approve-with-conditions / withhold), an opt-in gate hold, a batch `PUT /api/v1/requirements`, and a "waiting on your seat" queue in My week. | GOV-04, GOV-03, GOV-09, OPS-11 | High | L |
| 8 | **Bot-grade API.** v1 doors for filing/re-pinning evidence (never approval), computed gate status, baselines, meeting occurrences, `asAt` reads; `changed: []` in answers, current version in a 409, a server dry-run, run/commit context on audit rows. | OPS-01, OPS-09 | High | M |
| 9 | **Scoped, multiple, expiring, throttled keys.** Programme-scoped keys, a report-only scope for references, several keys per integration with expiry and overlap, a per-key rate limit. | OPS-02 | High | M |
| 10 | **Field ownership.** Record changed fields on every API write; remember screen overrides on bound rows so a sync skips them; merge import must not wipe measured progress or bindings (and its dry run must say so). | OPS-03, OPS-06 | High | M |
| 11 | **Change feed.** Ascending audit cursor; events for approval, human act closed, criterion met, decision ratified, milestone accepted; per-integration filter; one-minute tick and retry. Then: reported CI/PR state that contradicts approved evidence becomes an agenda item. | OPS-04, OPS-05 | High | M |
| 12 | **Tamper-evident audit.** Hash chain over `audit_event`, `npm run audit:verify`, extract by project/programme/date range. | GOV-06 | High | M |
| 13 | **Configurable change chain** per programme (like the gate ladder), keeping one-signer-per-step. | GOV-07 | Medium | S |
| 14 | **Conflict-of-interest register** with per-item abstention (retention period written first, per Meridian's refusal n°6). | GOV-08 | Medium | S |
| 15 | **Small-team operations.** Scheduled work callable from outside (`npm run tick`), advisory lock on one client, a container image, the suites on PostgreSQL in CI, online backup; reporting views for stages, criteria, evidence, references, human acts. | OPS-08, OPS-10, OPS-12 | Medium | M |

## One PATCH bundle of defects (one PR, after the fix already prepared)

Already prepared and verified locally: **5.36.1 — DF-13/DF-14** (first v1 activity binding dropped actuals and links; unchanged re-sends rewrote every stage), on local branch `fix/fitadapt-session-2` (`96fbc33`). Regression test fails on 5.36.0 (35/36) and passes (36/36); `npm run verify` 1193/1194 — the one failure is `journey.test.js` I-6 (backup proof) timing out at load average 8.5 on 4 CPUs; it passes 3/3 alone with and without the change (logged as DF-22). Not pushed: waiting on the founder.

Next PATCH candidates, each small and each with a failing-first test:
1. Re-baseline audit row records an empty `before`; the stage-base rewrite is unaudited (PLN-03).
2. A three-point estimate below the scheduler's resolution is refused, not silently rounded (PLN-06).
3. `forecastFinish`/`slipDays` return null when nothing is measured (PLN-01).
4. Un-flagging an open blocking act requires evidence; RAID updates audit before/after (GOV-05).
5. Admin evidence approvals marked BREAK-GLASS; `posture.js:82` corrected (GOV-10).
6. "Gate criterion met" audit detail names the asserted reviewer (GOV-01, small part).
7. The acting-for label is translated at render time instead of hard-coded "pour" (GOV-02, small part).
8. Archive: integrations redacted and inactive on restore; `idempotency_key`, `event_delivery` never archived; webhook URL/secret changes audited (OPS-07).
9. Advisory lock taken and released on one client (OPS-08).
10. docs/37 §5 path count and signals (OPS-12); CONTRIBUTING's expected sweep warnings (DF-21).

## Housekeeping upstream

Issues [#16](https://github.com/mliad313sn/Meridian/issues/16), [#17](https://github.com/mliad313sn/Meridian/issues/17) and [#18](https://github.com/mliad313sn/Meridian/issues/18) are delivered (5.26, 5.25, 5.28) but still open — close each with the release that delivered it. [#10](https://github.com/mliad313sn/Meridian/issues/10) is partly delivered.

## On our side (FitAdapt, no upstream permission needed)

- `pmo/meridian/meridian-client.mjs` must never auto-rotate an integration key another machine may hold — ask instead (OPS-02 quick win 6). **Fixed with this summary.**
- Until proposal 1 lands, the sync key *can* close a human act. `drive.mjs` never does, by construction and by test; the weekly pack says which acts are open and who owns them.

## What works well — don't break it

Programme gate ladders and the gate lock; standing human acts holding a rung; evidence pinned to commits with hash-locked URIs that send a changed artefact back to review; review grants that approve without edit rights; typed references; named baselines; generated agendas that surfaced exactly the right decisions; separation of duties (owners can't approve their own evidence); idempotent v1 upserts once DF-13/14 are fixed; performance at 30× FitAdapt's book.
