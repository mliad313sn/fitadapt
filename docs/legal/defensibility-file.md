# Defensibility file (L11)

> **DRAFT — requires counsel review.** Design: docs/adr/ADR-009-defensibility-log.md. Retention periods are configuration with `validated: false` until counsel sets them.

## What is recorded

| Event | When | Payload (no personal data) |
|---|---|---|
| `acceptance.recorded` | Terms, exercise-risk acknowledgment, subscription terms, community guidelines accepted; the Privacy Policy confirmed as read (FIX-B: information, not accepted) | document id, version, locale, jurisdiction, SHA-256 of the exact text shown, source; FIX-B: how assent was given — screen and flow version (`presentation`, e.g. `onboarding.terms@2`), `assentMethod` (button after opening, read, statements ticked), `textOpened`, `appBuild`, `jurisdictionSource` (user confirmed or device locale), the exercise-risk `statementIds` ticked one by one. The API adds its own receipt time beside the device time (`receiveAcceptance`) |
| `consent.recorded` | Any M17 consent grant or withdrawal (health-data consent included) | data type, decision, version, locale, jurisdiction |
| `notice.shown` / `notice.acknowledged` | Point-of-risk notice displayed / confirmed (L3) and AI disclosure (L5); M03: the intensity notice (`first_hiit`) is recorded as shown, and Start stays disabled until it is acknowledged, before the first high-intensity session; M09: the Fair Challenge notice (`pair_challenge`) and each person's first-workout notice, in each partner's own ledger, before a pair session starts; M10: the nutrition-deficit notice (`nutrition_deficit`), shown when a fat-loss set-up with numbers is chosen and acknowledged before any pace can be chosen | notice id, version, locale, jurisdiction, SHA-256 of the text shown |
| `safety.event` | An S1–S7 gate blocks, substitutes, caps or ends a session; M05: an S3 red flag (in a session or at the readiness check-in: "session ended" and "intensity locked") and a pain report that makes a joint red (S2 "joint flagged"), each written in the same transaction as the synced execution log, and on the device chain at once; M03: S1 when a program's intervals become steady, S2 "blocked" when a conditioning movement is left out because it loads a red joint; M04: S4 "handed off" when a sustained body-weight loss is handed to the nutrition guardrails; M10: S4 "capped" when a nutrition target is held at the estimated BMR, at 1 % a week or without a goal weight below BMI 18.5, S4 "blocked" when a fat-loss goal meets disabled deficit features (under 18, advised against calorie restriction, not screened, special population), S4 "deficit reduced" when a hand-off pauses and then reduces a planned deficit; written with the nutrition plan in the sync transaction and on the device chain at once | invariant, reason code, action, engine version |
| `prescription.issued` | A session the engine prescribed is started (M02; M03: cardio sessions and cardio finishers too, with the cardio block's and its zones' reason codes); written in the same transaction as the synced session record | prescription (plan) id, engine version, session rules version, every reason code of the plan |
| `safety.attested` | The user attests the review that lifts a safety lock (S3: the M05 two-step self-attestation of a medical review after a red-flag stop; the execution log keeps the statement version) | invariant, reason code, engine version |
| `program.generated` | A program (M08) is stored; written in the same transaction as the program record | program id, engine version, program rules version, template id, reason codes |
| `program.reflowed` | The engine shifts, merges or skips a session the user could not do (M08); same transaction as the reflow record | program id, session id, outcome, engine version |
| `nutrition.target_set` | M10: a nutrition target the engine prescribed is stored (set-up, weekly update, guardrail hand-off, changed settings or SafetyProfile); same transaction as the synced plan, and on the device chain at once. Never a calorie, weight, intake or goal-weight value | target id, engine version, nutrition rules version, mode (numeric / supportive / needs measurements), why it was computed, whether deficit features were allowed, every reason code |
| `pair.joined` | M09 Fair Pair: a person takes part in a pair session (single device: in their own device chain, a guest in their own; multi-device: in the join transaction) | pair session id, role (host/partner), mode, the sharing scopes they chose, partner-sharing consent version |
| `pair.timeline_built` | M09: the pair planner ordered the two plans into one timeline (device chain of each person) | pair session id, the person's own plan id, engine version, pair rules version, reason codes |
| `pair.challenge_started` | M09: both partners chose the Fair Challenge and acknowledged its notice (`pair_challenge`); each in their own chain, in the same transaction | pair session id, pair rules version |
| `pair.left` | M09: a person left the pair session, in their OWN chain only (completed, stopped, safety stop, consent withdrawn); written with the relayed event | pair session id, reason |
| `pair.partner_left` | M09: the partner left — in the other person's chain, never with the partner's reason (a safety stop is not revealed) | pair session id |
| `content.approved` | Exercise, notice or copy approved by a council seat | content id, version, reviewer seat, sign-off record path |
| `incident.recorded` | Each step of incident-procedure.md | incident id, category, step |
| `legal_hold.placed` / `released` | Legal hold on a subject | hold id, reason code |
| `log.accessed` | Every export or integrity check | actor role, purpose, subject digest, events returned |
| `retention.purged` | A subject chain removed after its retention period | chain digest, event count, head hash |

Events are keyed by a pseudonymous subject reference (keyed hash of the user id, as for M17 audit entries), so the file survives account deletion without holding the user's email or name. It is still pseudonymous personal data: lawful basis and period are open questions for counsel (docs/status/M20.md).

## Screens per release (FIX-B)

A record proves what text was shown; courts also ask what the screen looked like (B pre-review §1.3, *Berman*). Each release archive keeps a rendered screenshot or template of every legal screen named by a `presentation` id (health consent with "Where do you live?", Terms and Privacy, exercise risk, the guest legal step), per locale. Raise `LEGAL_FLOW_VERSION` (apps/mobile/src/legal/presentation.ts) whenever one of them changes. Not automated yet (open item, docs/status/M20.md).

## Integrity and access

- One hash chain per subject plus a `global` chain. Each event's SHA-256 covers its fields and the previous event's hash.
- PostgreSQL rejects `UPDATE` and `DELETE` on `defensibility_events` by trigger; the only deletion path is the retention purge, which runs inside a transaction that sets a purge flag and removes whole chains only.
- Every read through the export command writes a `log.accessed` event first.

## Retention and legal hold

- `defensibilityRetentionDays` = 3650 days (10 years) after the subject's last event, `validated: false` (packages/legal/src/config.ts). Counsel to confirm per jurisdiction.
- A subject under legal hold is never purged.

## Legal-hold export

`pnpm legal:export --user <user-id> [--out <file>] [--actor <role>]` places a legal hold, logs the access and writes a JSON file with the subject's acceptances, consents, notices, safety events, prescriptions, programs, pair sessions (M09), nutrition targets (M10), engine versions, holds, access log, the full chain and its verification result. KPI: produced in < 1 day (`legalHoldExportTargetHours`); in practice seconds.
