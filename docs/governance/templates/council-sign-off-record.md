# Sign-off record — <seat> — <subject>

<!-- Copy to docs/governance/sign-offs/YYYY-MM-DD-<seat>-<subject>.md.
     Fictional data only in examples (L8). The member's own signed statement is the evidence;
     the PO transcribes it here and never paraphrases a position into an approval. -->

| | |
|---|---|
| Seat | A1 / A2 / … (see docs/governance/03-expert-advisory-council.md §3) |
| Member | name, or "Seat A2" if public naming is not agreed |
| Gate | Gate 1 — Safe MVP |
| Module(s) | M05 |
| Requested by | Product Owner, date |
| Response due | date (10 working days) |
| Conflict declared | none / describe; abstains Y/N |

## Items reviewed

| # | Config path / artefact | Current value | Source cited | Position | Condition or new value |
|---|---|---|---|---|---|
| 1 | `packages/safety/config/pain.json#redThreshold` | 6 | (as in file) | approve / approve with conditions / withhold | |

## Member's statement

> Verbatim text from the member, or a reference to their signed document (stored in the company file, not in git).

## Outcome

- Items approved → PR #___ sets `validated: true`, `validatedBy: "<seat>"`, `signOff: "<this file>"`.
- Items withheld → stay `validated: false`; next step: ______.
- Meridian: evidence document ____ on project ____, `uri` = this file at a pinned commit.
