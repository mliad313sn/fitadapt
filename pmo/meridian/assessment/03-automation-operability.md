# Meridian 5.36 as the tool that drives FitAdapt: automation, integration and operability

Assessor scope: the public API (`/api/v1`, OpenAPI), integration keys and scopes (INT-02), outbound events, typed external references (5.25), incremental sync from the repository (`drive.mjs`), machine-driven updates by AI agents, reporting and export, notifications, multi-programme and multi-instance use, backup and restore, running it in the cloud for a small team, security posture, performance, and the contributor's developer experience.
Prefix **OPS**. Meridian `main` 0687333 (5.36.0). While I tested, the other engineer's uncommitted 5.36.1 tree (DF-13, DF-14) was loaded, and it has since been reverted. I cite line numbers at 5.36.0.

## How I tested

- **My own instance:** `PORT=4193`, `PGLITE_DIR=…/scratchpad/meridian-assess-ops`. I seeded it, then imported the real FitAdapt book with `bootstrap.mjs`.
- **A full `drive.mjs` sync:** I ran it twice from a **scratch clone** of the FitAdapt branch at 78e23d7, so the real `weekly-review.md` was never touched. The key was kept under a scratch `XDG_STATE_HOME`.
- **A 30× inflated book:** 210 projects, 1,230 stages, 1,680 RAID rows, 2,100 documents and 1,500 references.
- **An archive restore:** into a second scratch directory.
- **Targeted suites:** `references`, `writeapi`, `integrations` and `events` all pass.
- I stopped every server I started with SIGTERM. Nothing was committed, and no Meridian file was edited.
- **Upstream:** I read issues #1–#18, and CHANGELOG 5.10 → 5.36. I also read docs 27, 34, 37 and 41, plus the two sibling reports (01 PLN, 02 GOV) so that I don't file the same finding twice. Where a gap overlaps GOV-01, GOV-05 or GOV-06, I only add the automation angle and point to them.

## The situation in one paragraph

The v1 contract is well made. It keys on the caller's own ids, supports idempotency keys and refuses unknown fields. An unchanged re-run writes nothing: I measured 0 writes on the second `drive.mjs` run. A repository's automation can report the state of a PR or CI run without knowing any Meridian id.

What stops FitAdapt from handing Meridian to an agent safely is everything around the contract:

- The sync still needs an administrator's password.
- The key it holds is portfolio-wide and coarse.
- A screen correction is silently reverted by the next sync, and nothing in the audit trail says so.
- Meridian cannot tell the repository what a person did (an approval, a closed act), except by a whole-book re-read.
- A failed CI run cited by a met criterion changes nothing anywhere.

## Ranked findings

| # | Title | Severity | Who feels it |
|---|---|---|---|
| OPS-01 | The repository sync needs the administrator's password | High (blocking for unattended agents) | delivery lead, engineer/agent, auditor |
| OPS-02 | A key is portfolio-wide, coarse, single, never expires and is never throttled | High | delivery lead, sponsor, auditor |
| OPS-03 | Whose field is it? The sync reverts screen corrections, and the audit shows no before/after | High | PO, delivery lead, auditor |
| OPS-04 | No change feed from Meridian to the repository: events miss the acts FitAdapt needs, arrive hourly, and the audit reads only backwards | High | engineer/agent, PO, council |
| OPS-05 | Reported repository state is displayed, never used | Medium | PO, council, sponsor |
| OPS-06 | Plan changes have no safe path in: `mode=merge` wipes measured progress and integration bindings | Medium | delivery lead, PO |
| OPS-07 | The "secret-free" archive carries live integration credentials; webhook changes are unaudited | Medium (security) | delivery lead, auditor |
| OPS-08 | Running it for a small team in the cloud: an in-process hourly clock, no container, no tests on PostgreSQL | Medium | delivery lead |
| OPS-09 | Contract ergonomics for bots: no `changed`, a bare 409, no server dry-run, no run context in the audit | Medium | engineer/agent |
| OPS-10 | `reporting.*` stopped at 5.3: no stages, criteria, evidence, references or human acts | Medium-Low | sponsor, auditor |
| OPS-11 | Reviewers are never told something awaits them | Low-Medium | council member |
| OPS-12 | Performance and developer experience: fine at 30× scale, except import freezing PGlite and a 10 s boot per test file | Low | delivery lead, contributor |

---

### OPS-01 · The repository sync needs the administrator's password

- **Severity:** High. It blocks running `drive.mjs` unattended, from CI or an agent session.
- **Who feels it:** the delivery lead (PE-14, admin), the engineer or agent running the sync, and the auditor.
- **Situation.** `meridian-client.mjs:4-6` says it outright: *"documents, baselines, accounts and meetings have session routes only."* Every run of `drive.mjs` signs in as an administrator (`MERIDIAN_EMAIL`/`MERIDIAN_PASSWORD`). It then does five things through that session:
  - moves the instance-wide status date (`drive.mjs:229-231`, `PATCH /api/admin/settings`);
  - files and re-pins evidence (`:318` `POST /api/documents`, `:326` `PATCH /api/documents/:id`);
  - schedules the weekly review and reads its agenda (`:418-421`);
  - reads the "v2.1 plan" baselines (`:463`);
  - creates or rotates its own integration key (`meridian-client.mjs:74-80`).

  To know whether a gate is held, it also has to **import Meridian's engine from a local checkout** (`drive.mjs:402-409`, `MERIDIAN_HOME`), because no route returns a computed gate status.
- **Evidence.**
  - `WRITE_BODIES` (`v1write.js`) contains projects, milestones, raid, criteria, decisions, actions, activities, workitems, iterations, benefits, business-case, raid-reviews, references and assignments. It has **no documents, baselines, occurrences or settings**. A key on `GET /api/bootstrap` gets 401 (docs/37 §5).
  - I saw the version coupling happen during the test. The Meridian checkout moved from 5.36.1 back to 5.36.0 underneath a running 5.36.1 server, and `drive.mjs` printed *"/home/user/meridian is not Meridian 5.36.1; its engine may compute differently from the server's"*. The gate table in the weekly pack is then computed by a different engine version from the one the screens run.
  - What that password opens: whole-book import and replace, reset to seed, users and grants, and the approvals that are not break-glass (GOV-10). The agent that parses `docs/status/*.md` and the account that could erase the book are the same credential.
- **Proposal.** The smallest additions to v1, each under an existing or new scope, with rules taken from the screens:
  1. **`PUT /api/v1/documents/:externalId`** (`write:portfolio`). It files or re-pins a document with name, type, gate, owner, rev, uri and `expectedSeat`. `status` is limited to `Draft` or `In review`. `Approved` is refused with *"approval is a person's act (document.approve)"*. Re-pinning an approved document follows the existing rule ("Evidence link changed after approval", back to review). Add `external_source`/`external_id` to `document`, as 055 did for the registers. Today `drive.mjs:314` finds its documents **by name**.
  2. **`GET /api/v1/gates?programme=FAD`** (`read:portfolio`). It returns `Engine.scopedGateStatus` and `Engine.canAdvance` per rung and project, from the same serialiser as the screen: state, approved/total, holds, outstanding with the `expectedSeat`. This removes the `MERIDIAN_HOME` coupling.
  3. **Baselines in the read contract.** Add `baselines` to `GET /api/v1/portfolio`, or `GET /api/v1/projects/:id/baselines`.
  4. **`PUT /api/v1/occurrences/:externalId`** (`write:meetings`) to schedule an occurrence of a series on a date, and `GET /api/v1/occurrences/:id/agenda` (`read:meetings`).
  5. **Status date.** Either an `asAt` query parameter on the reads, so a sync doesn't move everybody's status date, or a dedicated `write:status-date` scope. Moving everyone's status date is a portfolio-wide side effect today, done by a script.
- **Test.** `integrations.test.js` gains three checks:
  - a key with `write:portfolio` files a document and gets 201, re-sends it and gets 200 with no audit row, and asking for `status: "Approved"` gets 403;
  - `GET /api/v1/gates` equals `Engine.scopedGateStatus` over `/api/bootstrap` for every rung of the demo ladder;
  - `drive.mjs` runs to completion with only `MERIDIAN_KEY` set, which is a FitAdapt-side acceptance.
- **Not proposing:** document approval, user management or book import through a key. Those stay behind a person's session.

### OPS-02 · A key is portfolio-wide, coarse, single, never expires and is never throttled

- **Severity:** High. **Who feels it:** delivery lead, sponsor, auditor.
- **Situation.** FitAdapt needs two different machine writers. One is the weekly `drive.mjs` sync. The other is the GitHub Action that should report "PR #12 merged" and "CI run failed" (5.25's design). Both get the same scope, `write:portfolio`. So do a sprint tracker and an ERP feed, if the instance ever hosts another programme.
- **Evidence (my instance):**
  - **Scope, not perimeter.** `integrationPrincipal` holds *"ce qui le borne est sa portée, pas son périmètre"* (`integrations.js:76`), and `projectScopeSql` returns `true` for `service` (`shared/rbac.js:1160`). A key cannot be restricted to programme FAD.
  - **Coarse.** With the FitAdapt sync key, I closed the Gate-0 human act DEP-09 with `closureEvidence: "docs/legal/company.md@deadbee"` (a commit that doesn't exist). Engine holds on Gate 0 went from 7 to 6. With `{"blocksGate": false}` on DEP-10, the lock simply disappeared. The same scope finds a criterion met under someone else's name (`v1write.js:890-898`). The screen path requires `document.approve` for that (`routes/portfolio.js:4264`), and the contract has no such check. GOV-01 and GOV-05 own the attestation fix. My point is that **the key a CI job needs to report a PR state is the same key that can release a gate.**
  - **Single and instantly rotated.** There is one `key_hash` per integration. `rotateIntegrationKey` says *"l'ancienne cesse à l'instant"* (`integrations.js:144`). `meridian-client.mjs:74-80` rotates automatically whenever it finds no key file locally, so a developer running `drive.mjs` on a new laptop revokes the key CI holds. Keys have no expiry.
  - **Unthrottled.** 200 concurrent `PUT /api/v1/raid` calls created 200 RAID rows in 4.0 s, and 300 bad-key probes took 4.3 s, with no 429 anywhere. The only limiter is sign-in (`routes/auth.js:15`). A looping agent can flood the register, and v1 has no delete, so the clean-up is 200 screen deletions.
- **Proposal:**
  1. **`integration.programmes`**, an optional allowlist. When it is set, `resolveProject` and every create refuse a project outside it (403, naming the programme), and `/api/v1/portfolio` and events are filtered to it. One column, one check in `v1write.resolveProject`, one filter in `loadPortfolio` for `service`.
  2. **`report:references`**, a scope that only allows the state-report path of `PUT /api/v1/references` (no `project`: `references.js:260-272`). That is exactly what a GitHub Action needs, and nothing more.
  3. **Several named keys per integration** (`integration_key`: id, hint, created_at, expires_at, revoked_at, last_used_at), with rotation that overlaps (the old key lives N days) and "revoke this key" separate from "rotate". `meridian-client.mjs` should then *create a new key* instead of rotating the only one.
  4. **A per-key token bucket** in memory, like the sign-in limiter, configurable (`MERIDIAN_V1_RATE`, default for example 20 writes/s, burst 100). It answers 429 with `Retry-After`, and a daily count is visible on the integration row.
- **Test:**
  - A key restricted to FAD gets 403 for `PUT /projects` into another programme.
  - A `report:references` key can report a state (200), but creating a reference or writing RAID gets 403.
  - Two keys on one integration both authenticate, and revoking one leaves the other working.
  - A burst of 150 writes gets 429 after 100.
- **Not proposing:** a per-field permission language. The attested-acts model is GOV-01's.

### OPS-03 · Whose field is it? The sync reverts screen corrections, and the audit shows no before/after

- **Severity:** High. **Who feels it:** PO, delivery lead, auditor.
- **Situation.** The operating model (docs/governance/04 §2) says Git owns actual start, finish and %. People still correct things on screen: a PO fixes the actual finish of M17 after a late verification. `drive.mjs` sends the repository's value on every run (`drive.mjs:249`), whatever it computed at `:248-252`.
- **Evidence (my instance, FitAdapt book):**
  - `PATCH /api/activities/ACT-201-02 {actualFinish:"2026-09-24"}` as admin returned 200, version 12.
  - The next `drive.mjs` run set it back to 2026-09-23 at version 13.
  - The trail for ACT-201-02 reads `System Administrator (admin) · Activity updated · before null · after null`, then `FitAdapt repository sync (service) · Stage updated · before null · after null`.
  - Nobody can tell from Meridian that a correction was made and then undone, or what either value was. The v1 stage audit records an image only for `pct` (`v1write.js:1062`). The screen route records one only for links (`routes/portfolio.js:547-552`).
  - On 5.36.1, the binding call of DF-13 also writes the actual start with no image in the "Progress reported" row.
- **Proposal:**
  1. **Field images on every v1 write.** A helper `images(patch, existing)` in `v1write.js` gives `before`/`after` for exactly the keys of the patch. It is used by every `audited()` call in the file, and by the screen activity PATCH. This is the automation half of GOV-06's "sparse images".
  2. **Screen overrides of bound rows are remembered.** When a session edits a field of a row that carries `external_source`, store `overrides[field] = {by, at, value}`, as jsonb on activity, milestone, raid_item and work_item. A later v1 upsert **does not overwrite an overridden field**. The response lists it, `skipped: [{field, overriddenBy, at}]`, and the integration can send `"override": "clear"` for that field once a person has agreed. The screen shows "set by hand — the repository says 2026-09-23".
  3. **The v1 response says what moved:** `changed: ["actual_finish"]` (see OPS-09).
- **Test.** Bind a stage by v1, then correct `actualFinish` on screen, then re-PUT the old value:
  - the response is 200 with `skipped: [actualFinish]`, the stored value is the screen's, and no audit row is written for that field;
  - `override: "clear"` then applies it, and the audit row shows before `2026-09-24` and after `2026-09-23`.
  - On an unbound row, behaviour is unchanged.
- **Not proposing:** two-way merge rules or a per-integration field-ownership schema. The rule is simply that the last human edit wins until someone clears it.

### OPS-04 · No change feed from Meridian to the repository

Events miss the acts FitAdapt needs, arrive hourly, and the audit reads only backwards.

- **Severity:** High. **Who feels it:** engineer/agent, PO, council.
- **Situation.** CLAUDE.md rule 4: a `validated:false` value becomes `true` only in a PR that adds `validatedBy` and `signOff`, backed by a council sign-off record. In Meridian, the council member approves that record as a document, under a 5.26 review grant. The repository then has to learn that it happened, and the PR has to cite it. The same applies to a Gate-0 human act closed by the founder, a criterion found met and a decision ratified.
- **Evidence:**
  - **The wrong events.** `GOVERNANCE_ACTIONS` (`events.js:34-40`) lists 10 actions: CR approved/rejected, Phase advanced, Gate overridden, re-baselined, exception answered, case reconfirmed, PIR, lesson adopted, tolerance set. The actions FitAdapt needs are missing: `Document set to Approved` (`routes/portfolio.js:3285`), `Item closed` on a human act, `Gate criterion met`, `Decision ratified`, `Milestone accepted`. INT-04's own definition in docs/27 promised *"jalon franchi"*, and a gate milestone ticked done emits nothing.
  - **Latency.** Events leave only on the hourly tick (`index.js:470-503`). The start-up pass runs `sweepExceptions` only (`:468`), so the first event goes out an hour after boot, and a restart resets the clock. There are 200 deliveries per tick (`events.js:100`) and 8 attempts, one per hour. There is no retry or redeliver route: `GET /integrations/:id/deliveries` is the only one.
  - **Polling is backwards and whole.** `GET /api/v1/audit` pages with `before` on the timestamp only (`audit.js`, `at < $n`), with no `after` or ascending cursor. It also needs `read:audit`, which the FitAdapt key doesn't hold. `GET /api/v1/portfolio` is the whole book: 174 KB for FitAdapt, and 4.5 MB (100 KB gzipped) at 30× scale. `drive.mjs` reads the whole book twice per run (`:218`, `:401`).
- **Proposal:**
  1. **An ascending cursor:** `GET /api/v1/audit?after=<id>&limit=` ordered by id. Open it to any key for **its own writes** (`?mine=1`) and to `read:audit` for everything.
  2. **More governance actions.** Add the five actions above to `GOVERNANCE_ACTIONS` **and** to `reporting.decisions` together. The existing test that holds both lists equal keeps doing its job. Add `programme` and `project` to the payload, and a deep link to the screen.
  3. **A per-integration filter,** `events` (list of actions), so a subscriber is not woken for lessons.
  4. **A delivery cadence decoupled from the hour:** enqueue in the same transaction as the audit row, deliver on a 1-minute tick (under the same advisory lock, see OPS-08), plus `POST /api/admin/integrations/:id/deliveries/:d/retry`.
- **Test:**
  - `events.test.js`: approving a document produces a Pending delivery with `event.action = "Document set to Approved"` and the project id, and the delivery goes out within one short tick.
  - `GET /api/v1/audit?after=N` returns ids greater than N in ascending order.
  - The equality test with `reporting.decisions` still passes.
- **Not proposing:** Meridian opening PRs, or calling GitHub. The receiver does that, and Meridian stays with no outbound call except the webhook it was given.

### OPS-05 · Reported repository state is displayed, never used

- **Severity:** Medium. **Who feels it:** PO, council, sponsor.
- **Situation.** The 5.25 design is right: the CI reports the state and Meridian never fetches it. But FitAdapt's evidence is its green CI and merged PRs. A stage at 100 %, or a gate criterion found met, citing a CI run that later **failed**, or a PR **closed without merge**, should reach the weekly review.
- **Evidence:**
  - I linked `ci_run acme/fitadapt/runs/123` to a stage with state `failed`, and a PR with state `open`. `GET /api/v1/signals` was byte-for-byte unchanged, apart from `generatedAt`.
  - `shared/*.js` never reads `extLinks`. They appear only in `import.js`, `references.js`, `portfolio.js` and the web view.
  - A reference can attach to a project, stage, RAID row or criterion (`references.js resolveTarget`). It cannot attach to a **document**, which is what FitAdapt's evidence is (the status file on the gate), or to a milestone.
  - There is no read of references except the whole portfolio.
- **Proposal:**
  1. **`Engine.contradictedEvidence(db)`,** read-only, in the probe's spirit (*"la sonde ne juge pas"*). It lists a met criterion, a done gate milestone, a 100 % stage or an approved document whose cited `ci_run` is `failed` or whose `pull_request` is `closed` (not merged) or still `open`, together with the reporter and the report time. It feeds one agenda section, "Evidence its repository contradicts", and one signal. No status changes.
  2. **`ext_link.document_id`** as a fourth attachment target (migration and `resolveTarget`), so a status file's evidence can cite the PR that delivered it.
  3. **`GET /api/v1/references?kind=&state=&project=`** under `read:portfolio`.
- **Test:**
  - Criterion met, citing a `ci_run` reported failed: the agenda has the item, and `Engine.metrics` and gate states are unchanged (D-05).
  - The item disappears once a `passed` report with a later `stateAt` arrives.
  - A reference on a document is created by v1 and returned by the new read.
- **Not proposing:** turning a failure into an automatic reopen. A person decides that.

### OPS-06 · Plan changes have no safe path in: `mode=merge` wipes measured progress and integration bindings

- **Severity:** Medium. **Who feels it:** delivery lead, PO.
- **Situation.** The plan is generated from the repository (`build-book.mjs` from GOALS.md). The operating model forbids re-importing it (docs/governance/04 §45: "nobody re-imports it"), because a replace erases meetings and approvals. The contract refuses to create stages, on purpose (`v1write.js:1000-1003`: *"Une étape n'est pas créée par un système de suivi"*). So a goal pack v2.2 (a new module, a re-sequenced phase) has to be retyped on screens. The tempting shortcut is `?mode=merge`, and it is unsafe.
- **Evidence (my instance):**
  - Before the merge, M00 (`ACT-201-01`) was at 100 %, with actual start 2026-09-23 and bound to `fitadapt:M00`.
  - I ran `POST /api/admin/import?mode=merge` with `fitadapt-book.json`. The dry run said `ok`, with no rejects and an empty `wouldErase`.
  - Afterwards the stage read 0 %, actual start null, **externalId null**. The measured progress and the binding were gone, and the dry run gave no warning. The merge is "file wins" on every column.
  - Separately, an import of the 30× book **froze the PGlite instance**: `/api/health` answered in 18.2 s during a 26 s import.
  - `bootstrap.mjs` refuses an instance that holds other programmes, because the only other path is a replace of the whole instance.
- **Proposal:**
  1. **A merge preserves what the file cannot know:** `external_source`/`external_id`, the progress triple (`pct`, `progress_source`, `progress_at`), actuals and `remaining`, unless `?overwrite=measured`.
  2. **The merge dry run returns `wouldChange: [{table, id, fields}]`,** so "no rejects" no longer reads as "harmless".
  3. **`?scope=programme&programme=FAD`,** a replace limited to one programme's rows and their dependants, so a second programme can share an instance.
- **Test.** `import.test.js`:
  - A merge of a book that restates a bound stage at 0 % leaves its pct, actuals and binding untouched.
  - The dry run lists the fields it would change.
  - A programme-scoped replace leaves another programme's projects, meetings and audit rows byte-identical.
- **Not proposing:** stage creation through v1. That refusal stands. A re-plan is a change request, and the planning report (PLN-03) covers the re-plan itself.

### OPS-07 · The "secret-free" archive carries live integration credentials; webhook changes are unaudited

- **Severity:** Medium (security). **Who feels it:** delivery lead, auditor, and anyone the archive is given to.
- **Situation.** `archive.js` promises that *"l'archive ne contient aucun secret"*, so it can go to an auditor, an escrow agent or a successor.
- **Evidence:**
  - I exported the archive from my instance: 362 KB, with `integration: 2` rows and `idempotency_key` rows. It contains `"webhook_secret":"s3cr3t-hmac-value"` **in clear**, and each integration's `key_hash`. `REDACTED` covers `app_user` only (`archive.js:55`).
  - I restored it into an empty directory with `npm run restore` and started that instance. The **original key authenticated** (`GET /api/v1` → "Ops bot"), and `PUT /api/v1/raid/from-archive` created RSK-245.
  - So whoever holds both the archive and a key (for example, a CI secret) can write to the successor's instance, and the webhook secret lets them forge Meridian's signed events.
  - Separately, `PATCH /api/admin/integrations/:id` audits only `{scopes, active}` (`routes/admin.js:304-305`). Redirecting where governance events are sent (`webhook_url`), or changing the secret, leaves `before == after` in the trail.
- **Proposal:**
  - Add `integration: {key_hash: <random unusable>, webhook_secret: ""}` to `REDACTED`, and restore every integration `active = false`.
  - Add `idempotency_key` and `event_delivery` to `NEVER_ARCHIVED`.
  - Audit the integration patch as `{webhookUrl, webhookSecret: "changed" | "unchanged"}`.
- **Test.** `archive.test.js`: after a round-trip, the old key gets 401, `webhook_secret` is empty, integrations are inactive, and the archive text contains no secret that was set earlier. `integrations.test.js`: changing the webhook URL writes an audit row with the before and after URL.

### OPS-08 · Running it for a small team in the cloud

An in-process hourly clock, no container image, and no tests on PostgreSQL.

- **Severity:** Medium. **Who feels it:** the delivery lead who has to host it.
- **Situation.** FitAdapt is a distributed team with external council members. It needs an HTTPS instance on a small managed PostgreSQL, not a Windows service on someone's PC.
- **Evidence:**
  - **Linux is documented, containers are not.** Docs/34 covers systemd and fleets, but there is no Dockerfile or container image, and the packaged path is Windows (`npm run package:installer`, docs/13).
  - **Scheduled work lives in the web process.** Exceptions, events, escalation, notifications, probe and purge all run from `setInterval(…, 60*60*1000)` (`index.js:470-503`). On a platform that restarts or scales to zero, the tick may never fire, and there is no CLI to run it from cron or a platform scheduler.
  - **The advisory lock guarding that tick** is taken with `many()` and released with `query()` (`index.js:472`, `:500`). Both go through `pg.Pool` (`db.js:86`), so the unlock can land on a different connection, and it fails silently. The lock then stays with the first connection until the pool reaps it (`idleTimeoutMillis: 30_000`). On one instance this is harmless. With two behind a load balancer it can skip a tick.
  - **The production engine is never tested.** The `postgres` CI job only migrates and seeds (`.github/workflows/verify.yml`). The harness forces `url: null` (`server/test/harness.js`), and the concurrency probe runs on single-connection PGlite, so the idempotency reservation race, the pool and the advisory lock have never been exercised on PostgreSQL.
  - **PGlite backup needs the server stopped.** `npm run backup` refuses while the server holds the book, which I confirmed.
  - **There is no email transport.** Only Teams or a generic webhook (`notify.js:398-433`). This is INT-07, "hors de notre main", so I don't propose it.
- **Proposal:**
  1. **`scripts/tick.mjs`** runs the ordered sweep once, under the lock, taken and released on **one dedicated client** (`pool.connect()`, or `pg_try_advisory_xact_lock` inside `tx`). `MERIDIAN_TICK=external` disables the internal interval. The same fix applies inside `index.js`.
  2. **A documented Dockerfile and compose file** (node:24-slim, `NODE_ENV=production`, `MERIDIAN_BIND=0.0.0.0`, `MERIDIAN_SECURE_COOKIES=1`, and a readiness probe on `/api/health`). They are built in `release.yml` and gated by `verify`.
  3. **`MERIDIAN_TEST_DATABASE_URL`** honoured by `harness.js`, with the `writeapi`, `integrations`, `references`, `events`, `backup` suites and the concurrency probe run against the existing `postgres:17` service in CI.
- **Test:**
  - Two processes on one PostgreSQL both run `tick.mjs`: exactly one sweep happens, and `pg_locks` is empty afterwards.
  - The five suites are green on PostgreSQL.
  - The container starts, answers `/api/health`, and refuses demo accounts in production.
- **Not proposing:** managed hosting or a SaaS tier (docs/29 covers the international SaaS question).

### OPS-09 · Contract ergonomics for bots

No `changed` flag, a bare 409, no server dry run, and no run context in the audit.

- **Severity:** Medium. **Who feels it:** engineer/agent.
- **Evidence:**
  - **No record of what moved.** Every v1 write answers `{id, externalId, created, version}` (`v1write.js:127`). `drive.mjs` has to reconstruct what moved from before/after snapshots of its own (`:224`, `:248-252`).
  - **A bare 409.** It says only *"The version you sent is stale — read the activity again"*. Re-reading means the whole portfolio (4.5 MB at 30× scale), because there is no single-row read and no ETag.
  - **`--dry-run` is client-side theatre.** It prints `would PUT …` without asking the server whether the body would be refused. The whole-book import has a real `?dryRun=1`, but v1 has none.
  - **The audit names the integration, never the run.** It reads "FitAdapt repository sync (service)", with no commit, agent session or run id. An AI agent re-running `drive.mjs` from a bad branch cannot be told apart from the scheduled run.
- **Proposal:**
  - Add `changed: [field…]` to every write answer.
  - Make the 409 body carry `{current: {version, …changed fields}}`.
  - Add `GET /api/v1/{collection}/:externalId` for one row.
  - Add `?dryRun=1` on every v1 PUT: validate, run inside the transaction and roll back, answering what would change.
  - Add an optional header `X-Meridian-Context` (at most 200 characters, for example `drive.mjs@78e23d7 run 2026-09-24T06:19Z`), stored in a new nullable `audit_event.context` column and shown on the trail. It annotates only and grants nothing.
- **Test:**
  - `writeapi.test.js`: an unchanged re-PUT gets `changed: []`, and a stale version gets 409 with the current version.
  - `?dryRun=1` writes no row and no audit row, and answers what the real call would.
  - An audit row written with the header carries the context, and one written without it carries null.

### OPS-10 · `reporting.*` stopped at 5.3

- **Severity:** Medium-Low. **Who feels it:** sponsor, auditor, anyone building a BI view.
- **Evidence.**
  - The views are created in `029_reporting_views.sql`, plus a `sites` tweak in 060. They cover programmes, projects, milestones, risks, cost, commitments, benefits, timesheets, lessons, decisions, exceptions and tolerances.
  - `reporting.risks` lacks `category`, `gate`, `blocks_gate` and `closure_evidence`, so it cannot show which human acts hold which gate.
  - There is no view for stages (actuals, % source), gate criteria, documents/evidence (status, gate, expected seat, locked uri), references (kind, ref, state, reporter), RAID reviews, iterations or assignments. That is everything added from 5.10 to 5.36.
  - The views exist only on PostgreSQL.
- **Proposal.**
  - Add `reporting.stages`, `reporting.gate_criteria`, `reporting.evidence`, `reporting.references` and `reporting.raid_reviews`, and add the four human-act columns to `reporting.risks`. All are additive, so the change is MINOR.
  - Make F-register (or `register-schema`) fail when a new table has no reporting decision recorded, meaning a view or an explicit "not reported" line.
- **Test.** `reporting.test.js` selects from every new view on a seeded book and checks the column lists against a frozen manifest. A column removed from a view fails the test, because that would be a MAJOR change.

### OPS-11 · Reviewers are never told something awaits them

- **Severity:** Low-Medium. **Who feels it:** council members (11 external seats and hundreds of `validated:false` items), and counsel.
- **Evidence.**
  - The notification kinds in code are action-due/overdue, gate-blocked, decision-owed, concern-raised, site-quiet, timesheet-missing, digest, tolerance-breached, benefit-review-due and evidence-unreachable (grep of `kind:` in `server/src`).
  - None is "a document awaits your review" for the holder of a 5.26 review grant, or for the account linked to a document's `expected_seat`.
  - The generic `MERIDIAN_NOTIFY_URL` post is unsigned (`notify.js:425-431`), unlike events.
- **Proposal.**
  - Add a kind `review-awaited`. It goes to accounts holding a review grant over the document's scope, and first to the one mapped to `expected_seat`. It is deduplicated per document and revision, and batched by the recipient's cadence.
  - Sign the generic notification post with HMAC, reusing `signBody`.
- **Test.** A document filed "In review" with `expectedSeat: A2` queues one `review-awaited` for the A2 account and none for the owner. A re-pin of the same revision queues nothing.
- **Not proposing:** SMTP (INT-07, held by the sponsor).

### OPS-12 · Performance and developer experience

- **Severity:** Low. **Who feels it:** delivery lead, contributor.
- **At 30× the FitAdapt book** (210 projects, 1,230 stages, 1,680 RAID rows, 2,100 documents, 1,500 references, on PGlite):

  | Measure | Result |
  |---|---|
  | `/api/bootstrap` | 0.55–0.64 s, 4.5 MB (100 KB gzip) |
  | `/api/v1/portfolio` | 0.63–0.71 s |
  | `/api/v1/signals` | 0.61 s |
  | v1 PUT | about 45–52 ms each |
  | `programmeSchedule` over the programme | 206 ms |
  | 5 programme gate states | 109 ms |
  | `canAdvance`, all 210 projects | 2.9 s, client-side |
  | FitAdapt sync run | 6.2 s first, 2.3 s idempotent |

  None of this blocks the project. The pain point is the import freeze (OPS-06).
- **Developer experience:**
  - Each test file pays about 9–10 s of fixed boot: 67 migrations plus the seed, in memory (`harness.js`). Measured totals: `references` 11.9 s for 18 tests, `writeapi` 14.6 s for 54 tests, `integrations` 12.2 s for 17 tests, `events` 10.1 s for 6 tests.
  - Across 79 files that is most of the three-minute `verify` (CONTRIBUTING:40), and it hurts on a shared CPU.
  - Isolation is excellent: one in-memory database per file, and the developer's `.env` is never read.
  - **Proposal:** migrate and seed once per `npm test` into a PGlite template (`dumpDataDir()`), and have `boot()` load it (`loadDataDir`). The isolation stays the same and the boot should drop to under a second. The measure is `npm test` wall time before and after.
- **Documentation drift:** docs/37 §5 still says "17 paths (7 GET, 10 PUT)" and lists `/api/v1/signals` as missing from the contract. The served contract at 5.36.0 has 22 paths, signals included.

---

## What works well (don't break it)

- **Idempotent upserts keyed on the caller's ids.** With 5.36.1, the second `drive.mjs` run wrote nothing (0 stages, 0 references, 0 documents, 0 RAID, 0 items). The `Idempotency-Key` reservation (status 0 → 409 "in flight", 422 on a different body) is exactly right.
- **Unknown fields refused before anything happens (REQ-19).** `adopt` for rows born on a screen. Supersede-not-edit for frozen citations (REQ-29).
- **References report "the thing's state" to every link citing it,** with out-of-order reports ignored and nothing fetched. This is the right shape for GitHub Actions.
- **Named integrations in the audit label.** 401s are uniform and give nothing away. The 403 names the missing scope. The OpenAPI document is served by the instance at its real version, and `GET /api/v1` lists endpoints and scopes held.
- **Events are signed with HMAC,** with a delivery id for deduplication, a delivery log, and "nothing before the subscription".
- **Posture:** the server binds to loopback by default, refuses to start in production on PGlite or with demo accounts, checks the Origin header against CSRF, sets a strict CSP, and loudly warns about `postgres:postgres`.
- **Graceful stop works.** The `postmaster.pid` left behind is PGlite behaviour, as NEW-09 explains, not an unclosed book. I first suspected a regression; there is none.
- **Every integration survived a whole-book replace,** which is what let `drive.mjs` keep its key across `bootstrap.mjs --yes`.

## Not proposing, and why

- **Meridian fetching GitHub** (states, commits, file hashes). NOTICE and docs/27 surface C refuse it. Every proposal above keeps the direction "reported to Meridian".
- **Stage creation, document approval or book import through a key.** Stage creation is refused by design (`v1write.js:1000`). Approval and import are a person's act, or an administrator's.
- **An SMTP transport** (INT-07, sponsor-held) and **a Jira/ADO connector** (INT-10, and issue #5 stays the place for it).
- **A hash-chained audit.** That is GOV-06. OPS-03 and OPS-09 only add images and context to rows that exist.
- **Attested acts** (a bot cannot say a human did something). That is GOV-01. OPS-02 is about the key's reach and least privilege, which is complementary.

## Quick wins (PATCH-sized)

1. `REDACTED.integration` and inactive-on-restore. `idempotency_key` and `event_delivery` in `NEVER_ARCHIVED` (OPS-07).
2. Audit the webhook URL and secret change (OPS-07).
3. Take and release the advisory lock on one client (OPS-08).
4. Field images in `upsertActivity` and in the screen activity PATCH (OPS-03, part 1).
5. `changed: []` in v1 write answers, and the current version in the 409 (OPS-09).
6. `meridian-client.mjs` (FitAdapt side): never auto-rotate a key another machine may hold. Ask instead (OPS-02).
7. docs/37 §5: the path count and signals (OPS-12).
