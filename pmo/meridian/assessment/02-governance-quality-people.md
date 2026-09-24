# Assessment 02: Governance, quality and people (prefix GOV)

> Assessor: GOV seat, 24 Sep 2026. Meridian `main` 0687333 (5.36.0; the working tree reports 5.36.1 because of the other engineer's unreleased DF-13/DF-14 patch, which touches `v1write.js` activities only and nothing in this scope).
> Instance: my own, `PORT=4192`, `PGLITE_DIR=…/scratchpad/meridian-assess-gov`, seeded, then loaded with FitAdapt's book using `pmo/meridian/bootstrap.mjs --yes` (read-only on the repo). I did **not** run `drive.mjs`, because it rewrites `weekly-review.md`. The instance was stopped with SIGTERM.
> Probe scripts: `…/scratchpad/gov/t1.mjs … t14.mjs`. Every "T-n" below is one of them, run against that instance, with its output quoted.
> Upstream issues checked (all 17, open and closed). Refusals checked: docs/23 §5 (n° 1–6) and docs/41 §0 / D-41.00…03. Each proposal names its requesting seat and what the gap costs, as refusal n° 2 requires. None of them touches `audit_no_update` / `audit_no_delete` (refusal n° 3).

## The situation in one paragraph

FitAdapt is governed by people who mostly do not exist yet. The founder is the only human. He has handed his authority to an AI Product Owner. The PO drives delivery through an integration key and an administrator session (`meridian-client.mjs`, `drive.mjs`). Eleven council seats are open, and they will have to sign off about 418 `validated:false` rows plus 72 counsel texts. Meridian 5.25–5.28 answered FitAdapt's first four design questions well: review grants, standing human acts, typed references, and teams. The next problem is different. Meridian records *that a named person acted*, but it does not check that *the named person is the one acting*. Almost every "a human must do this" control can be completed by whoever holds write authority or an integration key, including an AI agent. The book then shows the act in the human's name. For a programme whose whole defence (L11) rests on "a qualified human signed this", that is the gap that matters.

## Ranked findings

| # | Finding | Severity | Who feels it |
|---|---|---|---|
| GOV-01 | Human acts are assertions: an integration key or any writer can close a human act, find a criterion met, or record a decision ratified, all in someone else's name | **Blocking** | Sponsor, council, auditor |
| GOV-02 | No delegation of authority: only an absence-bound deputy, unlimited, human-only, labelled in French, not queryable | **Blocking** | Sponsor, PO (AI), auditor |
| GOV-03 | "Waiting on seat A2" is decoration: anyone with approval power approves in place of the seat, and a seat can only say yes | High | Council, sponsor, auditor |
| GOV-04 | The ~500 sign-off items live in 12 RAID rows. The requirement register is the right home but can't carry them (no v1 route, no seat, no gate hold, anyone marks Done) | High | PO, council, delivery lead |
| GOV-05 | A gate hold can be lifted silently: un-flagging "blocks its gate" needs no evidence and is audited as "Item updated" with no before/after | High (PATCH-sized) | Sponsor, auditor |
| GOV-06 | The audit trail proves nothing to a third party: no integrity chain, no structured delegation/seat/power, sparse before-images, no scoped extract | High | Auditor, counsel, court |
| GOV-07 | The change chain is a constant: 4 steps, 4 distinct people, role labels that authorise nothing. FitAdapt can't complete any change request | Medium-High | Sponsor, PO |
| GOV-08 | No conflict-of-interest register and no per-item abstention (seat incompatibility is there, and it works) | Medium | Council, PO, auditor |
| GOV-09 | An external reviewer isn't a first-class person: "staff" at a site, seat and review grant not linked, nothing waiting for them in My week | Medium | Council member, delivery lead |
| GOV-10 | Administrator approvals of evidence aren't flagged as break-glass, and the posture text about it is stale | Medium (PATCH-sized) | Auditor, delivery lead |

Stage acceptance (the module "done" act) is **PLN-07** in assessment 01. I agree with it and don't repeat it. GOV-01's "never an integration key" rule is the same principle, applied more generally.

---

### GOV-01 · Human acts are assertions, not acts

- **Severity:** Blocking. **Who feels it:** sponsor, council members, anyone who later relies on the record (auditor, insurer, court).
- **Situation.** GOALS.md gates are held by human acts: counsel engaged, company incorporated, council sign-off, alpha with real people. `drive.mjs` promises it "never closed here … closes on its evidence, by its owner, in Meridian" (drive.mjs, RAID section). That promise lives in the script, not in Meridian. The same AI agent writes the repository file that serves as the "evidence", holds the integration key, and holds the admin password.
- **Evidence (from my instance):**
  - **T5c.** The integration key "Agent test sync" (`write:portfolio`) closed **DEP-10 "Gate 0 human act — Insurance"**, owned by PE-01 (founder). The body was `PUT /api/v1/raid/agent:DEP-10 {adopt:"DEP-10", status:"Closed", closureEvidence:"mliad313sn/fitadapt@a9c31fd…"}` and the answer was **200**. The row now reads Closed, `closedBy: null`. Audit: `Agent test sync (service) · Item closed · DEP-10`. Any commit satisfies `humanActRefusal` (`server/src/evidence.js:99`), including one the agent just pushed.
  - **T5a.** The PO account (group on FAD) closed **DEP-08**, the *sponsor's* act, with the evidence `docs/legal/founder-checklist.md@a9c31fd`: **200**. Nothing checks that the closer is the act's owner.
  - **T9a.** The same key posed a Gate-1 criterion on PRJ-202 and found it **met, `reviewedBy: "PE-22"`** (Council seat A2, *open*: nobody holds it): **201**. `v1write.js:890-898` checks only that the named person exists and doesn't own the cited document. The audit row reads `Agent test sync (service) · Gate criterion met · GC-1` and doesn't even record who it says reviewed it.
  - **T9b.** A key with `write:meetings` (FitAdapt's own key has that scope, `meridian-client.mjs` SCOPES) recorded **DEC-002 "Re-baselined Phase 1 on real turn counts", status Ratified, `ratifiedBy: "PE-01"`**: **201**. `canRatifyDecision` (`v1write.js:804-808`) checks the ratifier against the decider and the recorder, but never against the founder's own consent.
  - The same pattern holds for `acceptedBy` on milestones (openapi `/api/v1/milestones`: "A milestone with acceptanceCriteria cannot be marked done without acceptedBy"): the writer names the acceptor.
  - `app_user` and `person` have no notion of *who or what* is acting. The one exception is the integration row itself (migration 025).
- **Proposal: attested acts.** Additive, and it respects D-05.
  1. **Actor kind.** `app_user.actor_kind` is `human` (the default) or `agent`. Integrations are already service rows, and they count as `agent`. An administrator marks the account an AI agent signs into as `agent`. It shows on every audit label ("… (group · agent)").
  2. **A named class of human acts in `shared/rbac.js`**: `HUMAN_ACTS = {document.approve, humanact.close, criterion.meet, milestone.accept, decision.ratify, change.approve, waiver.grant, objection.resolve}`. `can()` refuses these to `actor_kind = agent` and to integration keys, with the reason "this is a human act — an agent can record it as proposed, the named person confirms it".
  3. **Attestation, not assertion.** When the writer is not the named person (`reviewedBy`, `ratifiedBy`, `acceptedBy`, the act's `owner`), the row is stored as **proposed**, with `attested=false` and `asserted_by = <user/integration>`. The named person confirms it from a session: "Confirm that you reviewed this". Only then does it count. That keeps RT365's integration paths working (REQ-49/51) without letting them decide.
  4. **Closing a blocking human act** needs the act's owner, the owner's delegate (GOV-02), or group level with a stated reason. The reason is shown on the gate line.
  - **Gate engine:** additive. `gateStatus` counts a criterion as met, and a hold as lifted, only when it is attested *or* when the programme has not set `requireAttestation`. Existing books compute exactly as today.
- **Test (proposed `attestation.test.js`).**
  - An integration closing a blocking act, or finding a criterion met in someone else's name, gives 403 when `requireAttestation` is on. With it off, the row stores `attested:false`.
  - An `agent` session calling each action in `HUMAN_ACTS` gives 403. An exhaustive sweep, like `review-grant.test.js`, shows that nothing else changes.
  - The named person confirms, the gate clears, and the audit row carries both the asserter and the attester.
  - The whole demonstration book with the setting off gives the same `Engine.metrics`/`roll`.
- **Not proposing:** detecting AI use, or banning agents. FitAdapt *wants* the agent to prepare everything. The line is only that an agent can't be the one who says "a human did this".

### GOV-02 · No delegation of authority, only an absence

- **Severity:** Blocking. **Who feels it:** sponsor (founder), the AI Product Owner, auditor.
- **Situation.** The founder delegated all authority to an AI PO, but not all of it can be delegated. CLAUDE.md legal rule 5 ("never mark anything counsel-approved"), docs/governance/01 §3 ("Marking … validated:true → the council seat", "Launch go/no-go → Sponsor") and docs/02 §2 (the forbidden combinations) all name powers that stay with the founder or the council. The record has to answer three questions: *who delegated what, to whom, until when, on what instrument*, and *was this act done under it?*
- **Evidence:**
  - The only mechanism is R-02's absence deputy (`server/src/auth.js:90-120`, `routes/portfolio.js:1776-1830`). **T13:** `POST /api/absences {person:"PE-01", from:"2026-09-01", to:"2027-06-30", deputy:"PE-02", note:"Founder delegates all authority…"}` was **accepted**: a ten-month "absence", with no ceiling. The PO then `actas` the founder.
  - While acting, the deputy takes **the absent person's full role and grants** ("never a union", auth.js:110). There is no way to *narrow* the delegation. The one limit is SoD through `selfMatch`, which works: **T13** shows the PO acting for the founder still refused on the PO's own documents.
  - **T14:** acting for the founder, the PO **approved DOC-14 "Advisory-board agreement", waiting on seat B2** (200). The audit label reads `Product Owner (to appoint) (pour Founder (sponsor)) (group)`. The word "pour" is **hard-coded French** in `auth.js` (`displayName: … (pour …)`), whatever the locale. The acting-for fact exists **only inside a label string**: `audit_event` has `user_id` and `user_label` (`migrations/001_core.sql:89`), so "everything done under the founder's authority" can't be queried.
  - A deputy must be a directory person with an account. An integration can't be anyone's deputy, so an AI agent acting through a key is outside the mechanism entirely: it writes as "FitAdapt repository sync (service)" with the key's own scopes.
- **Proposal: a delegation register**, which Meridian's "record, don't manage" positioning supports well.
  - **Table `delegation`:** `id`, `grantor_person`, `delegate_user` (an account or an integration), `scope` (programme / project), `powers` (an explicit list of `shared/rbac.js` actions; no wildcard), `instrument` (an evidence locator under the same rule as a human act: the signed delegation letter), `from`, `to` (required, with an instance maximum; 12 months suggested), `revoked_on/by`, `row_version`.
  - **rbac:** the effective authority is the *intersection* of the grantor's authority, the delegation's `powers` and scope, and the delegate's own role. GOV-01's `HUMAN_ACTS` **can't be delegated to an `agent`** (refused at creation, with the reason). For a human delegate they are delegable, and each such act is labelled "under delegation DLG-n".
  - **Audit:** new nullable columns `audit_event.acting_for_person` and `audit_event.delegation_id`, filled by `record()` (`server/src/audit.js:23`). The absence deputy fills `acting_for_person` too. The label is translated at render time and no longer hard-coded as "pour". `GET /api/audit?actingFor=PE-01`.
  - **Screens:** Administration → *Delegations* (group level creates for their own scope; the grantor or group revokes), and the person page lists "Authority delegated by / to". FR, EN and ES.
- **Test (proposed `delegation.test.js`):**
  - A delegation's powers exclude `document.approve`, and the delegate gets 403 on approval while `project.write` passes.
  - A delegation that names `HUMAN_ACTS` for an agent is refused with 400.
  - An expired or revoked delegation drops to self, as R-02 already does.
  - The audit rows carry `delegation_id`, and `GET /api/audit?actingFor=` returns exactly them.
  - An absence deputy's rows carry `acting_for_person`.
  - Sweep: every action answers the same without a delegation.
- **Not proposing:** turning R-02 into delegation. An absence cover is a different fact (bounded by the absence) and works as designed.

### GOV-03 · "Waiting on seat A2" is decoration, and a seat can only say yes

- **Severity:** High. **Who feels it:** council members, sponsor, auditor.
- **Situation.** docs/governance/03 §5 says each seat signs only within its competence, returns *approve / approve with conditions / withhold*, and the PO "never paraphrases a position into an approval". A **withheld** safety item keeps the gate closed.
- **Evidence:**
  - `document.expected_seat_id` (migration 058) is read by the library and the gate line only. Approval (`routes/portfolio.js:3190-3240`, `approveAsReviewer` `shared/rbac.js:977`) never compares the approver with the seat's holder.
  - **T3a:** the founder (group) approved **DOC-18, waiting on seat A2 (pain model)**: 200.
  - **T3b:** the council-A2 account approved **DOC-17, waiting on seat A1 (screening wording)**, outside its competence: 200. It did so while **SEAT-A2's `person` is null** (the seat is open). The review grant is attached to the account, not to the seat.
  - **T3c:** the System Administrator approved **DOC-16, waiting on seat B3**: 200, with no break-glass marker (see GOV-10).
  - **T3d:** a reviewer sending `Withheld`, `Rejected` or `Approved with conditions` gets 403. A review grant can only approve, so "withhold" can't be recorded at all. The only way to block is an objection, and objections attach to **decisions** only (`decision_objection.decision_id NOT NULL`, migration 052).
  - The approval audit row names neither the seat nor the power used ("Document set to Approved").
- **Proposal:**
  - **Seat-bound approval.** When a document names `expected_seat`, `document.approve` requires `selfMatch(user, seat.person_id)`. Group level may **transcribe** instead: `transcribed: true`, with the member's signed statement as an evidence locator. The gate line then reads "transcribed by X for seat A2 from <statement>". That is exactly FitAdapt's §5 step 3, now visible. This is opt-in per programme (`seatBoundEvidence: true`), so today's books are unchanged.
  - **Positions.** A new `review_position` table (`target_kind` document|requirement, `target_id`, `seat_id`, `person_id`, `position` approve|approve_with_conditions|withhold, `conditions`, `statement` locator, `at`, append-only; a new position supersedes the old one). `approve` sets the document to Approved as today. `approve_with_conditions` approves and lists the conditions on the gate line. `withhold` from a seat with a veto domain **holds the gate** through the existing `openVetoes` path: generalise its input from "objection on a decision" to "open withhold or objection on anything under this gate". Additive: with no positions, the gate engine output is unchanged.
  - **Audit:** `detail` carries the seat and "review grant" or "write authority".
- **Test:** the group approving a seat-bound document gives 403, and the same with `transcribed` plus a statement gives 200 and the gate line says so. Seat A2 approving A1's document gives 403. A review grant on an open seat gives 403. A withhold from A2 holds Gate 1 and its supersession by approve lifts it. The seeded book with no expected seats computes identically.
- **Not proposing:** voting or quorum rules. FitAdapt's council signs item by item, one seat per domain.

### GOV-04 · The sign-off queue: RAID is the wrong home, and the requirement register is almost the right one

- **Severity:** High. **Who feels it:** PO (who runs the queue), council members (who work it), delivery lead.
- **Situation.** The 12 delivered modules list **418 `validated:false` rows**: M00 8, M17 14, M20 17, M06 91, M01 21, M07 54, M08 39, M02 63, M05 34, M03 41, M04 26, M09 10 (`weekly-review.md`, "Council backlog"). On top of that come **72 counsel text variants**, and one M06 row is a 152-exercise seed. `drive.mjs` folds each module into **one RAID issue** (ISS-25…36, "2 × 3: below the escalation line on purpose … this row is the work list"). Each item has a config path, a value, a `source`, a seat, a gate, and later `validatedBy` and `signOff` (CLAUDE.md rule 4). None of that fits a risk or an issue, and one row per module can't show that A2 has cleared 30 of 91.
- **Evidence:** Meridian already has the right shape. `requirement` (migration 051) carries statement, source, MoSCoW, `verification` (the method) versus `verified_by` (the proof), gate, status, owner and waiver. But:
  - there is **no `/api/v1/requirements`**. The openapi path list has none, and **T9c** `PUT /api/v1/requirements/…` with a key answers 401 because no such route is mounted. So drive.mjs can't upsert 500 rows idempotently, which is why it used RAID;
  - **a requirement doesn't hold its gate.** **T8a:** a Must requirement at rung 2 on PRJ-202, *Not started*, and the scoped gate status before and after is identical (total 6/6, unmet 0/0, holds 1/1). `shared/engine.js:554-600` reads docs, criteria and human acts only;
  - **anyone who can write the project marks it Done.** **T8b:** the engine engineer (PE-04, a site account, the author of the coefficients) set it Done with `verifiedBy: "A2 said it is fine"`: 200. `assurance.write` is "ordinary project work" (`shared/rbac.js:103`, NEW-04);
  - **T8d:** the same engineer **deleted** it: 200. The audit keeps a before-image, but the sign-off obligation is gone from the register;
  - there is no seat, no subject (config path plus value digest), and no position (see GOV-03). Decisions can't link to a requirement (the decision links are project, cr, raid, milestone, evidence).
- **Answer to the scope question.** A **requirement/acceptance register** is the right home, and Meridian already has most of one. RAID should keep one *risk* per gate ("Gate 1 sign-off queue may not clear by 1 Jan"), fed by the register's counts.
- **Proposal: extend `requirement`; don't add a new table.**
  - Columns: `signoff_seat_id`, `subject` (a canonical ref, `repo:path#pointer`), `subject_digest` (sha256 of the value, so a changed value reopens the item, like an approved document's link does), `safety_relevant` (boolean).
  - Rule: when `signoff_seat_id` is set, *Done* can only come from an attested `review_position` of that seat (GOV-03). `assurance.write` can state and update the item but can't close it. Deleting a requirement that names a seat needs `waiver.grant` (group) with a reason.
  - Gate: a programme ladder rung may declare `requirementsHold: "safety"` or `"must"`. Open requirements of that kind at that gate hold it, listed by seat in the refusal ("Gate 1 is held by 63 Must requirements awaiting seat A3"). This is additive and per rung, so existing ladders are unchanged.
  - `PUT /api/v1/requirements/:externalId` (the `changedOnly` pattern, `write:portfolio`, refusing `status: Done` from a key), with a batch form, because 500 single PUTs per sync is wasteful.
  - Screen: *Sign-off queue*, requirements grouped by seat and gate, with counts. Meetings' council agenda gains "sign-off items due for this session".
  - Decision links: `requirement_id`.
- **Test:** a Must, safety-relevant requirement at a rung with `requirementsHold` holds the gate, and its seat's approval clears it. A key setting Done gets 400. A site account setting Done on a seat-bound item gets 403. Changing `subject_digest` after approval reopens it. The batch upsert of 500 rows is idempotent (the second run writes 0 audit rows). F13 round-trips the new columns.
- **Not proposing:** holding the config values themselves in Meridian. The value stays in git, and Meridian holds its digest and the human position on it: "reference the work, don't hold it".

### GOV-05 · A gate hold can be lifted silently (defect)

- **Severity:** High, but PATCH-sized. **Who feels it:** sponsor, auditor.
- **Evidence:** **T5b:** the PO sent `PATCH /api/raid/DEP-09 {blocksGate:false}` on the sponsor's *open* Gate-0 human act "IP ownership": **200**. Gate 0 lost a hold with no evidence given. `humanActRefusal` (`evidence.js:99-116`) checks evidence only when `after.blocks_gate` is true, so switching the flag off is never examined. The audit row reads `Product Owner (to appoint) (group) · Item updated · DEP-09`, with **before and after both null**. The RAID PATCH audits no image at all (`routes/portfolio.js:1158-1160`). No one reading the trail can tell that a gate lock was removed.
- **Proposal:**
  - Switching `blocks_gate` true → false on an open item takes the same rule as closing it (closure evidence), or `holds.lift` at group level with a reason.
  - Audit action "Gate hold lifted", with before and after `{blocksGate, status, closureEvidence}`.
  - Every RAID update carries before and after for the fields it changes. This is the pattern `Requirement updated` already follows.
- **Test:** un-flagging an open blocking act with no evidence gives 400, and at group level with a reason gives 200. The audit row has the action "Gate hold lifted" and non-null images. A plain RAID edit shows the changed fields in before/after.

### GOV-06 · The audit trail can't prove itself to a third party

- **Severity:** High. **Who feels it:** auditor, counsel, a regulator or court (L11: "content approvals … logged immutably").
- **Evidence:**
  - What works: the trail is append-only against the application (`CREATE RULE audit_no_update/delete`, `001_core.sql:105-106`), written in the mutation's own transaction, and consultations are themselves logged ("Audit trail consulted").
  - What doesn't: **no integrity proof.** Rules stop the application but not the database owner, who can `DROP RULE`, edit and re-create it, and nothing detects it. FitAdapt's *own* defensibility buffer is hash-chained (M09 status, "own hash-chained defensibility buffer"), so its governance record would be weaker than its product log.
  - **No structured context:** delegation, seat and power exist only in `user_label` text (GOV-02, GOV-03). **Sparse images:** a rough count finds 225 `audited(` calls against 95 before-image literals in `server/src`; RAID updates carry none (GOV-05). **No scoped extract:** `readAudit` filters by user, entity, entityId, action and a `before` cursor, capped at 1000 (`audit.js:52-80`). A court asking for "everything about Gate 1 of programme FAD, Jan–Mar 2027" gets no project, programme or date-range filter.
- **Proposal:**
  - **A hash chain.** `record()` computes `row_hash = sha256(prev_hash ‖ canonical(row))` inside the transaction, with new columns `prev_hash` and `row_hash`. Chain over `user_id`, not `user_label`, so the off-application pseudonymisation that refusal n° 3 prescribes still verifies (or add an explicit "redaction" entry type).
  - `npm run audit:verify` reports the first broken link. The backup drill runs it.
  - `GET /api/audit/extract?programme=&project=&from=&to=` (group or `read:audit`) returns the rows, the chain head, a verification result, and a printable pack with the INTERNAL footer, reusing the FX-16 print path.
  - New nullable columns `project_id`, `acting_for_person`, `delegation_id`, `seat_id`, `power`, all additive.
- **Test:** tamper with one row as the database owner and `audit:verify` names its id. The extract for PRJ-206 contains exactly the rows of that project's entities, and its head hash equals the verifier's. Existing rows before the migration are chained from a genesis row that records the migration.
- **Not proposing:** external timestamping or anchoring to a public ledger. That is an outbound call, and Meridian makes none by default. An operator can publish the head hash themselves.

### GOV-07 · The change chain is a constant nobody at FitAdapt can complete

- **Severity:** Medium-High. **Who feels it:** sponsor, PO.
- **Situation.** docs/governance/01 §3: "Moving a gate date, cutting a module from a phase → Sponsor, through a Meridian change request". `weekly-review.md` already needs one ("ASM-02 calls for a re-plan … a re-baseline is a change request for the sponsor").
- **Evidence:** `CR_STEPS` is a constant with four steps: Project manager, Change authority, Finance, Steering (`routes/portfolio.js:1341-1346`). Since 5.23 each step needs a **distinct person** (`distinctSignatory`, `rbac.js:407`), and the raiser signs none. **T11:** the PO raised CR-224 (+4 weeks, cost 0). The **founder signed the "Project manager — raised and impact-assessed" step**, so the role label authorises nothing. The founder's second signature was refused, the PO (raiser) was refused, and the admin signed step 2 and was then refused. The CR stays **stuck at "Finance"** for a zero-cost date move, because FitAdapt has one human. The gate ladder became configuration in 5.17, but the change chain did not. There is also no `/api/v1` route for change requests (openapi path list).
- **Proposal:** a **change chain as programme configuration**, the twin of `programme.gate_model`.
  - Steps are declared as `{label, who: level|seat|person, when: {cost>, weeks>, gateMoved}}`, and a CR walks only the steps its magnitude triggers. For example: below threshold, one step (the sponsor); a gate moved, sponsor plus the gate's seats.
  - `distinctSignatory` and the raiser exclusion stay exactly as they are. A step's `who` becomes an authority check, not a label.
  - With no chain declared, a programme keeps today's four steps.
  - `PUT /api/v1/changes/:externalId` may *raise* a request, never sign one (GOV-01).
- **Test:** a FAD chain `[{label:"Sponsor", who:{person:"PE-01"}}]` for `weeks ≤ 8, cost 0`, and CR-224 is approved by the founder alone. The PO can't sign, and neither can a key. A programme with no chain declared walks the same four steps with the same refusals as `change-chain.test.js`.
- **Not proposing:** removing the distinct-signatory rule. It is right. What's wrong is that the number of signatories is fixed.

### GOV-08 · No conflict-of-interest register and no abstention

- **Severity:** Medium. **Who feels it:** council members, PO (who "keeps the register, reviewed at each session", docs/03 §8), auditor.
- **Evidence:**
  - What works: **seat incompatibility** is enforced by the database. **T12:** a seat "Product Owner" held by PE-02, declared incompatible with SEAT-A2, and giving PE-02 seat A2 was **refused, 400**: "Segregation of duties: this person already holds Product Owner…". That covers docs/02 §2's rule that "the person who submits a gate doesn't approve it" at the seat level.
  - What's missing: *declared interests* (a member's link with a wearable company, etc.) and *per-item abstention*. Attendance states are present, apologies, absent, deputy and observer (migration 052). A decision has a free-text `dissent`. Nothing lets seat A4 abstain on M10 food data and have that abstention stop them approving that item.
- **Proposal:**
  - **Tables.** `interest_declaration` (`person`, `seat`, `counterparty`, `nature`, `declared_on`, `next_review_on`, `withdrawn_on`) and `abstention` (`target_kind` decision|document|requirement, `target_id`, `seat`, `person`, `reason`, `at`), both append-only with supersession.
  - **Authority and agenda.** An abstaining person can't approve or record a position on that target (rbac, reason named). Declarations due for review appear in the per-gate or council series agenda, like "Register items due for review".
  - **Refusal n° 6 first:** write the retention period for the "declared interests" category before the migration. Declarations are personal data, and the trail can't forget them.
- **Test:** A4 abstains on REQ-x, and A4's approval of REQ-x gives 403 with the reason. A declaration past `next_review_on` is on the next council agenda. The export round-trips (F13).
- **Not proposing:** detecting conflicts automatically. Meridian records what people declare.

### GOV-09 · An external reviewer isn't a first-class person

- **Severity:** Medium. **Who feels it:** council member (their first sign-in), delivery lead (seating 11 people).
- **Evidence:**
  - `person.employment` is `staff` or `contractor` only (migration 012), and `person.site_id` is `NOT NULL` (001). FitAdapt's council seats are "staff" at site HQ (T1: PE-21…31 `employment:"staff"`).
  - The seat holder (`seat.person_id`) and the review grant (`access_grant.power='review'`) are unrelated. **T12b:** the QA lead (PE-08), who holds no seat, got a review grant on FAD: 201. **T3b:** an account approved while its seat is open.
  - Seating one member takes four separate acts across two screens (person rename, account plus password, `seat.person`, review grant). bootstrap.mjs does two of them ahead of time, which is exactly how the open seat can already approve.
  - **My week**, everyone's landing, reads RAID, milestones, activities, projects and actions owned by the person (`web/src/views/index.js:739-742`). It never shows "evidence waiting on your seat", so a council member signs in to an empty week while 91 items wait.
  - The role-based *First steps* has four roles. A reviewer is a viewer.
- **Proposal:**
  - Add `employment: 'external'` (additive enum value).
  - **"Seat a member" as one group act:** it sets `seat.person`, creates or activates the account, and derives a review grant **bound to the seat** (`access_grant.seat_id`, scope from the seat's domain). Reassigning or vacating the seat revokes that grant in the same transaction, which also records seat tenure for GOV-06.
  - My week gains "Waiting on your seat" (documents with `expected_seat`, requirements with `signoff_seat`, open objections due).
  - A reviewer's *First steps*: read the gate, open the record, record your position, declare your interests.
- **Test:** vacating a seat revokes its derived grant (the account's approval then gives 403). A review grant with a `seat_id` whose seat is vacant gives 403. My week for the A2 holder lists DOC-18. `site_id` stays as it is: an external is placed on a *team* site (5.28), so there's no schema churn.

### GOV-10 · Administrator approvals of evidence aren't break-glass (defect)

- **Severity:** Medium, PATCH-sized. **Who feels it:** auditor, delivery lead.
- **Evidence:**
  - `drive.mjs` and `bootstrap.mjs` run as the seeded System Administrator (`meridian-client.mjs` `session()`). docs/governance/04 §3 says the admin "should not approve gate evidence".
  - Meridian exempts the admin from the owner rule (S-13, `routes/portfolio.js:3205-3213`). **T3c:** the admin approved DOC-16, waiting on seat B3, and the audit row is a plain "Document set to Approved". The CR path marks its exemption `BREAK-GLASS` (`portfolio.js:1493-1504`), but the document path doesn't.
  - `posture.js:82` still says an administrator "may sign every step of a change request". 5.23 made that false.
- **Proposal:**
  - Every SoD-exempt admin act (approving evidence it owns or that waits on a seat, and anything else under S-13) carries "BREAK-GLASS" in the audit detail and on the gate line.
  - A setting `adminEvidenceApproval` (default `on` for compatibility, `off` recommended in the posture check).
  - Correct the posture sentence in EN, FR and ES.
- **Test:** an admin approval of a seat-bound document puts `BREAK-GLASS` in the detail, and with the setting off it gives 403. The posture text matches `distinctSignatory`'s behaviour.

---

## What works well (don't break it)

- **The review grant (5.26).** It is exactly scoped. The exhaustive "only `document.approve` and reads change" test is the right way to prove it, and GOV-03 builds on it. It doesn't replace it.
- **Standing human acts (5.27).** The refusal names the act and its owner ("held by human act DEP-08 … (Founder (sponsor))"). `weekly-review.md` is almost entirely Meridian's own sentences because of it.
- **SoD by person, not by account.** `selfMatch` and `distinctSignatory` hold through deputyship (T13: acting for the founder didn't let the PO approve their own documents). Seat incompatibility is enforced in the database (T12).
- **Decisions are never edited.** Supersession, ratification independence, objections with reasons, and a veto that holds a gate.
- **The first-password rule** ("Choose your own password first — until you do, the trail cannot say this was you"). It fired on my first approval attempts and is the right instinct. GOV-01 extends it from "was it this account" to "was it this person".
- **Lessons** (ISO 21502 categories, group adoption, offered at project creation), the **stakeholder register** and the **communication plan**. FitAdapt uses none of them yet. Its dogfood log and the status files' "Deviations" sections are natural lesson sources: that is a FitAdapt-side action, not a Meridian gap.
- **Gate criteria with a reviewer who isn't the evidence owner, and 5.25 references** already carry "CI run passed / commit / artefact sha256" for the definition of done. Only the attestation (GOV-01) and stage acceptance (PLN-07) are missing.

## Not proposing, and why

- **RACI columns on every stage.** In FitAdapt the A is always the PO, the C is communication (already the comms plan), and the S is the sign-off seat, which GOV-04 puts on the item that needs signing. A RACI grid per stage would be task management.
- **Bulk approval of evidence.** Gate 0 alone waits on 22 documents. Batching the sponsor's approvals would make the signature cheaper exactly where it should be deliberate.
- **Holding council statements or config values in Meridian.** They stay in git and the company file. Meridian holds the locator, the digest and the position.
- **AI detection.** GOV-01 relies on declared actor kind and on attestation by the named person, not on guessing.

## Housekeeping for the PO (not Meridian code)

- Upstream issues **#16, #17 and #18** are delivered (5.26, 5.25, 5.28) but still **open**. **#10** is partly delivered: the stakeholder register and comms plan are in, migration 038. Worth closing or updating before filing new ones, so the new ones read as the next step.
- FitAdapt docs are stale against 5.26:
  - docs/governance/03 §5 step 5 still says "the PO approves it there on the member's behalf … Meridian can't yet give a reviewer approval rights";
  - docs/governance/04 §3 says council "viewer … cannot approve evidence directly";
  - dogfood-log "Workarounds still in use" still lists that workaround.

  These belong to the engineer moving the book to 5.36, so I haven't edited them.
- The user manual (docs/38) still describes 5.18 limits that later releases closed: REQ-50 "cannot be ratified from any screen", per-gate series "only by import". Separately, docs/38 §5 says "vetoes … if the book carries seats (imported)", while seats have had screens since 5.22.

## Quick wins for a first PR (defects, PATCH-sized)

1. **GOV-05:** refuse un-flagging an open blocking act without evidence, and audit before/after on RAID updates.
2. **GOV-10:** mark admin evidence approvals BREAK-GLASS and correct `posture.js:82`.
3. **GOV-02, the small part:** stop hard-coding "pour" in `auth.js` (translate the acting-for label at render time) and add `acting_for_person` to `audit_event`.
4. **GOV-01, the small part:** name the asserted reviewer in the "Gate criterion met" audit detail. Today it names nobody.
