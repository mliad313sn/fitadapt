# 05 — Dogfooding Meridian and contributing back

> Status: **draft**, owned by the delivery lead (PE-14). Meridian document DOC-05 (PRJ-206, Gate 0).
> Running log of findings: [`pmo/meridian/dogfood-log.md`](../../pmo/meridian/dogfood-log.md).

## 1. The loop

```
use Meridian for real work
   → notice friction (a bug, a missing step, a workaround)
   → log it the same day: work item on PRJ-207 + a line in dogfood-log.md
   → weekly triage (last 5 min of the delivery review): reproduce? defect or design question?
        defect  → fix it on a branch of Meridian, open a PR against main
        design  → open an issue on Meridian with the situation, not just a feature wish
   → PR/issue number goes back onto the work item; column "In review" while open
   → merged → upgrade our instance → close the work item
   → quarterly: dogfooding retrospective to the sponsor and council (activity D05)
```

## 2. Rules for contributing to Meridian

Meridian has its own non-negotiable rules ([`CONTRIBUTING.md`](https://github.com/mliad313sn/Meridian/blob/main/CONTRIBUTING.md)). A FitAdapt contribution follows them to the letter:

- `npm run verify` green before any push (tests, build, nine static gates, dependency audit); `npm run sweep` when authority is touched, with no new warning;
- a regression test that **fails without the fix**;
- a CHANGELOG entry under `[Unreleased]` that says what changed **and why it was wrong before**, plus a version bump (PATCH for a defect);
- never weaken a test or an authority check; never edit an applied migration; `shared/engine.js` is behaviour-frozen, so a change to a number it produces is argued for in the PR;
- target `main`: that is what people clone. Check the other branches first; since 5.18.1 Meridian's gate F14 fails the build when a proven line waits on a branch, so `main` is normally complete, but on 23 Sep 2026 three unmerged lines existed and two already fixed defects we hit ([#15](https://github.com/mliad313sn/Meridian/issues/15), closed by 5.16–5.17). Port rather than duplicate, and say where the fix came from.
- the delivery lead prepares a fix on a local branch (e.g. `fix/fitadapt-session-2`) and the maintainer of our side reviews it before any PR is opened.
- defects become PRs. Design questions (a new role, a new link source, a change to the authority model) become issues, because Meridian's committees decide those, not us.

## 3. What counts as friction

Anything where the team had to work around Meridian, or where Meridian said something untrue about the programme. Examples from week 0: the quick start didn't persist; the import answered 400 with no row named; an unbudgeted project reported itself green. "It would be nice if" counts too, but it's tagged P3.

## 4. Measures

| Measure | Target |
|---|---|
| Friction logged within a day of being noticed | 100% |
| Median time from log to triage | ≤ 7 days |
| Defect fixes proposed upstream (PR opened) | ≥ 1 per month |
| Open PRs older than 30 days without an answer | 0 unchosen: ask, rebase, or withdraw |
| Workarounds still in use | Listed in `dogfood-log.md`, each tied to an issue |

## 5. Guardrails

- Meridian is shared software. We never push to its `main` directly and never merge our own PR. The maintainer does.
- No FitAdapt confidential material goes into a Meridian issue or fixture. Examples use Meridian's own seed data or fictional data.
- A Meridian defect never justifies weakening a FitAdapt control. If the gate lock gets in the way, we fix the evidence, not the lock.
