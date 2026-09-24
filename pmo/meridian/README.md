# FitAdapt on Meridian

FitAdapt's programme is run on [Meridian](https://github.com/mliad313sn/Meridian) **5.36.0 or later**. The repository stays the source of truth for what was built; Meridian is the record of the plan, the gates, the evidence, the RAID, the meetings and the decisions, and says what comes next. The operating model is [`docs/governance/04`](../../docs/governance/04-meridian-operating-model.md).

| File | Purpose |
|---|---|
| `build-book.mjs` | Generates `fitadapt-book.json`: the v2.1 plan (7 projects, 41 stages with typed links), the programme's gate ladder Gate 0 … Gate 4 read from `GOALS.md`, HQ as a team, a Mon–Fri calendar, 25 roles and open council seats, 11 Meridian seats, the opening RAID, 37 documents (governance, legal drafts, council sign-off records waiting on their seat, phase exit evidence), the three meeting series. No real people, every budget 0, nothing approved. Refuses to build if `GOALS.md` and the plan disagree. |
| `fitadapt-book.json` | The generated book (whole-book import format, `currencyUnit: "millions"`). Regenerate; don't hand-edit. |
| `bootstrap.mjs` | **Once, on an empty instance:** dry-run then import the book, trust `github.com` for evidence, take the named baseline **"v2.1 plan"** on every project, create one inactive account per role and per council seat (each seat with an evidence-review grant). |
| `drive.mjs` | **Every week (or after every module):** pushes the repository's state into Meridian through its API, then writes `weekly-review.md` from Meridian's own view. Idempotent; never imports. |
| `meridian-client.mjs` | The two doors both scripts use: an admin session, and the integration key of "FitAdapt repository sync". |
| `weekly-review.md` | Generated pack for the next weekly delivery review: headline, Meridian's agenda, gate status and what holds each gate, what can advance, the critical chain, in-progress and ready stages, plan vs actuals, top RAID, council backlog, dogfooding. |
| `dogfood-log.md` | Every piece of friction found using Meridian, with its upstream PR or issue. |

## Standing it up

```bash
# Meridian (a checkout of the release you run; drive.mjs reads its shared/ engine)
git clone https://github.com/mliad313sn/Meridian ../meridian && cd ../meridian
npm ci && npm run seed
PORT=4173 setsid nohup node scripts/dev.mjs > /tmp/meridian.log 2>&1 &   # book in server/.data/pgdata
cd -

export MERIDIAN_URL=http://localhost:4173
export MERIDIAN_EMAIL=admin@meridian.example MERIDIAN_PASSWORD=…   # an administrator
node pmo/meridian/build-book.mjs          # only if the plan changed
node pmo/meridian/bootstrap.mjs           # refuses a non-empty book without --yes (a replace erases meetings too)
node pmo/meridian/drive.mjs               # lay the repository on top, write weekly-review.md
```

Stop Meridian **gracefully** — never `kill -9` a PGlite server (its data directory would not reopen): `kill -TERM <pid>` and wait for it to exit, or `bash scripts/restart.sh` in the Meridian checkout to restart it. Find the pid with `ss -lptn 'sport = :4173'`.

## drive.mjs

```bash
node pmo/meridian/drive.mjs [--as-of YYYY-MM-DD] [--in-progress M11[:YYYY-MM-DD]] [--dry-run]
```

| Option / variable | Meaning |
|---|---|
| `--as-of` | Meridian's status date and the agenda's reference day (default: today, UTC). |
| `--in-progress Mxx[:date]` | Mark a module started before its first `feat(mxx)` commit exists (repeatable). Once a module has commits, the flag is not needed. |
| `--dry-run` | Read everything, write nothing, print the pack to stdout. |
| `MERIDIAN_KEY` | The integration key. Without it the key is read from `$XDG_STATE_HOME/fitadapt-meridian/<host>.key` (mode 0600, outside the repository); without that, a new integration is created and its key saved there. An existing integration's key is rotated **only** with `--rotate-key` or `MERIDIAN_ROTATE_KEY=1`, because rotation disables the old key everywhere it is used (assessment OPS-02). |
| `MERIDIAN_HOME` | A checkout of the **same** Meridian version (default `../meridian`); its `shared/*.js` computes gates and the master schedule exactly as the screens do (dogfood DF-19). |

What it reads, and what it writes:

| Repository | Meridian | Door |
|---|---|---|
| `git log` scopes `feat(mxx)` etc., `docs/status/Mxx.md` ("Result: … met") | Module stage: 100 % or started, actual start = first commit, actual finish = last commit, source = status file@commit | `PUT /api/v1/activities` |
| Delivering commit, status file, each ADR it lists | Typed references on the stage: `commit` `owner/repo@sha`, `artefact` `sha256:` of the file at its commit | `PUT /api/v1/references` |
| Status file and ADRs | Evidence documents on the phase's exit gate, `uri` = GitHub blob **pinned to the commit that last changed the file**, filed *In review*; book documents with a path get their `uri` pinned too | `POST/PATCH /api/documents` |
| `docs/legal/founder-checklist.md`, the gate lines of `GOALS.md` | Standing human acts (Dependency, "blocks its gate") that hold Gate 0 … Gate 4 | `PUT /api/v1/raid` |
| "Items left validated:false" of each status file; `docs/legal/counsel-signoff-tracker.md` | One council-backlog issue per module (rows listed, seats named); one counsel-backlog issue | `PUT /api/v1/raid` |
| `pmo/meridian/dogfood-log.md` | One work item per finding on PRJ-207 | `PUT /api/v1/workitems` |
| — | Status date; the next weekly delivery review occurrence | settings, meetings |

Rules it keeps:

- **It never approves, validates or closes anything.** Evidence is filed *In review*; approving is the sponsor's, the PO's or a council seat's act in Meridian. A human act closes only on its evidence, by its owner; if the founder checklist says an item is done, the pack says so and leaves the closing to the owner.
- **Only pushed commits are cited.** A commit that is not on a remote-tracking branch gets no reference and no `uri` (run `git fetch` first).
- **Only the repository's fields are rewritten.** Scores, owners, review dates and statuses set on screen are written once, at creation. Meetings, decisions, actions and approvals are never touched: `drive.mjs` never imports.
- **A re-pinned `uri` on an approved document sends it back to review** — Meridian does that, on purpose: the approved artefact is no longer the one linked.
- **A second run with nothing new writes nothing** (verified: zero audit rows beyond sign-in on 24 Sep 2026). Two workarounds for Meridian 5.36.0 make that true until 5.36.1 ships (DF-13, DF-14).

Sprints are not used: modules run as one `/goal` run per branch, measured by their status files, not as time-boxed sets of estimated items.

## Verified on 24 Sep 2026

Meridian 5.36.0 (`main` 0687333), PGlite in `../meridian/server/.data/pgdata`: bootstrap imports with 0 rejects; `drive.mjs` records 12 delivered stages and M10 in progress, files 33 evidence documents and 50 references, raises 15 human acts and 13 backlog issues; the second run writes nothing. See `weekly-review.md` for what Meridian says.
