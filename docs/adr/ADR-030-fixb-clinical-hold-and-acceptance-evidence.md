# ADR-030 — FIX-B: training hold before clearance, S3 stop lists, and evidence of assent

- Status: accepted (engineering); every value and text below is `validated: false` or a draft that requires counsel review.
- Date: 2026-09-24
- Context: the fix wave after the deep review. Inputs: the AI pre-reviews `docs/governance/ai-reviews/A1-A2-clinical-safety.md`, `B-legal-regulatory.md` and `A4-A6-nutrition-behaviour.md`, and `review/mobile.md` MOB-13. Under docs/governance/03-expert-advisory-council.md §5 a pre-review correction may be applied now only if it is stricter; each one here is.
- Number: collisions with other fixers' ADRs are resolved at merge.

## Decisions

### 1. A training hold above S1, read from the screening rules

Symptom flags (`chest_discomfort`, `fainting_or_dizziness`, `unusual_breathlessness`) and `advised_to_limit_activity` are `beforeClearance: 'hold'` rules in `SCREENING_RULES` (0.2.0). Until clearance is attested:

- the SafetyProfile has `automaticProgrammingAllowed: false` and the reason `safety_profile.s1.training_hold`;
- `screeningGateCheck` refuses every request (`safety.s1.training_hold`), whatever the other fields say.

The engine calls that gate for every prescription (session, cardio, assessment, program), so it refuses held users from its inputs alone, and no engine rule changed. The hold is read from `unresolvedFlags` (`trainingHoldFlags`). The profile needs no new field, and the strictest combination of several screenings keeps any hold. The S1 caps stay the invariant's floor. The hold is a stricter layer on top of them, fixed in the table, with no switch.

Not done, because it needs a new question and seat A1: the ACSM "known condition, not active → hold" branch (M01-17).

### 2. Heart-rate zones: an optional field where absence means "not allowed"

`SafetyProfile.heartRateZonesAllowed` is optional, so stored profiles and engine fixtures still parse. Only `true` allows heart-rate zones. `medication_affecting_effort` and the new `medication_affecting_heart_rate` set it to `false`. The engine side (effort-based zones and the talk test) belongs to FIX-A.

### 3. Pre-release legal drafts are revised in place

No version of any legal text has been released. Every variant is `pending`, and the production release guard refuses drafts. The FIX-B wording is therefore written into the v1 drafts instead of new versions. That covers the health consent, the exercise-risk statements, seek care, nutrition deficit, and the pregnancy and urgent-care notices. No user holds a v1 acceptance that needs protecting. The content hash still proves which text was shown. Once a text is released, a change creates a new version, as ADR-008 requires.

### 4. S3 stop lists and their guidance

- `RED_FLAG_SYMPTOMS` gains the stroke signs, a sudden severe headache and a sudden change of vision.
- `PREGNANCY_WARNING_SIGNS` are paraphrased from the themes of ACOG CO 804, never its wording. The S7 pregnancy path shows them.
- `URGENT_MSK_SIGNS` appear in a separate step after a pain rating of 6 or more. They sit outside the pain traffic light, which stays unchanged.

Every one of these is an S3 stop: the session ends and intensity locks until a review is attested. Each maps to its own notice: `seek_care`, `pregnancy_warning` or `urgent_care`. The emergency line is unconditional. `emergency.medical` holds the SAMU numbers: France 15 beside 112, Senegal 1515 or 15, Côte d'Ivoire 185. All are `validated: false`. Where no general number is confirmed, the generic line is always shown with them.

### 5. Evidence of assent

- `AcceptanceRecord.evidence` records `presentation` (screen@flow version), `assentMethod`, `textOpened`, `appBuild`, `jurisdictionSource` and `statementIds`.
- `serverReceivedAt` is set by the server only (`receiveAcceptance`).
- `checkAcceptance` validates evidence when it is sent.
- The exercise-risk acknowledgment is four statements, each ticked on its own and off by default, plus "does not limit your legal rights".
- The Privacy Policy is "read", not "accepted".
- The country of residence is asked on the first legal screen (health consent), never inferred from the locale. The legal store keeps it, the consent ledger follows it, and the Terms screen asks again if it was never confirmed.

The API must store `evidence` and `serverReceivedAt` (FIX-C). Until then the route strips the unknown field.

Design only (not built): once a day, anchor the global chain head with an eIDAS qualified time stamp (Art. 41(2)), or at least in write-once storage.

### 6. Automatic legal hold on incidents

`automaticLegalHold` places a hold (reason `legal_hold.auto.incident_reported`) after any `incident.recorded` step except `closed`, unless a hold is already open. It runs on the device buffer and inside the API's append transaction. Releasing a hold stays a human decision. The retention period itself is left to counsel.

### 7. A rejected screening fails closed

Sync (FIX-E) drops a record the server rejected, which could bring an older, looser screening back into force. `safetyProfileFromScreenings(…, { screeningRejected: true })` therefore returns the strictest combination of the accepted history and "not screened", and `rescreenStatus` makes a re-screen due now. The flag is an input; it is wired from the sync client at merge.

### 8. Eating disorder

A self-reported current or past eating disorder is a `nutrition` rule (seat A4). It switches deficit features off. `deficitFeatures` returns its own reason, and the engine maps that to supportive copy that signposts a doctor or a specialist service. No service is named: A4 and counsel choose them per market.

## Consequences

- Held users can still reach the first-workout screen (to see the hold explained) and nutrition. Workout, assessment, calendar and pair routes are closed.
- Tests that used a symptom flag to exercise the S1 caps now use `heart_or_blood_pressure`, so they still test the caps.
- New `validated: false` items are listed in docs/status/M01.md, M05.md, M10.md and M20.md.
