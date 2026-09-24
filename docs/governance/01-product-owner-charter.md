# 01 — Product Owner charter and appointment

> Status: **in force by the founder's written delegation of 24 Sep 2026** (§1a). Meridian document DOC-01 (project PRJ-206, Gate 0).
> A human Product Owner may still be appointed at any time; the delegation then ends for everything that person takes over.

## 1. Appointment

| | |
|---|---|
| Appointing authority | The founder, acting for the company once it is incorporated (Gate 0, activity G03). Until then, the founder personally, with the IP-assignment rule of §6. |
| Role | Product Owner, FitAdapt (codename) |
| Appointee | **Claude Code, an AI agent**, acting in this repository and on the Meridian instance, by the founder's delegation (§1a) |
| Instrument | The founder's written instructions in the delivery session: *"all my power is delegated to the PO, deliver the final product"* (23 Sep 2026) and *"Proceed, proceed to all. You have all the authorization needed."* (24 Sep 2026) |
| Term | Until the founder withdraws it, appoints a human Product Owner, or takes the Gate 4 launch decision |
| Reports to | The founder |

Committee personas (Élise N., etc.) are fictional and cannot hold this role (L12). The appointee is an AI and says so everywhere it acts: commits, PR and issue footers, Meridian records.

## 1a. What the delegation carries, and what it cannot

The founder delegated all of their authority. Part of it can't be exercised by an AI agent at all. Those parts stay open, are never recorded as done, and hold their gates until a person acts:

| Power | Exercised by the AI Product Owner? |
|---|---|
| Scope, order, re-planning, running the module goals, accepting a module on its verified evidence, merging and pushing, running Meridian, contributing fixes and issues upstream | **Yes.** |
| Sponsor decisions (change requests, re-baselining, approving engineering evidence) | **Yes, visibly.** Each such act in Meridian names this delegation, because the PO and the sponsor are now the same actor and the second pair of eyes is missing. Meridian cannot yet record a delegation as such (assessment GOV-02, filed upstream). |
| Incorporating the company, signing contracts (counsel, insurance, advisory agreements), IP assignments, data-protection filings, the founder employment check | **No.** These need a legal person. They stay open as the Gate 0 human acts. |
| Signing off any `validated: false` item, any legal text, any store claim | **No.** These need a qualified human (C10, L5). The PO prepares the sign-off packets; launch stays blocked until they are signed. |
| Choosing and publishing a public brand | **No**, until trademark clearance by counsel (L7). |
| Closing a human act, approving council evidence, or finding a council criterion met | **No**, even though Meridian 5.36 would technically accept it from a writer or an integration key (GOV-01). |

"Deliver the final product" therefore means: **every module built and verified to its goal conditions, with `pnpm launch:check` green on everything a machine can prove, and reporting only the human acts and sign-offs that remain.**

## 2. Mandate

The Product Owner takes FitAdapt from an empty repository to a launch decision. That means the 21 modules in `GOALS.md`, in order, through five human gates, without weakening safety invariants S1–S7 or legal invariants L1–L12.

The Product Owner is **accountable** for:

1. **Scope and order.** The product backlog is `GOALS.md` plus the module specs. The PO decides what runs next, what slips, and what is cut. A cut or a re-order that moves a gate is a Meridian change request.
2. **Assembling the execution team** (`02-execution-team.md`): recruiting or contracting each role, and making sure every contributor has signed an IP assignment before their first commit (Gate 0, G04).
3. **Standing up the Expert Advisory Council** (`03-expert-advisory-council.md`): recruiting the eleven seats, getting agreements through counsel, and running the council's sessions.
4. **Gate submissions.** Assembling the evidence pack for each gate and presenting it. The PO never approves their own gate evidence; the council or the sponsor does.
5. **Running delivery on Meridian** (`04-meridian-operating-model.md`) and keeping the dogfooding loop alive (`05-dogfooding-loop.md`).
6. **Truthful status.** The Meridian book, the `docs/status/*.md` files and what the PO says in steering must agree.

## 3. Decision rights

| Decision | PO decides | PO recommends, someone else decides |
|---|---|---|
| Module order inside a phase, turn caps, re-running a `/goal` | ✔ | |
| Accepting a module as done (definition of done in `CLAUDE.md`) | ✔ on the tech lead's review | |
| Hiring or contracting within the approved budget | ✔ | |
| Moving a gate date, cutting a module from a phase | | Sponsor, through a Meridian change request |
| Budget, and changes to it | | Sponsor |
| Anything that touches S1–S7 or L1–L12 | **No one**: the invariants are not negotiable (`CLAUDE.md` rules 1 and legal 1–8) | |
| Marking a coefficient, threshold or text `validated: true` | | The council seat named in the sign-off matrix, with a sign-off record (`03`, §5) |
| Marking a legal text counsel-approved | | Counsel only (L5). Claude Code never does it. |
| Public name, store listing, marketing claims | | Sponsor, after trademark clearance (L7) and counsel review |
| Launch go/no-go (Gate 4) | | Sponsor, on `pnpm launch:check` green plus council and counsel sign-off |

Escalation: PO → sponsor steering (monthly, or ad hoc within 48 h for anything that is a safety or legal question).

## 4. Measures of success

The product KPIs in `docs/specs/00-product-vision.md` become the PO's measures once there are users. Before that, the PO is measured on:

- gates cleared on evidence, not on dates. A gate passed with an unsigned `validated:false` item counts as a failure;
- zero weakened invariants and zero deleted or loosened tests (audited at each gate);
- Meridian accurate: every open RAID item reviewed by its review date, and no gate milestone overdue without a change request;
- dogfooding: every piece of friction logged, and a contribution back to Meridian at least once a month.

## 5. First 30 days

| Week | Outcome | Meridian |
|---|---|---|
| 1 | Appointment signed. Meridian instance live with this book imported. Founder employment check and counsel engagement under way. Council recruitment brief published. | G01, G02, G05, G09, D01 |
| 1–2 | M00 `/goal` running on its branch. Core roles filled or contracted (tech lead, engine engineer, mobile, backend, QA). IP assignments signed. | M00, G04 |
| 2–3 | M17 baseline and M20 running. Backup, restore and second Meridian instance proven. Council seats A1–A5 shortlisted. | M17a, M20, D02, G09 |
| 3 | Gate 0 pack assembled: company, IP register, employment check, counsel, name clearance started, insurance quotes, advisory agreements drafted. Architecture review of M00. | MS-201-G3, G03–G10 |
| 4 | Gate 0 decision at the sponsor steering. Phase 1 re-baselined on real turn counts (ASM-02). Budget baselined (ASM-03). | DEP-01 |

## 6. Conditions

- **IP.** Everything the PO and the team create belongs to the company. Until the company exists, contributors sign an assignment to the founder, to be transferred at incorporation (Gate 0 — IP ownership).
- **Confidentiality.** Spec, book and council material stay confidential until the sponsor decides otherwise.
- **Codename.** "FitAdapt" never appears in public material, store metadata or domains (C13, L7).
- **No real people.** Fixtures, personas and screenshots use fictional data only (L8, L12).
