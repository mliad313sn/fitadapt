# Incident and complaint procedure

> **DRAFT — requires counsel review.** Internal procedure written by a non-lawyer drafting assistant. Deadlines for regulators and insurers depend on the jurisdiction and the policy wording and **must be confirmed by counsel and the broker**; the data-breach part is in `docs/compliance/breach-runbook.md` (M17). Roles are seats, not people: no one is named until real people are appointed.

Every step below is recorded in the defensibility log as an `incident.recorded` event (incident id, category, step; no personal data), so the handling itself is provable (L11).

## 1. Injury report intake

- Channels: in-app "Report a problem" (M13/M19), support email, coach portal (M15), app-store reviews that describe an injury.
- The first responder (support seat) records: date received, channel, product area, whether the person is safe now. Clinical details are **not** typed into tickets; the reporter is asked for consent before any health information is stored (L9).
- If the report describes an emergency, the reply gives the local emergency guidance (jurisdiction matrix) before anything else.
- Record `incident.recorded { category: injury_report, step: received }`.

## 2. Complaint handling (non-injury)

- Complaints about claims, subscriptions, content, coaches or data: acknowledge, classify (`complaint`, `claims_violation`, `harmful_content`, `data_breach`), answer within the internal target set by counsel.
- A reported medical or results claim is treated as a `claims_violation`: remove or reword the copy, add a linter rule or fixture if it slipped through, and review the substantiation file.

## 3. Triage and escalation

- Triage within one working day (internal target, to be confirmed): severity (serious injury, minor injury, no injury), product link (followed a prescription? which engine version? which notices were shown?).
- Serious injury, any claim letter, a regulator contact or media interest: escalate at once to the Product Owner and counsel; step `escalated`.
- Pull the user's defensibility chain with `pnpm legal:export --user <id>` (access is itself logged); verify the chain result is `ok: true`.

## 4. Legal hold

- On escalation, counsel decides whether a legal hold applies. `pnpm legal:export` places a hold on the subject's defensibility chain (`legal_hold.placed`), which suspends the retention purge for that subject.
- Preserve related records outside the log (support tickets, content versions, release notes) and suspend their deletion.
- Release only on counsel's written instruction (`legal_hold.released`).

## 5. Regulator notification

- Personal-data breach: follow `docs/compliance/breach-runbook.md` (e.g. GDPR Art. 33 authority notification timelines).
- Product-safety or medical-device questions (a regulator treating the app as having a medical purpose): counsel leads all contact.
- Record `regulator_notified` with the date; copies of the notification are kept by counsel.

## 6. Insurer notification

- Notify the product/professional liability insurer of any circumstance that may give rise to a claim, within the policy's notice period (to be taken from the policy once it exists — Gate 0 "Insurance" is open).
- Provide the legal-hold export on request; record `insurer_notified`.

## 7. Close and learn

- Close with counsel's agreement (`closed`); record the root cause and any product change (safety rule, notice wording, content fix) with its review sign-off (`content.approved`).
