# Meridian dogfooding log

One line per piece of friction, in the order found. Loop and rules: [`docs/governance/05-dogfooding-loop.md`](../../docs/governance/05-dogfooding-loop.md).
Upstream: <https://github.com/mliad313sn/Meridian>.

## Session 1 — 23 Sep 2026: stand up the instance and import the FitAdapt book

Setup: clean clone of Meridian `main` (5.9.0, 77c4b49), Node 22, PGlite, Linux.

| ID | Found | What happened | Kind | Upstream | Status |
|---|---|---|---|---|---|
| DF-01 | Importing the book | `POST /api/admin/import` → 400 "One of those values is not in a form the system can read", for **every** book, Meridian's own export included. `'\D'` inside a JS template literal reaches PostgreSQL as `'D'`. No test covered import. | Defect, S1 | [PR #14](https://github.com/mliad313sn/Meridian/pull/14) | Fix in review |
| DF-02 | Reading `import.js` | Import dropped document `uri`, lock hash, lock date and `supersedes`, so imported approved evidence stopped counting and cleared gates turned *Overdue*. | Defect | PR #14 | Fix in review |
| DF-03 | First sign-in | `npm run seed && npm run dev` (the README quick start) → no account could sign in. Without `PGLITE_DIR` the fallback was an **in-memory** database. Setting `PGLITE_DIR` then failed with `ENOENT` (parent directory not created). | Defect, S1 | PR #14 | Fix in review |
| DF-04 | Round-trip test | `GET /export` returns the bare book; import accepted only `{ db }`. | Defect | PR #14 | Fix in review |
| DF-05 | Restarting after the fix | `scripts/restart.sh` (README: "`bash scripts/restart.sh`") works only through `powershell.exe`. On Linux it stops nothing and starts a second server on the same PGlite directory. | Defect | PR #14 | Fix in review |
| DF-06 | Portfolio view | Unbudgeted projects showed green, SPI/CPI 1.00. Already fixed as MER-04 on an unmerged branch; ported with a test. | Defect | PR #14 | Fix in review |
| DF-07 | Bisecting DF-01 | A refused import names no row and logs nothing; finding the bad row took an in-process harness. | Defect | PR #14 | Fix in review |
| DF-08 | `npm run verify` | `qs` 6.15.3 carries two moderate advisories; the audit gate only fails at `high`. | Security | PR #14 | Fix in review |
| DF-09 | Looking for prior art | `main` is behind three unmerged branches; issues #3/#4 are closed as delivered, but the code isn't on `main`. | Process | [#15](https://github.com/mliad313sn/Meridian/issues/15) | Asked the maintainer which line wins |
| DF-10 | Modelling the council | `document.approve` requires write authority on the project, so an independent council member can't sign evidence without edit rights. | Design | [#16](https://github.com/mliad313sn/Meridian/issues/16) | Proposal open |
| DF-11 | Linking modules to PRs | `ext_link.source` accepts SDP sources only; there's nowhere to attach a GitHub PR or issue. | Design | [#17](https://github.com/mliad313sn/Meridian/issues/17) | Proposal open |
| DF-12 | Modelling the team | Site is the only unit of delegated authority; FitAdapt models one fake site "Distributed team". | Design | [#18](https://github.com/mliad313sn/Meridian/issues/18) | Question open |

### Workarounds in use until PR #14 is merged

- Run Meridian from the `fix/dogfood-import-and-first-run` branch, or set `PGLITE_DIR` and create `server/.data` by hand before seeding.
- Council approvals are recorded by the PO or sponsor on the member's behalf, with the member's signed record as the evidence `uri` (DF-10).
- Phase exit gates sit on Meridian's Gate 3 — Readiness (DF-09, gate ladder not on `main`).

### What worked well

- Generated agendas: the first weekly review surfaced exactly the right decisions without anyone writing them.
- The gate lock: "Phase advance is blocked: 1 evidence item outstanding" is the behaviour we want at Gates 1–4.
- Separation of duties held under test: the PO can't approve their own evidence, and site accounts can't re-baseline.
- Zero-budget projects render cleanly ("no budget — outside EVM") once MER-04 is in.
- `npm run verify` and `npm run sweep` made the upstream PR cheap to prove.
