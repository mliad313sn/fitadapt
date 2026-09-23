# Personal-data breach runbook

> **Status: DRAFT — requires counsel review** (seat B1; local counsel for each market's notification duties). Deadlines quoted below are to be confirmed by counsel for every launch jurisdiction before this runbook is relied on. Not rehearsed yet: a tabletop exercise is planned before beta.

A personal-data breach is any breach of security that leads to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data. Unsure? Treat it as one and start at step 1.

## Roles

| Role | Who (today) | Does |
|---|---|---|
| Incident lead | PE-11 (DevOps, security and privacy engineer) | Runs the response, keeps the timeline, decides containment |
| Decision owner | Product Owner | Approves notifications and user communication |
| Privacy counsel | Seat B1 (open) + local counsel | Assesses risk to people and the duty to notify per jurisdiction |
| Engineering | On-call engineer | Containment, forensics, fixes |
| Communications | PO (until a role exists) | Messages to users, stores, partners |

Contact details live in the private on-call sheet, not in git.

## 1. Detect and declare (T0)

Sources: alerts (the retention job logs `backup purge overdue`; error-rate spikes; unusual export or deletion volumes), a failing `pnpm security:secrets` run on the default branch, a report from a user, researcher, processor or app store.

- Open a private incident record with the time the company **became aware** (T0). The notification clocks start here.
- Do **not** copy personal data into the incident record, chat or tickets. Refer to affected users by internal id only.

## 2. Contain (first hours)

| Situation | Immediate action |
|---|---|
| Leaked signing secret (`AUTH_JWT_SECRET`) | Rotate it: every access token becomes invalid; users refresh or sign in again |
| Leaked pepper (`AUTH_TOKEN_PEPPER`) | Rotate it: refresh tokens and pending codes become invalid (users sign in again). Note: pseudonymous `subject_ref` values are derived from the pepper; keep the old pepper sealed for the defensibility file until counsel decides |
| Database or backup exposed | Revoke the credentials, snapshot for forensics, restrict network access, check the backup catalogue |
| Personal data found in logs or analytics | Stop the ingestion, purge the affected log range, add a failing test for the leak path, fix the scrubber |
| Compromised developer account or CI | Revoke tokens and keys, check recent commits and releases, run the secret scan on the full history |
| Vulnerable dependency exploited | Pin or patch, redeploy, check logs for the exploit pattern |
| Deletion or backup purge overdue | Find the backup still holding deleted users, rotate it out; this may be a breach of the 30-day deletion commitment |

## 3. Assess (within 24 hours)

Record: what data (categories, including health data), how many people, which jurisdictions, whether the data was encrypted and the key safe, whether it was accessed or only exposed, likely consequences for people (discrimination, embarrassment, fraud, physical harm), and whether the breach is ongoing.

Risk levels drive notification: *unlikely to result in a risk*, *risk*, *high risk*. Counsel (B1) confirms the level.

## 4. Notify

Deadlines are counted from T0. **All to be confirmed by counsel.**

| Jurisdiction | Authority | Deadline (to confirm) | People affected |
|---|---|---|---|
| EU | Lead supervisory authority (e.g. the CNIL for France) | Without undue delay and, where feasible, within 72 hours, unless the breach is unlikely to result in a risk (GDPR Art. 33) | Without undue delay if high risk (GDPR Art. 34) |
| United Kingdom | ICO | Same as GDPR under UK GDPR (72 hours) | Same as GDPR |
| United States (if launched) | FTC (Health Breach Notification Rule), state authorities where state law applies | To be confirmed by US counsel | To be confirmed by US counsel |
| Senegal | CDP | To be confirmed by Senegalese counsel (Law No. 2008-12 and any reform in force) | To be confirmed |
| Côte d'Ivoire (if launched) | ARTCI | To be confirmed by local counsel | To be confirmed |
| App stores | Apple, Google | Per their developer agreements, to be confirmed | — |
| Processors / controllers | Per the data-processing agreements | Per contract | — |

If not everything is known by the deadline, notify with what is known and complete later. User messages are plain language, in FR and EN, without blame and without minimising, and say what people can do. Wording of notifications is owned with M20 and reviewed by counsel.

## 5. Recover and review (within 2 weeks)

- Fix the root cause; add the regression test (a leak must fail CI next time).
- Post-incident review without blame: timeline, what worked, what did not, actions with owners.
- Update this runbook, the DPIA risks and the MASVS/ASVS checklist.

## 6. Breach register

Every breach, including those not notified, is recorded with facts, effects and remedial action (GDPR Art. 33(5)). The register holds incident details, so it lives in the company's private records, not in git. The defensibility file (L11) references it.
