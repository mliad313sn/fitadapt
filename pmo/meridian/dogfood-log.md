# Meridian dogfooding log

One line per piece of friction, in the order found. Loop and rules: [`docs/governance/05-dogfooding-loop.md`](../../docs/governance/05-dogfooding-loop.md).
Upstream: <https://github.com/mliad313sn/Meridian>.

## Session 1 — 23 Sep 2026: stand up the instance and import the FitAdapt book

Setup: clean clone of Meridian `main` (5.9.0, 77c4b49), Node 22, PGlite, Linux.

| ID | Found | What happened | Kind | Upstream | Status |
|---|---|---|---|---|---|
| DF-01 | Importing the book | `POST /api/admin/import` → 400 "One of those values is not in a form the system can read", for **every** book, Meridian's own export included. `'\D'` inside a JS template literal reaches PostgreSQL as `'D'`. No test covered import. | Defect, S1 | [PR #14](https://github.com/mliad313sn/Meridian/pull/14) | **Merged in 5.9.1** (23 Sep) |
| DF-02 | Reading `import.js` | Import dropped document `uri`, lock hash, lock date and `supersedes`, so imported approved evidence stopped counting and cleared gates turned *Overdue*. | Defect | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-03 | First sign-in | `npm run seed && npm run dev` (the README quick start) → no account could sign in. Without `PGLITE_DIR` the fallback was an **in-memory** database. Setting `PGLITE_DIR` then failed with `ENOENT` (parent directory not created). | Defect, S1 | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-04 | Round-trip test | `GET /export` returns the bare book; import accepted only `{ db }`. | Defect | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-05 | Restarting after the fix | `scripts/restart.sh` (README: "`bash scripts/restart.sh`") works only through `powershell.exe`. On Linux it stops nothing and starts a second server on the same PGlite directory. | Defect | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-06 | Portfolio view | Unbudgeted projects showed green, SPI/CPI 1.00. Already fixed as MER-04 on an unmerged branch; ported with a test. | Defect | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-07 | Bisecting DF-01 | A refused import names no row and logs nothing; finding the bad row took an in-process harness. | Defect | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-08 | `npm run verify` | `qs` 6.15.3 carries two moderate advisories; the audit gate only fails at `high`. | Security | PR #14 | **Merged in 5.9.1** (23 Sep) |
| DF-09 | Looking for prior art | `main` is behind three unmerged branches; issues #3/#4 are closed as delivered, but the code isn't on `main`. | Process | [#15](https://github.com/mliad313sn/Meridian/issues/15) | **Closed in 5.16.0–5.17.0** (the RT365 and KODO lines reached `main`, one gate model D-36.02; gate F14 now fails the build on a proven line left on a branch) |
| DF-10 | Modelling the council | `document.approve` requires write authority on the project, so an independent council member can't sign evidence without edit rights. | Design | [#16](https://github.com/mliad313sn/Meridian/issues/16) | **Closed in 5.26.0** (evidence-review grant; documents name the seat they wait on) |
| DF-11 | Linking modules to PRs | `ext_link.source` accepts SDP sources only; there's nowhere to attach a GitHub PR or issue. | Design | [#17](https://github.com/mliad313sn/Meridian/issues/17) | **Closed in 5.25.0** (typed external references: issue, PR, commit, CI run, artefact) |
| DF-12 | Modelling the team | Site is the only unit of delegated authority; FitAdapt models one fake site "Distributed team". | Design | [#18](https://github.com/mliad313sn/Meridian/issues/18) | **Closed in 5.28.0** (a site is a place or a team) |

### Workarounds still in use

- ~~Run Meridian from the fix branch~~ — no longer needed: PR #14 merged into `main` on 23 Sep 2026 (5.9.1).
- ~~Council approvals recorded by the PO or sponsor on the member's behalf~~ — retired with 5.26.0 (DF-10): each seat has an account with an evidence-review grant and approves in its own name.
- ~~Phase exit gates on Meridian's Gate 3 — Readiness~~ — retired with 5.17.0 (DF-09): programme FAD declares its own ladder, Gate 0 … Gate 4.
- ~~One fake site "Distributed team" in UTC~~ — retired with 5.28.0 (DF-12): HQ is a team with no timezone.
- ~~Module-to-commit links typed into document names~~ — retired with 5.25.0 (DF-11): typed references on each stage.
- New in session 2: `drive.mjs` binds a stage in a call of its own before reporting actuals (DF-13), and sends a stage only when a value moved (DF-14), until 5.36.1 is released.

### What worked well

- Generated agendas: the first weekly review surfaced exactly the right decisions without anyone writing them.
- The gate lock: "Phase advance is blocked: 1 evidence item outstanding" is the behaviour we want at Gates 1–4.
- Separation of duties held under test: the PO can't approve their own evidence, and site accounts can't re-baseline.
- Zero-budget projects render cleanly ("no budget — outside EVM") once MER-04 is in.
- `npm run verify` and `npm run sweep` made the upstream PR cheap to prove.

## Session 2 — 24 Sep 2026: run the programme on Meridian 5.36

Setup: Meridian `main` 5.36.0 (0687333), Node 22, PGlite in the default `server/.data/pgdata` (the session-1 book upgraded in place: migrations 059–067 applied at boot, no error). New `bootstrap.mjs` (import once, baselines, accounts) and `drive.mjs` (repo → Meridian through `/api/v1` and session routes, then Meridian → `weekly-review.md`).

| ID | Found | What happened | Kind | Upstream | Status |
|---|---|---|---|---|---|
| DF-13 | First `drive.mjs` run | `PUT /api/v1/activities/:id` that binds our id to a stage answers 201 and drops every field but `pct`: M10's actual start was lost, and the identical second run recorded it. The early return predates FX-04. | Defect, S2 | Local branch `fix/fitadapt-session-2` (5.36.1), not pushed | Fixed on local branch, regression test, `npm run verify` 1194/1194 |
| DF-14 | Checking idempotency | The same upsert rewrites the stage on every unchanged re-send: a new `row_version` and a "Stage updated" audit row per stage per run, so a daily sync floods the trail and makes screens 409. Every other v1 upsert writes only what moves (5.12.0). | Defect | Local branch `fix/fitadapt-session-2` (5.36.1), not pushed | Fixed on local branch, same test |
| DF-15 | First import of the new book | An allocation id `"AL-001"` is read as the integer 0; the refusal says "That record already exists — allocation 0", naming a value that is not in the file. | Defect, P3 | To file (issue) | Open — worked around with numeric ids |
| DF-16 | Reading new RAID ids | After a replace import whose highest issue is ISS-02, the next issue is ISS-25: the id counters keep the previous book's high-water mark. Safe (ids are never reused), but the register reads as if 22 issues were deleted. | Design question, P3 | To file (issue): should a replace reset counters to the imported book? | Open |
| DF-17 | Placing council evidence | A review grant cannot approve **gate** evidence on a site-governed project (5.26 rule: group level for site gate evidence). The council's sign-off records therefore live on PRJ-206 (group-governed); engineering evidence stays on the phase projects for the sponsor or PO. | Design (worked with) | — (by design; documented in docs/governance/04 §5) | Adopted |
| DF-18 | Filing evidence from the repository | There is no `/api/v1` door for documents. Filing evidence with a commit-pinned `uri` needs a signed-in admin or group account, so a repository sync holds a person's password as well as an integration key. | Design question | To file (issue): `PUT /api/v1/documents/:externalId`, never able to set `Approved` | Open |
| DF-19 | Writing the weekly review | Gate state per programme, the programme critical chain and "can this phase advance" are computed in the browser; no endpoint serves them. `drive.mjs` imports `shared/*.js` from a checkout of the same version (`MERIDIAN_HOME`) to get Meridian's own answer. | Design question | To file (issue): a read endpoint for the master schedule and gate state | Open |
| DF-20 | Loading the dogfood backlog | `PUT /api/v1/workitems` cannot say when an item was done; items loaded already done read as done today. | Design question, P3 | To file (issue) | Open |
| DF-21 | Running the sweep | CONTRIBUTING says twelve sweep warnings are documented and expected; `main` shows eleven (5.23.0's changelog says eleven too). F15 does not read numbers written as words. | Defect (docs), P3 | To file with the 5.36.1 PR, or separately | Open |
| DF-22 | Verifying the 5.36.1 fix | `journey.test.js` I-6 ("la sauvegarde se prouve ailleurs") failed once in `npm run verify` with `fetch failed` after 6 s, at load average 8.5 on 4 CPUs; passes 3/3 alone, with and without the change. A timing-sensitive test, not a defect of the change — to root-cause, not to call flaky. | Test robustness | to file | Logged |

### What worked well (session 2)

- The upgrade path: a 5.9.1-era PGlite book opened on 5.36.0 and migrated itself (67 migrations) with no intervention.
- The import dry run: `wouldErase` said exactly what a replace would lose before anything was written.
- Standing human acts: Gate 0 is held by name ("… is held by human act DEP-nn · Gate 0 human act — Company structure (Founder (sponsor)) until it closes on its evidence") and the refusal to advance says so for every phase.
- Programme-scoped rungs express "Gate 0 must clear before Phase 1" as one gate for the whole programme.
- Typed links showed a planning error on the first run: the v2.1 plan drew the standing dogfooding activities finish-to-start, which pushed the programme to 2028 on the master schedule; they are now start-to-start.
- The generated agenda put the right items first again: the simulated panel, the budget, the council seats and the Gate 0 human acts.

