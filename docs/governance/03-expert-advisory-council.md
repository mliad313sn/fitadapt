# 03 — Expert Advisory Council

> Status: **draft charter.** Meridian document DOC-03 (PRJ-206, Gate 1). Needs counsel review of §7 before any agreement is signed.
> All eleven seats are **open** (RAID ISS-02). No member names appear here until a signed agreement allows it.

## 1. Why the council exists

The v2.1 committee review was a **simulated panel**: personas used to stress-test the spec. It is not an endorsement, and its findings are hypotheses (RAID ASM-01). Decision **C10** requires a real advisory board to sign off every item marked `validated: false` (coefficients, screening wording, pain thresholds, food data, and more) before public launch. Gate 0 requires advisory-board agreements drafted.

The council is that board. It advises the Product Owner and signs off on content, but it does **not** run the product.

## 2. Mandate and limits

The council:

- **signs off** on specific items within each seat's competence (§5). A launch cannot proceed while any safety-relevant item is unsigned (M19);
- **reviews** each gate's evidence pack in its field and records a position: *approve*, *approve with conditions*, or *withhold*;
- **can stop** a release on a safety or legal ground by withholding sign-off. It can't be overruled on that; the item stays `validated: false`;
- **advises** on anything else, and the PO decides.

The council does not:

- write or approve code, prescriptions or copy directly. It reviews what the engine and content produce;
- act as a clinical service to users. Members never give individual medical, dietetic or legal advice through the product (RAID RSK-03);
- endorse the product publicly unless their agreement says so (§7, L12).

## 3. Seats

| Seat | Competence | Required credential (verify before seating) | Reviews | Replaces persona |
|---|---|---|---|---|
| **A1** | Sports & exercise medicine physician | Licensed physician; sports/exercise medicine experience | Screening wording and flags (S1), red-flag stop (S3), special populations (S7), M11 medical boundary | Dr. Amina K. |
| **A2** | Sports physiotherapist | Registered physiotherapist | Pain model and thresholds (S2), substitutions, joint-load profiles (M06) | Thomas R. |
| **A3** | Strength & conditioning coach | Recognised S&C certification (e.g. CSCS or national equivalent) | Progression rules, increments, load ceiling (S5), assessments, periodization, Fair Pair scaling | Karim B., Léa M. |
| **A4** | Registered sports dietitian | Registered/licensed dietitian | Energy and protein targets, nutrition floors (S4), disordered-eating guardrails, food data | Nadia S. |
| **A5** | Exercise physiologist | Postgraduate degree in exercise physiology or sport science | Relative-load coefficients, e1RM models, HR zones, WHO weekly minutes, evidence references | Dr. Julien P. |
| **A6** | Behavioural scientist | Doctorate or equivalent in behavioural science | Notifications, streaks, community mechanics, dark-pattern check (L4, L8) | Dr. Sofia L. |
| **B1** | Privacy & regulatory counsel | Admitted lawyer, data protection | DPIA, health-data consent (L9), filings, transfers, store privacy labels | Me. Hélène F. |
| **B2** | Consumer & product-liability counsel | Admitted lawyer | Terms, risk acknowledgment (L2), point-of-risk notices (L3), subscription terms (L8), coach agreement (L10) | Me. Paul A. |
| **B3** | IP & trademark counsel | Admitted lawyer / trademark attorney | Name clearance (L7), licences (L6), IP assignments | Me. Aïcha D. |
| **B4** | Medical-device regulatory specialist | Demonstrable EU MDR / FDA wellness experience | Wellness vs medical-device boundary for M05, M10, M11 copy and features (L1) | Dr. Nina W. |
| **C1** | Insurance broker *(non-voting)* | Licensed broker, tech & health lines | Product/professional liability, cyber, D&O | Victor L. |

B-seats cover the **primary jurisdiction**. Each additional launch market needs local counsel as a correspondent to B1/B2, per the jurisdiction matrix in `docs/specs/00-legal-framework.md`.

**User panel (not seats).** Phase 1 ends with an internal alpha "with the six personas". Recruit real volunteers who **match** each persona profile (P1–P6), under written consent, with no names or likenesses used publicly (L12). They give feedback; they sign nothing off.

## 4. Recruitment brief (activity G09, weeks 1–6)

1. Shortlist 2–3 candidates per seat. Priority order: **A1, A2, A3, A5** (all needed for Gate 1), then A4, B4 (Gate 2), then the rest.
2. Verify credentials against the issuing register and keep the evidence in the company file, not in git.
3. Run a conflict-of-interest declaration (§8).
4. Send the agreement (§7), reviewed by counsel (Meridian DOC "Advisory-board agreement").
5. On signature, rename the seat's Meridian person-row from "(open)" to the member's name (or "Seat A1" if name use is not agreed), and give them a Meridian account (§6).

Deadline that matters: **A1, A2, A3 and A5 seated and under agreement by week 12**, or the Gate 1 review slips (RAID DEP-02).

## 5. Sign-off: what is signed, by whom, and how it is recorded

### What needs a signature

Any config value, threshold, coefficient, text or dataset carrying `validated: false` (CLAUDE.md rule 4), plus the gate items below.

| Gate | Items to sign | Seats |
|---|---|---|
| Gate 0 | Advisory-board agreement template, counsel engagement | B2, B3 |
| Gate 1 — Safe MVP | Screening wording and flags; engine coefficients and increments; S5 load ceiling; pain model and thresholds; assessment protocols; periodization volume targets; exercise-library physio flags | A1, A2, A3, A5 |
| Gate 2 — Differentiation | M10 guardrails and energy/protein formulas; food data; M11 eval results and red-team set; wellness boundary of M05/M10/M11 | A4, A1, B4 |
| Gate 3 — Business | Pricing display, payment flows, cancellation parity, claims, consent texts | B2, B1 |
| Gate 4 — Launch | Every remaining `validated:false`; every legal text per launch jurisdiction; insurance bound | all seats, local counsel, C1 |

### How a sign-off is recorded

1. The module status file (`docs/status/Mxx.md`) lists the item, with the config path, the current value, its `source`, and why it's unvalidated.
2. The PO puts it into a **sign-off record** (`templates/council-sign-off-record.md`) under `docs/governance/sign-offs/`, one file per review, e.g. `2027-01-12-A2-pain-model.md`.
3. The seat member reviews it and returns a position: *approve*, *approve with conditions* (the new value or the condition), or *withhold* (with reasons). The member's own signed statement is the evidence. The PO transcribes it; the PO never paraphrases a position into an approval.
4. Only then does a PR change `validated: false` → `true`, and it must add `validatedBy: "<seat>"` and `signOff: "<record file>"` next to it. A reviewer rejects any PR that flips `validated` without both.
5. In Meridian, the record is attached as the `uri` of the gate's evidence document. For now the PO approves it there on the member's behalf and names the member in the comment, because Meridian can't yet give a reviewer approval rights without edit rights (Meridian issue [#16](https://github.com/mliad313sn/Meridian/issues/16)).

A **withheld** item stays `validated: false`. If it's safety-relevant, the gate doesn't clear. The PO's options are to change the item and resubmit it, or to remove the feature from the release.

## 6. Operating rhythm

| What | When | Who | Meridian |
|---|---|---|---|
| Council session | Monthly, Wednesday 16:00 UTC, 90 min | PO chairs, seats attend | Series *Expert Advisory Council — monthly session* |
| Gate review | Two weeks before each gate date | Seats listed for that gate | Activities G11–G14 |
| Async review packets | Any time; 10 working days to respond | Relevant seat | Document status *In review* |
| Urgent safety question | Within 48 h | A1 or A2 | RAID issue, escalated |

Each session ends with decisions and actions recorded in Meridian's minutes, so they land on the projects they concern. Members get a **viewer** account (read the book, gates and minutes; change nothing).

## 7. Agreement terms (outline for counsel)

Gate 0 lists "advisory-board agreements drafted". Counsel writes the text. It must cover:

- **Scope**: the seat's competence (§3) and the sign-off duties (§5); no duty of care to end users; no individual advice through the product.
- **Liability**: members review what the company produces; the company carries product liability and its insurance (C1). Counsel decides the indemnity and limitation wording under local law.
- **Compensation**: per session or per retainer, stated. No equity without separate advice.
- **Confidentiality** of the spec, the book and user research.
- **IP**: anything a member drafts for the product is assigned to the company.
- **Name and likeness**: separate, optional, revocable consent to be named publicly. Default is **not named** (L12).
- **Independence and conflicts**: declaration at signature and at each session (§8).
- **Term and exit**: 12 months, renewable; either side may end with notice; sign-offs already given stand, with a date.

## 8. Conflicts of interest

Members declare any commercial link with fitness, nutrition, wearable or insurance companies, and with any competitor. A conflicted member abstains on the affected item, and the abstention is minuted. The PO keeps the register, reviewed at each session.
