# 04 — Running FitAdapt on Meridian

> Status: **draft**, owned by the delivery lead (PE-14). Meridian document DOC-04 (PRJ-206, Gate 0).
> Meridian: <https://github.com/mliad313sn/Meridian> — self-hosted, Apache-2.0. Requires **5.36.0 or later**: programme gate ladders (5.17), standing human acts (5.27), evidence-review grants (5.26), typed external references (5.25), teams (5.28), the schedule engine, named baselines and the programme master schedule (5.29–5.36).
> Tooling: [`pmo/meridian/`](../../pmo/meridian/README.md) — `build-book.mjs`, `bootstrap.mjs`, `drive.mjs`.

## 1. What lives where

Meridian describes itself as a portfolio and governance record, *not* a task manager or agile board. We use it that way:

| Concern | System of record |
|---|---|
| Phases, module schedule, typed dependencies, gate dates, the "v2.1 plan" baseline | **Meridian** (projects, stages, gate milestones, named baselines) |
| Actual start/finish and % of each module | **Git** (commit scopes, `docs/status/Mxx.md`), pushed into Meridian by `drive.mjs` |
| Gate evidence and who approved it | **Meridian** documents, each pointing (`uri`) at a file in this repo **pinned to a commit** |
| Where each module's work is | **Meridian** typed references on its stage: the delivering commit, the status file and ADRs as sha256 artefacts |
| What holds each gate | **Meridian** standing human acts (RAID dependencies that block their gate) |
| Risks, issues, assumptions, dependencies; the council and counsel backlog | **Meridian** RAID |
| Decisions and actions from meetings | **Meridian** meetings (agendas generated from the book) |
| Scope/date/budget changes, re-baselining | **Meridian** change requests |
| Code, specs, ADRs, module status, sign-off records | **Git** (this repository) |
| Day-to-day work of a `/goal` run | The branch and its PR |
| Friction with Meridian itself | Work items on PRJ-207, mirrored from [`dogfood-log.md`](../../pmo/meridian/dogfood-log.md) (`05`) |

## 2. How the plan maps onto Meridian

| FitAdapt | Meridian |
|---|---|
| The product, to market readiness | Programme **FAD** |
| Gate 0 … Gate 4 (`GOALS.md`) | **FAD's own gate ladder**, rungs 1–5, each **programme-scoped**: a rung clears only when every piece of its evidence on every FAD project is approved and no human act holds it |
| Phase 0 … Phase 4 | Projects **PRJ-201 … PRJ-205**, team-governed; each dates its exit rung |
| Gate 0, counsel, Expert Advisory Council | Project **PRJ-206**, group-governed; holds the human acts and the council sign-off records |
| Running Meridian and contributing back | Project **PRJ-207**, team-governed, with a board |
| Module M00 … M20 | One stage per module, typed links (FS within a phase; the standing activities SS), cross-project links FS |
| Gate items done by people (`GOALS.md`, `docs/legal/founder-checklist.md`) | **Standing human acts** on PRJ-206, category "Human act", each blocking its rung until it closes on its evidence |
| Items left `validated:false` | One **council-backlog issue** per module on PRJ-206 (rows listed, seats named); one counsel-backlog issue |
| Council seats A1 … C1 | Meridian **seats** (all open, no holder) and one **viewer account with an evidence-review grant** per seat |
| The delivery team | Site **HQ**, kind **team** (no city, no timezone) |
| The original 36-week plan | Named baseline **"v2.1 plan"** on every project, taken before any actual was recorded |
| Legal risk register + committee risks | RAID `RSK-01…20`; open questions as `ISS`, `ASM`, `DEP` |
| Team roles | People `PE-01…14` and `PE-21…31` — roles and open seats, never real names until an appointment is signed |

Budgets are **zero on purpose** until the sponsor baselines them at Gate 0 (RAID ASM-03). Meridian then reports health `N` and no earned-value index rather than inventing one. Money in the book declares its unit (`currencyUnit`, Meridian 5.17).

The book is generated once by `build-book.mjs` and imported once by `bootstrap.mjs`. After that **nobody re-imports it**: a whole-book import is a replace that erases meetings, decisions and approvals. Changes to the plan go through Meridian change control; the repository's progress reaches Meridian through `drive.mjs` (§5).

## 3. Accounts and authority

`bootstrap.mjs` creates these accounts, **inactive**, each linked to its person row, with a random password nobody holds. The administrator activates one when the role is filled, sets a one-time password (the holder must change it at first sign-in) and renames the person row per `01`/`03`. Change or disable the seeded demo accounts before anything real is recorded (Meridian `docs/06`, C-04; the server refuses to start in production while one still opens).

| Who | Meridian level | Grant | Can | Cannot |
|---|---|---|---|---|
| Delivery lead (PE-14) | admin | — | Instance, accounts, settings, backup; runs `drive.mjs` | Approve evidence in practice (admin is exempt from separation of duties, so we don't use it for approvals) |
| Sponsor (PE-01) | group | write on programme FAD | Approve gate evidence, change requests, re-baseline; close the Gate 0 human acts on their evidence | — |
| Product Owner (PE-02) | group | write on programme FAD | Run the programme, re-baseline, raise and decide changes within threshold, approve engineering evidence they don't own | Approve evidence they own (Meridian enforces it) |
| Engineers, designer, content, QA, compliance (PE-03…13) | site | write on team HQ | Update stages, RAID and work items on phase projects, raise changes | Re-baseline, approve gate evidence on their own projects, edit governance (PRJ-206) |
| Council seats A1…A6, B1…B4 | viewer | **review** on programme FAD | Read the programme; approve, in their own name, the sign-off records that wait on their seat | Edit anything; approve **gate** evidence on a team-governed phase project (a review grant does not stand in for group level there) |
| Council seat C1 (non-voting) | viewer | **review** on project PRJ-206 | Approve the insurance record | Anything else |

Checked against Meridian's `shared/rbac.js` (5.36.0). Council sign-off records therefore live on PRJ-206, which is group-governed; engineering evidence lives on the phase projects and is approved by the sponsor or the PO. Nobody approves on anyone's behalf.

## 4. Cadence

| Meeting | When | Chair | Agenda (generated by Meridian) plus standing items |
|---|---|---|---|
| **Weekly delivery review** | Monday 09:30 UTC, 30 min | PO | Run `drive.mjs` first; the pack is `pmo/meridian/weekly-review.md`. Actions, decisions owed, escalated RAID, register items due, gates in the next 14 days, then the **dogfooding triage** (5 min) |
| **Expert Advisory Council** | Monthly, Wednesday 16:00 UTC, 90 min | PO | Sign-off queue (documents waiting on each seat), council backlog, gate review when due, conflicts register (`03` §6) |
| **Sponsor steering** | Monthly, Friday 11:00 UTC, 45 min | Sponsor | Gate decisions, human acts the sponsor owns, change requests above threshold, budget |

The first generated agenda on 5.36 (for 28 Sep 2026) puts first: the simulated panel (ASM-01), the unbaselined budget (ASM-03), the council not seated (DEP-02) and the Gate 0 human acts.

## 5. Evidence, gates and human acts, step by step

1. The module PR merges and is pushed. Its status file lists what was built and what is still `validated:false`.
2. `drive.mjs` marks the stage 100 % with its actual dates, adds the typed references, and files the status file and each ADR as evidence on the phase's exit rung: status *In review*, `uri` = the file on GitHub **at the commit that last changed it** (a branch URL can change under the reviewer). It never approves.
3. The sponsor or the PO approves engineering evidence in Meridian. Meridian refuses the owner and hash-locks the `uri`; if the file changes later, `drive.mjs` re-pins it and Meridian sends the document back to review.
4. For council items, the PO prepares a sign-off record (`03` §5) under `docs/governance/sign-offs/`, sets it as the `uri` of the council document that waits on the seat, and sets it *In review*. The seat member approves it from their own account.
5. A human act (a Gate 0 founder item, a council review, an alpha or beta with real people, a pen-test) closes only on its evidence — a repository path at a commit or an https link on `github.com` — by its owner. `drive.mjs` never closes one.
6. The gate lock (`gateLock: true`) keeps every phase from advancing until its rung is clear: all evidence approved and linked, no human act open, no open veto from a seat.

## 6. Standing it up

See [`pmo/meridian/README.md`](../../pmo/meridian/README.md): clone Meridian, `npm ci && npm run seed`, start it, then `bootstrap.mjs` once and `drive.mjs` weekly. Stop a PGlite instance gracefully (`kill -TERM`, or Meridian's `scripts/restart.sh`), never with `kill -9`.

Before anything real is recorded, close Meridian's three operational blockers: a **tested backup** (`npm run backup` and `npm run restore-drill`), a **second instance**, and a written **security policy** (Meridian `SECURITY.md`; our activity D02, RAID DEP-03). For a lasting instance, use PostgreSQL (`DATABASE_URL`), not PGlite.

## 7. Workarounds retired with 5.36, and the ones left

Retired: council approvals recorded by the PO on the member's behalf (5.26 review grants); phase gates squeezed onto Meridian's Gate 3 (5.17 programme ladder); a fake site "Distributed team" in UTC (5.28 teams); commit links typed into document names (5.25 references). Left, until Meridian 5.36.1: `drive.mjs` binds a stage in a call of its own and sends a stage only when a value moved (dogfood DF-13, DF-14).
