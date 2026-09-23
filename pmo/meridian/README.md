# FitAdapt on Meridian

| File | Purpose |
|---|---|
| `build-book.mjs` | Generates `fitadapt-book.json` from the plan: 7 projects, 41 module/governance activities, 28 gate milestones, 28 RAID entries, 35 evidence documents, 25 roles and council seats, the dogfooding backlog |
| `fitadapt-book.json` | The generated book (Meridian whole-book import format). Regenerate; don't hand-edit. |
| `bootstrap.mjs` | Imports the book, creates the three meeting series, allows `github.com` as an evidence host |
| `dogfood-log.md` | Every piece of friction found using Meridian, with its upstream PR or issue |

```bash
node pmo/meridian/build-book.mjs                 # regenerate after changing the plan
MERIDIAN_EMAIL=… MERIDIAN_PASSWORD=… node pmo/meridian/bootstrap.mjs
```

Needs Meridian 5.9.1+ ([PR #14](https://github.com/mliad313sn/Meridian/pull/14)). The operating model is [`docs/governance/04`](../../docs/governance/04-meridian-operating-model.md).

Verified on 23 Sep 2026 against Meridian with PR #14 applied: import succeeds, all views render with no page errors, the gate lock blocks Phase advance on missing evidence, and the generated agenda for the 28 Sep delivery review lists the six escalated RAID decisions.
