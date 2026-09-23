# 02 — End-to-end execution team

> Status: **draft**, owned by the Product Owner. Meridian document DOC-02 (PRJ-206, Gate 1).
> Every role below is a person-row in the Meridian book (`PE-01`…`PE-14`) with an allocation. Names are filled in as roles are appointed.

## 1. How the team works

FitAdapt is built through Claude Code `/goal` runs. Each module has a goal file (`goals/Mxx-*.goal.txt`) with verifiable conditions and a turn cap. The humans on the team decide, review, validate and own. The agent does most of the typing, but it does not own any decision.

```
PO picks the next module (GOALS.md order)
  → module owner opens branch, runs the /goal
  → agent builds until conditions are met or the turn cap is hit; writes docs/status/Mxx.md
  → tech lead + QA review the PR against the definition of done (CLAUDE.md)
  → merge; Meridian activity % and gate evidence updated
  → validated:false items listed in the status file go to the council sign-off queue
```

A module is never "done" because the agent says so. It is done when a human reviewer has checked the pasted command output against the spec's acceptance criteria.

## 2. Roles

| ID | Role | Accountable for | Needed from | Load |
|---|---|---|---|---|
| PE-01 | **Sponsor** (founder) | Budget, company, Gate 0, go/no-go | now | 0.2 |
| PE-02 | **Product Owner** | Scope, order, gates, council, Meridian truth (`01`) | now | 0.9 |
| PE-03 | **Tech lead & architect** | ADR-001…003, monorepo, performance budgets, PR review of every module | wk 1 | 0.9 |
| PE-04 | **Engine & safety engineer** | `packages/engine`, `packages/safety`, S1–S7 property tests, golden personas; M02, M05, M07, M08, M10 | wk 1 | 0.9 |
| PE-05 | **Mobile engineer** | Expo app, offline-first, accessibility; M01, M03, M04 | wk 1 | 0.9 |
| PE-06 | **Backend & sync engineer** | Fastify API, sync, Fair Pair multi-device; M09, M12, M15, M16 | wk 2 | 0.9 |
| PE-07 | **Data/ML & AI-safety engineer** | M11 grounding and evals, M14 on-device ML, M18 analytics without personal data | wk 8 | 0.9 |
| PE-08 | **QA & test automation lead** | Coverage gates (95% engine/safety), Maestro/Playwright, persona alpha, "no loosened tests" audit | wk 1 | 0.9 |
| PE-09 | **Product designer & UX researcher** | Design system, WCAG 2.2 AA, gym mode, alpha interviews; M13 | wk 1 | 0.9 |
| PE-10 | **Content, library & localisation lead** | M06 knowledge graph content, FR/EN copy, claims-safe wording, licence record for every asset (L6) | wk 3 | 0.9 |
| PE-11 | **DevOps, security & privacy engineer** | CI/CD, secrets, M17 baseline and completion, pen-test, Meridian backups | wk 2 | 0.9 |
| PE-12 | **Legal & compliance coordinator** | M20 registers, counsel liaison, Gate 0 checklist, IP-assignment register. Not a lawyer, and says so. | wk 1 | 0.8 |
| PE-13 | **Growth & go-to-market lead** | M16 pricing inputs, M19 store readiness, substantiation file (L1) | wk 22 | 0.9 |
| PE-14 | **Delivery lead & Meridian champion** | The Meridian instance, meeting cadence, RAID hygiene, the dogfooding loop (`05`) | wk 1 | 0.3 + 0.3 |

A small team can have one person hold two hats (e.g. PE-11 with PE-14, or PE-09 with PE-10). The PO records each combination as an assumption in Meridian. Three combinations are **not allowed**, because they break separation of duties:

- PE-04 (engine) and PE-08 (QA): the person who writes the safety invariants doesn't audit their tests.
- PE-02 (PO) and any council seat: the person who submits a gate doesn't approve it.
- PE-12 (compliance) and counsel: a coordinator is not counsel (L5).

## 3. Who leads which module

R = runs the `/goal` and owns the PR · A = accepts · C = consulted · S = council sign-off required before public launch

| Module | R | A | C | S (seat) |
|---|---|---|---|---|
| M00 Platform foundation | PE-03 | PE-02 | PE-11, PE-09 | — |
| M17 Privacy & security (baseline / full) | PE-11 | PE-02 | PE-12 | B1 |
| M20 Legal framework & defensibility | PE-12 | PE-02 | PE-03 | B2, B3, B4 |
| M06 Exercise library | PE-10 | PE-02 | PE-04 | A2, A3 |
| M01 Onboarding & screening | PE-05 | PE-02 | PE-12 | A1, B2 |
| M07 Assessment | PE-04 | PE-02 | PE-08 | A3, A5 |
| M08 Program architect | PE-04 | PE-02 | PE-03 | A3, A5 |
| M02 Adaptive engine | PE-04 | PE-02 | PE-03, PE-08 | A3, A5 |
| M05 Recovery & pain safety | PE-04 | PE-02 | PE-05 | A1, A2, B4 |
| M03 Cardio | PE-05 | PE-02 | PE-04 | A1, A5 |
| M04 Tracking & dashboard | PE-05 | PE-02 | PE-11 | A6 |
| M09 Fair Pair | PE-06 | PE-02 | PE-04 | A3 |
| M10 Nutrition | PE-04 | PE-02 | PE-12 | A4, A1, B4 |
| M11 AI coach | PE-07 | PE-02 | PE-12, PE-04 | A1, B4 |
| M12 Wearables | PE-06 | PE-02 | PE-11 | B1 |
| M13 Engagement & community | PE-09 | PE-02 | PE-12 | A6, B2 |
| M16 Monetization | PE-06 | PE-02 | PE-13, PE-12 | B2 |
| M18 Analytics & admin CMS | PE-07 | PE-02 | PE-11 | B1 |
| M15 Coach portal | PE-06 | PE-02 | PE-12 | B2 |
| M14 Voice & motion | PE-07 | PE-02 | PE-11 | B1 |
| M19 Launch readiness | PE-13 | PE-01 | everyone | all seats |

## 4. Staffing by phase

| Phase | Weeks | Core team on it | Joins |
|---|---|---|---|
| 0 Foundation | 1–3 | PE-01, 02, 03, 04, 05, 08, 09, 11, 12, 14 | — |
| 1 Safe MVP | 4–14 | + PE-06, PE-10 | Council A1–A5 seated by wk 12 |
| 2 Differentiation | 15–22 | + PE-07 | Council A4, B4 active |
| 3 Business & scale | 23–29 | + PE-13 | Council B2 active |
| 4 Launch | 30–36 | all | External pen-testers, all seats |

Timings are indicative (RAID ASM-02). The PO re-baselines at Gate 0 using the real turn counts of M00, M17 and M20.

## 5. Rules everyone on the team signs up to

1. `CLAUDE.md` is the contract, and its non-negotiable and legal rules bind humans as well as agents.
2. Never delete, skip or loosen a test to get green. If a test is wrong, say so in the PR.
3. Never set `validated: true` without a council sign-off record (`03`, §5).
4. Never write "counsel-approved" on anything. Only counsel does.
5. Anything that slows you down in Meridian gets logged (`05`), not worked around in silence.
