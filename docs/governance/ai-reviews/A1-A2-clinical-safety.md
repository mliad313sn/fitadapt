# AI pre-review: clinical safety, seats A1 and A2 (not a professional sign-off)

> **Who wrote this.** An AI reviewer (Claude, an AI model) wrote this file. It is **not** a licensed physician, sports and exercise medicine doctor or registered physiotherapist, and it holds the *subject* of seats A1 and A2, not their authority. Nothing here is validated, approved, signed off or clinically verified. Every item below stays `validated: false`. A qualified human in seat A1 or A2 has to confirm or reject each position through a sign-off record (docs/governance/03-expert-advisory-council.md §5).
>
> **Scope.** Screening and its restrictions (S1); red-flag stop and seek-care (S3); special populations (S7); pain traffic light and next-morning rule (S2); substitutions and joint-load profiles (M06); deload triggers (M05); the 55+ assessment protocol (M07); the strictest combination of concurrent screenings (FIX-latest-record-ordering); the `MEDICAL_REVIEW` copy (M05); emergency numbers per jurisdiction; the physiotherapist-referral rule. Some items are co-reviewed by A1 or A2 in M03, M08, M04 and M10. For those this file gives shorter notes.
>
> **Method and limits.** I read CLAUDE.md, 00-product-vision (S1–S7), 03-expert-advisory-council, the status files (M01, M02, M03, M05, M06, M07, M08, M10, FIX-latest-record-ordering) and the config and copy they point to: `packages/safety/src/screening.config.ts`, `packages/safety/src/session-safety.ts`, `packages/safety/src/screening-history.ts`, `packages/engine/src/recovery/config.ts`, `packages/shared/src/session.ts`, `packages/legal/src/jurisdictions.ts`, `packages/i18n/src/catalogues/{screening,recovery-medical,session,legal}.en.ts` and `packages/exercise-library/src/seed/exercises.ts`. **The network proxy blocked full-text fetching** (PubMed, PMC, JOSPT, NHS, Semantic Scholar and others returned EGRESS_BLOCKED). All external evidence therefore comes from **search-engine summaries of the named sources, not from reading the full texts**. For that reason I rated no source check as "verified" unless several independent summaries agreed. A human reviewer should open every URL cited here. I have not reproduced PAR-Q+ or any other questionnaire. The PAR-Q+ licence terms could not be found online (see M01-15).
>
> Written 2026-09-24 against branch `claude/vigilant-franklin-76iok4`. I changed no config, code, test, copy or status file.

---

## Summary

**Positions (58 items):** agree **12** · agree with conditions **33** · disagree **7** · insufficient evidence **6**.

### Changes I would make first (highest safety impact)

1. **Hold users with symptom-type screening flags until they are cleared** (`chest_discomfort`, `fainting_or_dizziness`, `unusual_breathlessness`), and also users with `advised_to_limit_activity`. Today they may train, and be assessed, at the S1 cap (RPE ≤ 7, RIR ≥ 3) before clearance. ACSM's 2015 algorithm (Riebe et al.) says anyone with signs or symptoms should stop exercising and get medical clearance before starting or resuming **any** exercise. Holding them is stricter than S1, so it does not weaken any invariant. (M01-02/03/04/07, M07-44, M08-55; answers M01 open question 2 and M07 open question 1.)
2. **Change the seek-care copy so it says when to call the emergency number now,** instead of leaving that judgement to the user ("If this is an emergency…"). Name the triggers: chest pain or pressure that spreads to the arm, jaw, neck or back, or that does not ease within a few minutes of rest; face drooping, arm weakness or slurred speech (NHS "FAST"); fainting. Tell the user not to drive themselves. (M05-19)
3. **Extend the S3 red-flag list:** add face drooping or speech difficulty, sudden severe headache, sudden loss or change of vision, and chest discomfort felt in the arm, jaw or neck. For users on the pregnancy path, also show the pregnancy warning signs (ACOG CO 804, Box 3: vaginal bleeding, fluid leakage, regular painful contractions, calf pain or swelling, reduced fetal movement, headache that rest does not relieve, dizziness). (M05-18, M01-09)
4. **Add urgent musculoskeletal signs that skip the traffic light and the 14-day physiotherapist path.** These are: unable to bear weight, a joint that swells fast or changes shape, a joint that locks or gives way, a hot swollen joint with fever, or back pain with numbness in the saddle area, new bladder or bowel changes, or leg weakness that gets worse. The app should then say "stop and get urgent care". It must not diagnose. (M05-31; NHS knee- and joint-pain pages; NICE NG59)
5. **Emergency numbers:** for France, show **15** (SAMU, medical emergencies) next to 112. For Senegal (15 / 1515) and Côte d'Ivoire (185), fill in the numbers once local counsel has confirmed them, instead of the generic line. In the same pass, **switch heart-rate zones to effort and the talk test** for users who answered `medication_affecting_effort` (AHA guidance on beta-blockers). (M05-22, M03-53)

### Items I consider potentially unsafe as they stand

- **Symptomatic users training before clearance at RPE ≤ 7**, and being assessed at RIR 3 before clearance (M01-02/03/04/07, M07-44). Low-to-moderate strength work is not maximal. Still, the published screening model sends symptomatic people to a clinician *before any exercise*.
- **The seek-care body** "Please contact a doctor before exercising again" (`legal.notice.seekCare.v1.body`). For chest pain or stroke signs this can read as permission to wait. The emergency line does appear with it, but only on a condition ("if this is an emergency") (M05-19).
- **No path for acute-injury or urgent MSK signs.** A pain score of 6 or more only swaps exercises. Nothing tells the user to seek urgent care for signs such as cauda-equina symptoms or a joint that cannot bear weight (M05-31).
- **No pregnancy-specific stop signs** for users on the S7 low-intensity library, who can still train (M01-09).

None of these weakens S1–S7 as written. Each is a gap *above* the invariants, and each fix proposed here is stricter.

### Sources I relied on most

- Riebe D et al. (2015), *Updating ACSM's recommendations for exercise preparticipation health screening*, Med Sci Sports Exerc 47(11):2473–2479. [PubMed 26473759](https://pubmed.ncbi.nlm.nih.gov/26473759/) · [ACSM/EIM summary PDF](https://www.exerciseismedicine.org/assets/page_documents/ACSM%20Preparticipation%20Screening%20Guidelines.pdf) · [NHANES application, CDC stacks](https://stacks.cdc.gov/view/cdc/85628)
- Silbernagel KG et al. (2007), pain-monitoring model in Achilles tendinopathy, Am J Sports Med 35(6):897–906. [SAGE abstract](https://journals.sagepub.com/doi/abs/10.1177/0363546506298279) · [PubMed 17307888](https://pubmed.ncbi.nlm.nih.gov/17307888/). Also Silbernagel & Crossley (2015), JOSPT, [doi 10.2519/jospt.2015.5885](https://www.jospt.org/doi/10.2519/jospt.2015.5885), and Malliaras et al. (2015), patellar tendinopathy load management, JOSPT, [doi 10.2519/jospt.2015.5987](https://www.jospt.org/doi/10.2519/jospt.2015.5987)
- ACOG Committee Opinion 804 (2020), exercise in pregnancy and postpartum. [ACOG page](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period) · [ACOG patient FAQ, postpartum](https://www.acog.org/womens-health/faqs/exercise-after-pregnancy). Also Mottola MF et al. (2018/2019), Canadian guideline for physical activity throughout pregnancy, BJSM/JOGC: [CSEP PDF](https://csepguidelines.ca/wp-content/uploads/2020/11/4208_CSEP_Pregnancy_Guidelines_En_HR.pdf)
- NHS: [heart-attack symptoms](https://www.nhs.uk/conditions/heart-attack/symptoms/), [knee pain](https://www.nhs.uk/symptoms/knee-pain/), [joint pain](https://www.nhs.uk/symptoms/joint-pain/), [exercise in pregnancy](https://www.nhs.uk/pregnancy/keeping-well/exercise/); NICE [NG59](https://www.nice.org.uk/guidance/ng59) (low back pain and sciatica)
- Thompson PD et al. (2007), AHA/ACSM statement *Exercise and acute cardiovascular events*, Circulation. [AHA journals](https://www.ahajournals.org/doi/abs/10.1161/circulationaha.107.181485); Pelliccia A et al. (2021), *2020 ESC Guidelines on sports cardiology*, Eur Heart J 42:17–96. [OUP](https://academic.oup.com/eurheartj/article/42/1/17/5898937)
- Jones CJ, Rikli RE, Beam WC (1999), 30-s chair stand, Res Q Exerc Sport 70(2):113–119. [PubMed 10380242](https://pubmed.ncbi.nlm.nih.gov/10380242/)

---

## How to read each entry

**Item** (config path, current value, current `source`) · **Source check** · **Evidence** · **AI position** · **Safety note** · **Confidence** · **Human still needed?**

"Search summary" means the claim comes from search-engine summaries of the source, not from its full text (see Method and limits above).

---

## M01: onboarding and health screening (S1, S4, S7)

Common source text for rules M01-01 to M01-08: *"M01 engineering default (conservative choice by the engineer); original question wording; no external source. Requires seat A1 review."* (`packages/safety/src/screening.config.ts`, `SCREENING_RULES` v0.1.0). The S1 caps (RPE 7, no HIIT, no maximal tests), the S7 age of 16 and the S4 age of 18 are constants.

### M01-01 `SCREENING_RULES.heart_or_blood_pressure`
- **Item:** S1 clearance flag. After clearance: avoid `breath_hold_bracing` and `inversion`. Wording: a professional has said the user has a heart or circulation problem, or raised blood pressure.
- **Source check:** no external source is claimed. The after-clearance tags are **partly** supported: ACSM guidance says to avoid breath-holding (Valsalva) during resistance training because it drives blood pressure up sharply ([ACSM, hypertension](https://acsm.org/exercise-for-the-prevention-and-treatment-of-hypertension/); search summary).
- **Evidence:** ACSM 2015 screens on three things: current activity level, known cardiovascular, metabolic or renal disease, and signs or symptoms ([Riebe 2015](https://pubmed.ncbi.nlm.nih.gov/26473759/)). It dropped risk-factor profiling, so raised blood pressure alone no longer triggers referral. Under that model, an active person with known disease and no symptoms may continue at moderate intensity and needs clearance only before vigorous work. An inactive person with known disease should be cleared before any exercise. The 2020 ESC guidelines support aerobic plus resistance training for people with well-controlled hypertension ([Pelliccia 2021](https://academic.oup.com/eurheartj/article/42/1/17/5898937)).
- **AI position:** **agree with conditions.** Keeping heart disease and raised blood pressure in one flag is conservative and acceptable for v1. Conditions: (a) add a separate question on current activity level (ACSM's first axis), because the right pre-clearance behaviour depends on it; (b) if the user is inactive and has known heart disease, hold until clearance (see M01-17); (c) keep the breath-hold tag after clearance for everyone in this group.
- **Safety note:** the error with the most harm is letting an inactive user with known cardiac disease train before clearance. The stricter direction is to hold.
- **Confidence:** medium. The structure of the ACSM algorithm is consistent across several summaries, but I could not read the full text.
- **Human still needed?** Yes, seat A1. Check first whether, after clearance, P4-type controlled hypertension should keep only `breath_hold_bracing`, or `inversion` too.

### M01-02 `SCREENING_RULES.chest_discomfort`
- **Item:** S1 flag; the user may train capped until clearance. After clearance: avoid `breath_hold_bracing`.
- **Source check:** no source is claimed. **Contradicted in part** by ACSM: chest, neck, jaw or arm discomfort that may be ischaemic is a listed sign or symptom, and anyone with signs or symptoms should stop exercising and get medical clearance before starting or resuming exercise ([EIM summary](https://www.exerciseismedicine.org/assets/page_documents/ACSM%20Preparticipation%20Screening%20Guidelines.pdf); search summary).
- **Evidence:** in ACSM's model, symptomatic people are referred whatever their activity level and whatever intensity they want. The AHA/ACSM 2007 statement notes that exercise-related cardiac events cluster in people with underlying structural or atherosclerotic disease and in the least active ([Thompson 2007](https://www.ahajournals.org/doi/abs/10.1161/circulationaha.107.181485)).
- **AI position:** **disagree** with training at the S1 cap before clearance. Instead: hold all training and assessments until clearance is attested, and show the seek-care guidance at the end of screening. I agree with the after-clearance tag. Also ask *where* the discomfort is felt: the wording only mentions the chest, while ACSM lists neck, jaw and arms too.
- **Safety note:** this is the highest-impact item in the domain. Holding is the safe direction. Holding is stricter than S1, so it does not weaken the invariant.
- **Confidence:** medium-high on the direction (several independent summaries agree); low on the exact wording.
- **Human still needed?** Yes, seat A1. Check first: hold completely, or allow only walking-level activity before clearance?

### M01-03 `SCREENING_RULES.fainting_or_dizziness`
- **Item:** S1 flag; capped training before clearance. After clearance: avoid `inversion` and `high_balance_demand`.
- **Source check:** ACSM lists dizziness or syncope as a sign or symptom (search summary). The pre-clearance behaviour is **contradicted** in the same way as M01-02.
- **Evidence:** as for M01-02.
- **AI position:** **disagree** with capped training before clearance; hold instead. I agree with the after-clearance tags, which make sense for fall risk.
- **Safety note:** exertional syncope is a classic warning sign in cardiology. Holding is the safe direction.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1. Check whether "felt so dizzy that you lost your balance" also catches vestibular causes, which do not need a cardiac hold. A1 may want two questions.

### M01-04 `SCREENING_RULES.unusual_breathlessness`
- **Item:** S1 flag; capped training before clearance; nothing after clearance.
- **Source check:** ACSM lists shortness of breath at rest or on mild exertion, and unusual fatigue or breathlessness with usual activities (search summary). The pre-clearance behaviour is **contradicted**, as in M01-02.
- **Evidence:** as for M01-02. Riebe 2015 no longer refers people automatically for pulmonary disease alone (search summary). Unexplained breathlessness still counts as a symptom.
- **AI position:** **disagree** with capped training before clearance; hold. The comparison "much sooner than people of your age" is a reasonable piece of original wording.
- **Safety note:** holding is the safe direction. A user with known, controlled asthma may answer yes. A1 may want to exclude known, controlled asthma explicitly to avoid needless holds.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1.

### M01-05 `SCREENING_RULES.ongoing_condition`
- **Item:** S1 flag: currently followed by a professional for a long-term condition, a recent illness or a recent operation.
- **Source check:** no source is claimed; **partly** in line with ACSM's "known metabolic or renal disease" axis.
- **Evidence:** ACSM names cardiovascular, metabolic (type 1 and type 2 diabetes) and renal disease. The current wording is broad enough to catch them, but a user with well-managed diabetes may not see themselves as "followed for" a condition.
- **AI position:** **agree with conditions.** Add an explicit, original-wording question on diabetes and kidney disease, or name them as examples. Add the activity-level question (M01-01). A recent operation should also say "until your surgeon or doctor says you can exercise".
- **Safety note:** under-detection is the risk; wider wording is the safe direction. For people with diabetes who use insulin, hypoglycaemia during exercise is a separate risk that the app does not handle.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1. Check first whether insulin-treated diabetes needs its own guidance (for example on hypoglycaemia symptoms).

### M01-06 `SCREENING_RULES.medication_affecting_effort`
- **Item:** S1 flag; nothing after clearance.
- **Source check:** no source is claimed. **Partly** supported: the AHA says beta-blockers blunt the heart-rate response, so heart-rate targets are unreliable and effort-based measures should be used instead ([AHA: beta-blockers and exercise](https://www.heart.org/en/health-topics/consumer-healthcare/medication-information/how-do-beta-blocker-drugs-affect-exercise); search summary). Research on RPE-based prescription in people taking beta-blockers points the same way (search summary).
- **Evidence:** as above.
- **AI position:** **agree with conditions.** Add an after-clearance effect: heart-rate zones switch to RPE and the talk test (M03 open question 4). The flag itself is reasonable.
- **Safety note:** heart-rate zones computed with Karvonen for a person on a beta-blocker can push them to exert harder than intended, chasing a heart rate they cannot reach. Effort-based zones are the safe direction.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seat A1 (with A5).

### M01-07 `SCREENING_RULES.advised_to_limit_activity`
- **Item:** S1 flag; capped training before clearance.
- **Source check:** no source is claimed.
- **Evidence:** by definition, a professional has already told this user to limit or avoid activity. Capped automatic training may go against that advice.
- **AI position:** **disagree** with capped training before clearance; hold until the user attests that the professional agrees they can exercise.
- **Safety note:** holding is the safe direction. Letting the app override a clinician's explicit advice also creates a defensibility risk (L2).
- **Confidence:** medium-high (this follows from what the question asks).
- **Human still needed?** Yes, seat A1 (and B2 for the L2 aspect).

### M01-08 `SCREENING_RULES.bone_joint_back`
- **Item:** a restriction, not a flag: impact ceiling `low`, avoid `jumping_landing`.
- **Source check:** no source is claimed. ACSM does not require medical clearance for musculoskeletal complaints. This is consistent with not making it a flag.
- **Evidence:** not specific.
- **AI position:** **agree with conditions.** Ask *which* joint and feed the answer into `limitedJoints`, so M05 starts that joint on amber (M01 open question 7). Today `limitedJoints` is not read by substitution. Keep low impact as the default.
- **Safety note:** without the joint, a user with a painful knee may get high-knee-load exercises. Pre-setting amber is the safe direction.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2 (with A1).

### M01-09 `SCREENING_RULES.pregnancy_or_recent_birth` (S7)
- **Item:** professional guidance; low-intensity library only; no automatic programming; no HIIT and no maximal tests; low impact; avoid jumping, supine, prone, breath-hold, inversion, loaded spinal flexion and high balance demand; not lifted by clearance. Source: S7 routing; the tag list is the engineer's choice.
- **Source check:** **partly.** ACOG CO 804 says that, without contraindications, exercise in pregnancy is safe and should be encouraged, that women should avoid long periods lying flat on their back, and that they should stop if warning signs appear ([ACOG CO 804](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period); search summary). The Canadian 2019 guideline says to change position only if lying on the back causes light-headedness, nausea or feeling unwell (weak recommendation) ([CSEP PDF](https://csepguidelines.ca/wp-content/uploads/2020/11/4208_CSEP_Pregnancy_Guidelines_En_HR.pdf); search summary).
- **Evidence:** the current mapping is **more restrictive** than both guidelines, which allow previously active women to continue vigorous activity. That fits an S7 v1 exclusion. ACOG and the NHS both list warning signs that should stop exercise, and the app does not show them ([NHS: exercise in pregnancy](https://www.nhs.uk/pregnancy/keeping-well/exercise/)).
- **AI position:** **agree with conditions.** Keep the mapping. Add the pregnancy warning signs as an S3-style stop list for users with `specialPopulation = pregnancy_postpartum`. Paraphrase ACOG Box 3 without copying it: vaginal bleeding; fluid leaking; regular painful contractions; chest pain; breathlessness before exertion; dizziness, feeling faint, or a headache that rest does not relieve; muscle weakness affecting balance; calf pain or swelling; the baby moving less. Route them to "contact your midwife or doctor now" or to the emergency number.
- **Safety note:** the missing stop signs are the gap. The exclusion itself errs on the safe side. Over-restriction costs benefit but does not cause acute harm.
- **Confidence:** medium-high on the stop list; medium on the tag details.
- **Human still needed?** Yes, seat A1. Check first the stop-sign list and the "contact now" routing. The copy also goes to counsel (L1).

### M01-10 `SCREENING_RULES.advised_against_calorie_restriction` (S4)
- **Item:** deficit features off; no training restriction. Source: S4 and the M01 rules.
- **Source check:** internal routing only; no external claim.
- **AI position:** **agree.** The routing is a direct reading of S4.
- **Safety note:** none for training.
- **Confidence:** high (logic only).
- **Human still needed?** Yes, seat A4 leads; A1 checks the question wording.

### M01-11 `SCREENING_CONFIG.rescreenIntervalMonths` = 12 months
- **Source:** M01 spec.
- **Source check:** **not found.** I could not find an official statement of the PAR-Q+ validity period in the searches. I recall that the PAR-Q+ form mentions 12 months, but I could not confirm it, so I do not rely on it.
- **Evidence:** ACSM does not give a fixed interval in the summaries I found. Common practice is to re-screen yearly and whenever health changes.
- **AI position:** **agree with conditions.** Keep 12 months, and add event-based re-screens: after any S3 red flag once the review has been attested, after the user reports a new pregnancy or a birth, and when the user edits their health answers (M01 open question 6). For users with flags, A1 may prefer 6 months.
- **Safety note:** a shorter interval is the safe direction.
- **Confidence:** low on the exact number; medium on the event triggers.
- **Human still needed?** Yes, seat A1.

### M01-12 `SCREENING_CONFIG.symptomLookbackMonths` = 12 months
- **Source:** engineering default.
- **Source check:** no source; not found.
- **Evidence:** a longer look-back makes the questions more sensitive but less specific.
- **AI position:** **agree.** Twelve months is a sensitive (stricter) choice.
- **Safety note:** longer is safer.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1.

### M01-13 `SCREENING_CONFIG.postpartumWindowMonths` = 12 months
- **Source:** engineering default.
- **Source check:** no source. For comparison: ACOG says women may resume exercise gradually once medically safe, which can be within days of an uncomplicated vaginal birth ([ACOG FAQ](https://www.acog.org/womens-health/faqs/exercise-after-pregnancy); search summary). The 2019 UK postnatal return-to-running guidance (Goom, Donnelly, Brockwell) advises at least 12 weeks before running, after a pelvic-health assessment ([CSP news](https://www.csp.org.uk/news/2019-04-06-physios-develop-first-guidelines-postnatal-running); search summary).
- **Evidence:** twelve months of exclusion from automatic programming is longer than any guideline I found. It is conservative.
- **AI position:** **agree with conditions.** Keep it for v1 as the S7 routing. Record in the status file that it is a product-conservatism choice, not an evidence value. Signpost pelvic-floor and pelvic-health assessment in the professional-guidance copy.
- **Safety note:** too short a window is the harmful direction (high impact before pelvic-floor recovery). Twelve months errs on the safe side.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1 (and A2 for pelvic health).

### M01-14 `SCREENING_CONFIG.specialPopulationMaxRPE` = 5
- **Source:** engineering default.
- **Source check:** no source. The pregnancy guidelines recommend moderate intensity, checked with the talk test. ACSM's summaries map moderate to Borg 12–13 on the 6–20 scale.
- **Evidence:** "RPE 5" means different things on different scales. On the RIR-based resistance scale (Zourdos) it is about 5 reps in reserve, which is light. On the Borg CR10 scale, 5 is described as "hard". The app uses RPE 0–10 for both strength and cardio.
- **AI position:** **agree with conditions.** Keep 5 for strength work (RIR-based). For cardio in this population, cap at the moderate zone and state the talk test explicitly. Record in the config which scale each cap uses.
- **Safety note:** reading the scale the wrong way could allow "hard" cardio. The talk test is the safe anchor.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1 (with A5 on scales).

### M01-15 Question set, wording and licensed instrument (document: `packages/i18n/src/catalogues/screening.{en,fr}.ts`)
- **Item:** ten original questions; "licence check pending".
- **Source check:** the PAR-Q+ is published by the PAR-Q+ Collaboration (Warburton et al., [Health & Fitness Journal of Canada 2011;4(2)](https://hfjc.library.ubc.ca/index.php/HFJC/article/view/103)). **I could not find its licence terms online**, so the licence question is still open for B3. I have not copied any PAR-Q+ item.
- **Evidence:** compared with ACSM's list of signs and symptoms (paraphrased), the set does **not** ask about: ankle swelling; breathlessness when lying flat or at night; palpitations or a racing heartbeat at rest; calf pain when walking that eases with rest (claudication); a known heart murmur; diabetes or kidney disease by name; current activity level. The wording avoids diagnosis ("has a professional told you…"), which I agree with. "Answer yes if unsure" is conservative.
- **AI position:** **agree with conditions.** Add original-wording items for the gaps above, and the activity-level question. Keep the no-diagnosis framing.
- **Safety note:** missing symptoms mean missed referrals. Adding them is the safe direction, at the cost of more referrals.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1 (and B3 on whether to license PAR-Q+).

### M01-16 Self-attested clearance lifts S1 (document; M01 open question 1)
- **Item:** a toggle: "A health professional has cleared me to exercise."
- **Source check:** not applicable. ACSM defines medical clearance as a healthcare professional's approval to exercise and leaves the form open.
- **Evidence:** consumer apps cannot verify clearance. The main risk is a user ticking the box without having been seen.
- **AI position:** **agree with conditions.** Keep self-attestation, but: (a) list the specific answers the clearance covers; (b) make it a separate confirmation screen, not a toggle beside "See my result"; (c) keep the after-clearance restrictions (M01-01 to M01-03).
- **Safety note:** friction and specificity reduce casual attestation.
- **Confidence:** low to medium (a design judgement).
- **Human still needed?** Yes, seat A1, with B2 for L2.

### M01-17 Access at the capped intensity before clearance (document; M01 open question 2; M08 S1 behaviour)
- **Item:** users with a "consult a professional" result reach the first workout at the S1 caps.
- **AI position:** **agree with conditions.** Split by kind of flag. Symptom-type flags and `advised_to_limit_activity` should be held (M01-02/03/04/07). Known conditions without symptoms (`heart_or_blood_pressure`, `ongoing_condition`, `medication_affecting_effort`) may continue at the caps only if the user reports being regularly active (ACSM's "active, known disease, no symptoms" branch). Otherwise, hold them too.
- **Safety note:** see the summary.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1 and the PO.

### M01-18 Low-intensity library definition (`allowedBySafetyProfile`: impact none or low, skill entry or beginner, no conditioning tag)
- **Source check:** engineering definition; no external source.
- **AI position:** **agree with conditions.** For pregnancy, the `avoidTags` of M01-09 must also apply (they do today, through the profile). Add a gentle balance subset for 55+ that carries `supported` variants.
- **Safety note:** the definition is conservative.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A1 and A2.

### M01-19 S7 minimum age of 16 (constant)
- **Source check:** WHO 2020 recommends that young people aged 5–17 do an average of 60 minutes a day of moderate-to-vigorous activity and strengthening work on 3 days a week ([WHO 2020 summary](https://www.ncbi.nlm.nih.gov/books/NBK566048/); search summary). The 2014 International Consensus supports supervised youth resistance training ([Lloyd et al., BJSM 2014](https://pubmed.ncbi.nlm.nih.gov/24055781/)).
- **AI position:** **agree.** Excluding under-16s from *unsupervised automatic* programming is a product-safety and legal choice, not a claim that training is harmful to them. The copy must not suggest that it is harmful.
- **Confidence:** high on the direction.
- **Human still needed?** Yes, seat A1 (and B1 for age rules by market).

---

## FIX-latest-record-ordering: concurrent records

### FIX-47 Strictest combination of concurrent screenings (`strictestSafetyProfile`, `packages/safety/src/screening-history.ts`)
- **Item:** when there are several heads, take the minimum `maxRPE`; HIIT and maximal tests only if all heads allow them; the lowest impact; the union of `avoidTags`, `unresolvedFlags` and `limitedJoints`; special population if any head has it; reason `safety_profile.ambiguous_latest`.
- **Source check:** not applicable (logic).
- **Evidence:** a field-by-field minimum can never be looser than any single screening. The status file notes that the result may be a profile that no single screening produced. It is still at least as strict as every screening.
- **AI position:** **agree with conditions.** (a) When ambiguity is detected, prompt the user to re-screen now, not only at the next scheduled screening. (b) A clearance attested in only one head must not lift a flag raised in another. The union of `unresolvedFlags` does this today; keep it covered by tests. (c) The reason copy should tell the user how to resolve the ambiguity.
- **Safety note:** the rule fails safe.
- **Confidence:** high.
- **Human still needed?** Yes, seat A1.

### FIX-48 Concurrent assessments: the most conservative starting point (row 16)
- **AI position:** **agree.** The more conservative capacity leads to lower loads, and S5 bounds progression anyway.
- **Confidence:** high.
- **Human still needed?** Yes, seat A1 (A3 for the capacity logic).

---

## M02 and M05: red-flag stop, seek-care, emergency guidance (S3)

### M05-18 `RED_FLAG_SYMPTOMS` (`packages/shared/src/session.ts`): chest pain or pressure; fainting or feeling about to faint; much more breathless than the effort explains; a racing or irregular heartbeat; sudden numbness or weakness
- **Source:** S3 in the vision document.
- **Source check:** **partly.** Each item matches ACSM's list of signs and symptoms (search summary). ACSM also lists discomfort in the neck, jaw or arm, and unusual fatigue. The NHS names face drooping, arm weakness and speech problems as stroke signs that need a 999 call (FAST; [NHS search summary](https://www.nhs.uk/conditions/heart-attack/symptoms/)).
- **Evidence:** the list catches the main cardiac warnings but only part of the stroke signs: "sudden numbness or weakness" covers the arm but not facial droop or speech difficulty. It also misses a sudden severe headache (a warning sign for a bleed in the brain) and sudden changes in vision.
- **AI position:** **agree with conditions.** Add: "face drooping, or trouble speaking or understanding"; "sudden severe headache"; "sudden loss or change of vision"; and "pain or pressure in the chest, arm, jaw or neck" (widening the existing chest item). S3 is a list to be enforced, not a set of numbers, so widening it is stricter. Also add the pregnancy list for S7 users (M01-09).
- **Safety note:** a missing sign means the user continues training during a possible stroke. Widening the list is the safe direction.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seat A1. Check first the stroke and headache wording in FR and EN.

### M05-19 Seek-care copy (`legal.notice.seekCare.v1.body`, `workout.redFlag.body`, `legal.emergency.*`)
- **Item:** "You reported a symptom that needs medical attention. The session has ended. Please contact a doctor before exercising again." Followed by: "If this is an emergency, call {number} now."
- **Source check:** **contradicted** in its emphasis by NHS guidance. The NHS tells people to call 999 at once for chest pain that spreads to the arm, jaw, neck or back, or for any stroke sign ([NHS heart attack](https://www.nhs.uk/conditions/heart-attack/symptoms/); FAST; search summaries).
- **Evidence:** as above. The user cannot be expected to judge what counts as "an emergency".
- **AI position:** **disagree** with the current body. Put concrete, non-diagnostic triggers **before** the generic line, in guidance language. Suggested meaning (in my own words, for counsel and A1 to rework): *"Call {number} now if the chest pain or pressure has not eased after a few minutes of rest or spreads to your arm, jaw, neck or back; if your face droops, an arm is weak or your speech is slurred; or if you fainted. Do not drive yourself. Otherwise, stop exercising and contact a doctor today."* Keep the emergency line visible without scrolling, with a large touch target.
- **Safety note:** delay in calling for help is the main harm. Being explicit is the safe direction. None of this wording diagnoses.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seat A1 and counsel (B2, and B4 for the wellness boundary).

### M05-20 S3 attestation and waiting time (`recovery.s3.attest.statement`; M05 open question 1)
- **Item:** self-attestation that a doctor or another qualified professional has checked the user and agrees they can exercise again. No minimum wait.
- **Source check:** no guideline found on consumer-app attestation.
- **AI position:** **insufficient evidence** for a specific waiting time. Suggestions for A1: the attestation should not count if it is made in the same session or on the same calendar day as the red flag; name the symptom being attested; add an event-based re-screen (M01-11).
- **Safety note:** an attestation made straight away is the risk. A delay is the safer direction.
- **Confidence:** low.
- **Human still needed?** Yes, seat A1 and counsel.

### M05-21 Red-flag deload: `RECOVERY_CONFIG['deload.triggeredDays']` = 7 days (ENG); trigger `red_flag`
- **Item:** after attestation, sessions start again at deload volume (factor 0.5) for 7 days.
- **Source check:** no source; I did not find a guideline value.
- **Evidence:** ACOG's postpartum guidance and cardiac-rehabilitation practice (both general) favour a gradual return. The clinician's own advice should take precedence.
- **AI position:** **agree with conditions.** Keep 7 days as the floor. Tell the user that, if their clinician gave specific limits, those come first. Never let a triggered deload be declined after a red flag (M05 open question 2 concerns only other triggers).
- **Safety note:** a longer or gentler return is the safe direction.
- **Confidence:** low on the number; medium on the principle.
- **Human still needed?** Yes, seat A1 (A3 for volume).

### M05-22 Emergency numbers (`packages/legal/src/jurisdictions.ts`): FR 112, GB 999, US 911, SN null, CI null, unknown generic; each "unverified"
- **Source check:** FR 112: **verified** as working in France. French sources also note that **15** reaches the SAMU directly for medical emergencies, and that 112 does not replace 15, 17 and 18 ([FFTélécoms](https://www.fftelecoms.org/actualites/numeros-urgence-a-connaitre-appel-112-15-17-18/); [Ministère de l'Intérieur](https://www.masecurite.interieur.gouv.fr/fr/fiches-pratiques/famille-et-aides-aux-victimes/numeros-utiles-nationaux); search summaries). GB 999: consistent with NHS guidance (112 also works in the UK). US 911: consistent. SN: secondary sources give SAMU **15 / 1515**, fire service 18 and police 17 ([Ministère de la Santé SN page](https://www.sante.gouv.sn/Pr%C3%A9sentation/la-d%C3%A9couverte-du-samu-national); [French embassy in Senegal](https://sn.diplomatie.gouv.fr/en-cas-durgence); search summary). CI: secondary sources give SAMU **185**, fire service 180 and police 170 ([Wikipedia list](https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers); search summary). SN and CI are **not** verified from an official gazette.
- **AI position:** **agree with conditions.** FR: display "15 (SAMU) or 112". SN and CI: fill in once local counsel confirms (today the generic line is used, which is the correct fallback). Keep "unverified" until counsel signs.
- **Safety note:** a wrong number is worse than the generic line. Keep the generic fallback until each number is confirmed.
- **Confidence:** high for FR, GB and US; low for SN and CI.
- **Human still needed?** Yes: local counsel, B2, and seat A1 for the medical routing (15 or 112 in France).

---

## M05: pain-monitoring model (S2), physiotherapist rule, deloads, mobility

### M05-23 `PAIN_CONFIG.amberPainScore` = 4 (green ≤ 3, amber 4–5, red ≥ 6)
- **Source:** M05 spec; "pain-monitoring model after Silbernagel et al. 2007 …, not checked".
- **Source check:** **partly verified.** Search summaries of Silbernagel 2007 ([SAGE](https://journals.sagepub.com/doi/abs/10.1177/0363546506298279)) and of later JOSPT papers agree that the model allows pain up to about 5/10 during and after loading, provided it returns to baseline by the next morning and does not rise from week to week. Malliaras et al. 2015 use the same ≤ 5/10 limit for patellar tendinopathy ([JOSPT](https://www.jospt.org/doi/10.2519/jospt.2015.5987); search summary). I have read secondary descriptions of a 0–2 "safe", 2–5 "acceptable", 5–10 "high risk" banding, but could not confirm it from the primary text. In the 2007 RCT, continuing activity under the model did not worsen outcomes (search summary).
- **Evidence:** red at ≥ 6 matches the model's upper limit of 5. The model was tested in **tendinopathy** under physiotherapist supervision. Using it for every joint and for pain of unknown cause is an extrapolation. Smith et al. 2017 found that exercise allowed to be painful did no worse in the short term in chronic MSK pain ([BJSM 2017](https://pubmed.ncbi.nlm.nih.gov/28596288/); search summary), which supports tolerating amber.
- **AI position:** **agree with conditions.** Keep 4–5 as amber (training continues, joint load is steered down). A2 should decide whether 3 belongs to amber (the stricter reading of a "0–2 safe" band). Add the model's week-to-week rule: amber scores that rise across weeks should count toward the deload trigger (M05-30). Add the acute-injury exclusion (M05-31).
- **Safety note:** too high an amber cut-off only reduces steering, because red at ≥ 6 is hard-gated. Low harm. The larger risk is applying the model to acute injuries (M05-31).
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2. Check first the band boundaries against the full texts of Silbernagel 2007 and Silbernagel & Crossley 2015.

### M05-24 `S2_RED_PAIN_SCORE` = 6 (constant, S2)
- **AI position:** **agree.** It is consistent with the "≤ 5 acceptable" limit (M05-23). This is a comment only: the value is an invariant.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2.

### M05-25 Next-morning rule ("Is it back to how it usually is?"; not settled → red; M05 open question 4)
- **Source check:** **partly.** The model's criterion is that pain returns to its pre-activity level by the next morning (search summaries).
- **AI position:** **agree with conditions.** Keep the question. Also record the joint's score before the session, or the last green score, and treat a morning score **above** that baseline as "not settled", even if the user answers "yes". That brings the rule closer to the model and is stricter. A skipped morning check should not count as settled. Today a skip leaves the joint at its last colour, which is acceptable.
- **Safety note:** comparing with the baseline is the stricter direction.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2.

### M05-26 Clearing red only through a report in a later session, never through a next-morning check (`painTrafficLight`)
- **AI position:** **agree.** A joint must show it tolerates load in a new session before it leaves red. The fail-closed handling of clocks and causal order is sound. On M05 open question 5: a report made outside any session should not clear a red set inside a session. Keep it that way.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seat A2.

### M05-27 `PAIN_CONFIG.persistenceDays` = 14 (amber or red for more than two weeks → suggest a physiotherapist)
- **Source:** M05 spec.
- **Source check:** **partly verified.** NHS joint-pain guidance says to see a GP if pain has not improved after about 2 weeks of self-care, and the knee-pain page says the same with "a few weeks" (search summaries: [NHS joint pain](https://www.nhs.uk/symptoms/joint-pain/), [NHS knee pain](https://www.nhs.uk/symptoms/knee-pain/)).
- **AI position:** **agree with conditions.** Fourteen days matches public NHS guidance. Conditions: (a) red for more than 14 days should also suggest a doctor, not only a physiotherapist; (b) add the immediate triggers in M05-31, which must not wait 14 days.
- **Safety note:** shorter is safer. Fourteen days is acceptable for non-urgent pain.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2.

### M05-28 Physiotherapist copy (`recovery.physio.*`)
- **Item:** "…Consider seeing a physiotherapist, who can look at it with you. This app offers general guidance only and cannot tell what is causing it."
- **Evidence:** the wording is non-diagnostic, which I agree with. How patients reach a physiotherapist varies by country. In France, masseur-kinésithérapeutes are usually reached through a doctor's prescription, and direct access is limited (recent reforms allow it in some settings; I have not verified the details).
- **AI position:** **agree with conditions.** Say "a physiotherapist or your doctor" and give the local term in the FR catalogue (kinésithérapeute). Check direct-access rules for each market.
- **Confidence:** medium on the wording; low on the French legal detail.
- **Human still needed?** Yes, seat A2 and counsel (regulated professions, legal framework row "Regulated professions").

### M05-29 Amber tips (`engine.reason.session.amber.*`: neutral grip or shorter range for upper joints; a comfortable, shallower range for the others; "stop this exercise if the pain rises")
- **AI position:** **agree with conditions.** These are standard load-modification cues, consistent with load management in tendinopathy (Malliaras 2015; Cook & Purdam's continuum model, [PubMed 18812414](https://pubmed.ncbi.nlm.nih.gov/18812414/)). Change "if the pain rises" to a threshold the user can act on: "if it goes above 5 out of 10 or keeps rising", in line with the model.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2.

### M05-30 `RECOVERY_CONFIG['deload.amberWeeksMinGapDays']` = 7, `['deload.amberWeeksMaxGapDays']` = 14 ("two amber weeks")
- **Source check:** internal spec; not found externally. The model's "no rise from week to week" rule is the closest evidence (M05-23).
- **AI position:** **agree with conditions.** Also trigger when amber scores rise from one week to the next, even within 7 days. Count red in the same way (the code already does).
- **Safety note:** an earlier trigger is safer.
- **Confidence:** low to medium.
- **Human still needed?** Yes, seats A2 and A3.

### M05-31 Gap: acute injury and urgent MSK signs (no config exists)
- **Item:** today a severe pain report only changes the colour of the joint.
- **Source check:** the NHS lists signs that need urgent care or A&E: very painful knee; unable to move the joint or bear weight; badly swollen or misshapen; locking or giving way; high temperature with a hot, red joint ([NHS knee pain](https://www.nhs.uk/symptoms/knee-pain/); [NHS joint pain](https://www.nhs.uk/symptoms/joint-pain/); search summaries). NICE NG59 asks every clinician to check for cauda-equina signs: difficulty passing urine or loss of sensation when doing so, faecal incontinence, numbness in the saddle area. Severe or worsening leg weakness is another warning sign ([NICE NG59](https://www.nice.org.uk/guidance/ng59); search summary). For soft-tissue injuries, PEACE & LOVE (Dubois & Esculier 2020, [BJSM](https://pubmed.ncbi.nlm.nih.gov/31377722/)) supports protecting the tissue first and then loading it progressively.
- **AI position:** **disagree** with the current state (the path is missing). Add a short "Does any of these apply?" step when pain is ≥ 6, or when pain comes on suddenly during a session. Items: a pop or sudden sharp pain with swelling; unable to put weight on it or use it; changed shape; locks or gives way; hot, red and swollen with fever; for the lower back, numbness around the genitals or buttocks, new bladder or bowel changes, or leg weakness that gets worse. Any yes → stop the session and seek urgent care (show the emergency line for the back signs). No diagnosis is named.
- **Safety note:** a missed cauda equina or septic joint causes serious, lasting harm. This is a stricter addition.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seats A2 and A1, and counsel for the copy.

### M05-32 `RECOVERY_CONFIG['mobility.*']`: hold 20 s, 2 sets, 30 s rest, target RIR 4 (ENG; P4 and 55+ sessions)
- **Source check:** **partly contradicted** for older adults. Search summaries of ACSM's 2011 position stand (Garber et al., [PubMed 21694556](https://pubmed.ncbi.nlm.nih.gov/21694556/)) give 10–30 s holds for most adults, **30–60 s for older adults**, 2–4 repetitions, and about 60 s in total per stretch.
- **AI position:** **agree with conditions.** For 55+, set the hold to 30 s and keep 2 sets (60 s in total). Keep RIR 4 and 30 s rest. Balance work should use `supported` variants first (Sherrington 2019 Cochrane review: balance and functional exercise reduces falls; [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD012424.pub2/full)).
- **Safety note:** the hold time affects benefit more than safety. The fall risk in balance drills matters more: supported variants first.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A3, A2 and A1 (older adults).

### M05-33 `MEDICAL_REVIEW` catalogue as a whole (`packages/i18n/src/catalogues/recovery-medical.{en,fr}.ts`)
- **AI position:** **agree with conditions.** The tone is non-diagnostic, guilt-free and makes no claims. I agree with it. Apply M05-19 (seek-care), M05-28 (physiotherapist or doctor), M05-29 (amber threshold) and M05-31 (urgent signs). The red-flag check-in ("If you have any of these, do not train today") is good. On M05 open question 6: yes, also make the stop list available from Home, not only on the readiness card.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A1 and A2, counsel, and a native FR editor.

---

## M02: selection and in-session pain

### M02-34 `SESSION_CONFIG.selection.amberHighPenalty` = 1, `amberMediumPenalty` = 0.5 (ENG)
- **Source check:** no source; none exists for weights of this kind.
- **AI position:** **insufficient evidence.** These are heuristic weights. What matters clinically is the outcome: with a joint on amber, does the selection prefer low-load options in the sample reports? A2 should judge that from generated sessions, not from the numbers.
- **Safety note:** low. Red is hard-gated by S2.
- **Confidence:** low.
- **Human still needed?** Yes, seat A2.

### M02-35 In-session pain ≥ 6 → swap or drop the rest of the session for that joint (`packages/engine/src/session/execution.ts`)
- **AI position:** **agree.** It matches the model's ≤ 5 limit. Add the M05-31 prompt at that moment.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A2.

---

## M06: substitutions and joint-load profiles

### M06-36 Joint-load profiles (`j` codes, 152 exercises; "author classification, no external source")
- **Source check:** no source. A physiotherapist has to classify these; there is no public dataset of joint loads by exercise at this level of detail.
- **Evidence (a spot check of about 25 entries, not a full review):** most looked plausible. Examples: `air_squat` knee M; `pistol_squat` knee H and ankle H; `nordic_curl_eccentric` knee H; `kettlebell_swing` lumbar H and hip H; `bench_dip` shoulder H with `end_range_shoulder`; `single_leg_calf_raise` ankle H; `glute_bridge` lumbar L. Worth a second look: `wall_sit` has knee **M**. A deep wall sit loads the patellofemoral joint heavily, so for a knee on red it may deserve H, or a cue to limit depth. `leg_press` has lumbar M, which is reasonable because the pelvis can tuck at depth.
- **AI position:** **agree with conditions.** The structure is sound (seven joints at three levels). Each entry needs A2's review, `wall_sit` first.
- **Safety note:** a joint load classed too low lets a red joint through S2. Rounding up (M → H) is the safe direction.
- **Confidence:** low to medium (spot check only).
- **Human still needed?** Yes, seat A2, on the whole seed.

### M06-37 Mapping screening outcomes to `avoidTags` (A1)
- **AI position:** **agree with conditions.** Cardiac or blood-pressure flags → `breath_hold_bracing` (supported by ACSM on avoiding Valsalva). Fainting → `inversion` and `high_balance_demand`. Pregnancy → the tags of M01-09. For P4-type controlled hypertension after clearance, also consider `overhead_loading` with heavy loads. This is my suggestion; I found no source for it.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1.

### M06-38 `SUBSTITUTION_CONFIG.amberJointPenalty` = 0.1 per amber joint loaded at medium or high (ENG)
- **AI position:** **insufficient evidence.** With `minSimilarity` at 0.5, a penalty of 0.1 is small: an amber-loading option with better similarity can still win. That fits the model's "training with acceptable pain" idea. A2 should decide from samples.
- **Safety note:** low (red is hard-gated).
- **Confidence:** low.
- **Human still needed?** Yes, seat A2.

### M06-39 SUBSTITUTES edges (1,972; similarity ≥ 0.5) and `SIMILARITY_CONFIG`
- **AI position:** **insufficient evidence** on the weights (A3). For joint safety: S2 filters on joint load *after* similarity, so an edge does not bypass the pain gate. A2 should check sample swaps for red knee, lumbar and shoulder.
- **Confidence:** low.
- **Human still needed?** Yes, seats A2 and A3.

### M06-40 Impact levels (`imp`)
- **Evidence (spot check):** `squat_jump`, `jumping_jack`, `burpee` and `easy_run` are high; `mountain_climber` and `kettlebell_swing` are low. These are plausible. `brisk_walk` is low.
- **AI position:** **agree with conditions.** Needs full review. For BMI ≥ 35 and knee flags, the `low` default is conservative (see M03-51).
- **Confidence:** medium.
- **Human still needed?** Yes, seats A2 and A3.

---

## M07: assessment, 55+ protocol

### M07-41 `ASSESSMENT_CONFIG.olderAdultProtocolAge` = 55
- **Source:** M07 spec ("Jones et al., 1999, for 55+").
- **Source check:** **partly.** Jones, Rikli and Beam 1999 validated the test in community-dwelling adults **over 60** (mean age 70.5, n = 76), and the related norms cover ages 60–94 ([PubMed 10380242](https://pubmed.ncbi.nlm.nih.gov/10380242/); search summary). "55+" is therefore an extrapolation by the spec.
- **AI position:** **agree.** Offering the gentler protocol from 55 is conservative. Change the `source` text: the paper's population was 60+, and 55 is a product choice.
- **Confidence:** medium-high.
- **Human still needed?** Yes, seat A1 (with A3).

### M07-42 `ASSESSMENT_CONFIG.chairStandWindowSeconds` = 30
- **Source check:** **consistent** with the title and design of the paper (30-s test; search summary).
- **AI position:** **agree.**
- **Confidence:** high.
- **Human still needed?** Yes, seat A1 (A5 for the citation).

### M07-43 `chair_stand.stayMin` = 8, `promoteAt` = 14 (ENG; not a Jones norm, because the test stops with reps in reserve)
- **AI position:** **insufficient evidence.** The status file correctly says these are not norms. A3 decides. From a safety angle: the stopping reserve (RIR 2) and a chair against the wall are what matter.
- **Confidence:** low.
- **Human still needed?** Yes, seat A3 (with A1).

### M07-44 Users with an unresolved flag are assessed at RIR 3 before clearance (M07 open question 1)
- **AI position:** **disagree** for symptom-type flags and `advised_to_limit_activity`: no assessment before clearance (ACSM, as in M01-02). Default them to the lowest rungs. For flags about known conditions without symptoms, follow M01-17.
- **Safety note:** holding is the safe direction. A test to near-failure is more strenuous than a normal set.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1 and the PO.

### M07-45 `rpeAtZeroRir` = 10 also positions the S1 reserve (M07 open question 5)
- **AI position:** **agree with conditions.** Tie it to S1 as a constant, or add a test that the S1 reserve can never fall below RIR 3 whatever this coefficient is. Otherwise a change to an A5 coefficient could silently loosen S1.
- **Confidence:** medium-high (a logic point).
- **Human still needed?** Yes, seats A1 and A5.

### M07-46 The 55+ protocol: recommended but optional (M07 open question 2)
- **Source check:** the CDC STEADI three key questions (fallen in the past year? unsteady when standing or walking? worried about falling?) are a public screening aid for adults aged 65 and over ([CDC STEADI algorithm](https://www.cdc.gov/steadi/media/pdfs/STEADI-Algorithm-508.pdf); search summary).
- **AI position:** **agree with conditions.** Keep it optional from 55. Make it the default, and **required**, for anyone who answers yes to an original-wording version of the three STEADI themes (any age 55+). Route those users to supported balance variants.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A1 and A3.

---

## M03 and M08: co-reviewed items (A1 or A2 as second seat)

### M03-49 Heart-rate reserve zones: light 0.30–0.39, moderate 0.40–0.59, vigorous 0.60–0.84 (ENG)
- **Source check:** **partly.** ACSM's 2011 position stand (search summaries) describes moderate as 40–59 % HRR and vigorous as 60–89 % HRR. Capping vigorous at 84 % is more conservative.
- **AI position:** **agree** (A5 leads). For older adults and users on medication, see M03-53.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A5 and A1.

### M03-50 HIIT gate: `hiit.consistentWeeks` = 2, `hiit.minSessionsPerWeek` = 2
- **AI position:** **agree with conditions.** On top of S1 (no HIIT with an unresolved flag), for users with known heart disease, cleared or not, HIIT should require the clearance statement to cover vigorous exercise (ACSM: clearance before vigorous exercise for people with known disease).
- **Confidence:** medium.
- **Human still needed?** Yes, seats A3 and A1.

### M03-51 `impact.lowDefaultBmi` = 35 (spec)
- **Source check:** not found. No guideline gives a BMI cut-off for impact.
- **AI position:** **agree with conditions.** It is conservative. The copy must not refer to weight in a way that shames anyone (rule 8). Offer impact as a choice, with low impact as the default.
- **Confidence:** low on the number; high that the direction is safe.
- **Human still needed?** Yes, seats A2 and A1.

### M03-52 `who.weeklyModerateMin` / `Max` = 150 / 300 min
- **Source check:** **verified** (the adult targets in the WHO 2020 guideline are consistent across the WHO executive summary and search summaries; [WHO IRIS](https://iris.who.int/server/api/core/bitstreams/faa83413-d89e-4be9-bb01-b24671aef7ca/content)).
- **AI position:** **agree.**
- **Confidence:** high.
- **Human still needed?** Yes, seat A5 (and A1).

### M03-53 Medication affecting heart rate → effort-based zones (M03 open question 4)
- **AI position:** **agree** with the proposal: when `medication_affecting_effort` is yes, use RPE and the talk test only (see M01-06; AHA).
- **Confidence:** medium-high.
- **Human still needed?** Yes, seats A1 and A5.

### M08-54 `rpe.minimum` = 5, `session.balanceSets` = 2, `volume.position.general_health` = 0 (older adults)
- **Source check:** WHO 2020 recommends that older adults do varied multicomponent activity with an emphasis on functional balance and strength, on 3 or more days a week (search summary). Sherrington 2019 supports balance and functional exercise for fall prevention.
- **AI position:** **agree with conditions.** For P4-type users, give balance work on at least 3 days a week, even if that means only 2 sets per session. A separate health template with more balance and fewer hard sets (M08 open question 6) is reasonable. `rpe.minimum` = 5 is acceptable.
- **Confidence:** medium.
- **Human still needed?** Yes, seats A3 and A1.

### M08-55 S1 behaviour of programs (effort ceiling 7; steady cardio only while a flag is unresolved)
- **AI position:** **agree with conditions**, subject to the hold for symptom-type flags (M01-17). M03's steady cardio is moderate (RPE 4–6), and vigorous work is S1-gated upstream (`packages/engine/src/cardio/plan.ts`). That part is sound.
- **Confidence:** medium.
- **Human still needed?** Yes, seat A1.

### M04/M10-56 Sustained-loss guardrails (1 %/week for 3 weeks; 14-day pause; reduced rate 0.5 %/week for 56 days)
- **AI position:** **insufficient evidence** from my domain. A4 leads. From A1's side: the supportive hand-off should include a gentle suggestion to talk to a doctor if weight loss is unintended.
- **Confidence:** low.
- **Human still needed?** Yes, seat A4 (with A1).

---

## Position index

| # | Item | Position |
|---|---|---|
| M01-01 | heart_or_blood_pressure | agree with conditions |
| M01-02 | chest_discomfort (capped before clearance) | **disagree** |
| M01-03 | fainting_or_dizziness (capped before clearance) | **disagree** |
| M01-04 | unusual_breathlessness (capped before clearance) | **disagree** |
| M01-05 | ongoing_condition | agree with conditions |
| M01-06 | medication_affecting_effort | agree with conditions |
| M01-07 | advised_to_limit_activity (capped before clearance) | **disagree** |
| M01-08 | bone_joint_back | agree with conditions |
| M01-09 | pregnancy_or_recent_birth | agree with conditions |
| M01-10 | advised_against_calorie_restriction | agree |
| M01-11 | rescreenIntervalMonths 12 | agree with conditions |
| M01-12 | symptomLookbackMonths 12 | agree |
| M01-13 | postpartumWindowMonths 12 | agree with conditions |
| M01-14 | specialPopulationMaxRPE 5 | agree with conditions |
| M01-15 | question set / licensed instrument | agree with conditions |
| M01-16 | self-attested clearance | agree with conditions |
| M01-17 | access at the cap before clearance | agree with conditions |
| M01-18 | low-intensity library | agree with conditions |
| M01-19 | S7 age 16 | agree |
| FIX-47 | strictest combination | agree with conditions |
| FIX-48 | concurrent assessments | agree |
| M05-18 | red-flag list | agree with conditions |
| M05-19 | seek-care copy | **disagree** |
| M05-20 | S3 attestation / wait | insufficient evidence |
| M05-21 | red-flag deload 7 days | agree with conditions |
| M05-22 | emergency numbers | agree with conditions |
| M05-23 | amberPainScore 4 | agree with conditions |
| M05-24 | S2 red 6 | agree |
| M05-25 | next-morning rule | agree with conditions |
| M05-26 | red clearing rule | agree |
| M05-27 | persistenceDays 14 | agree with conditions |
| M05-28 | physiotherapist copy | agree with conditions |
| M05-29 | amber tips | agree with conditions |
| M05-30 | amber-weeks deload 7/14 | agree with conditions |
| M05-31 | urgent MSK signs (gap) | **disagree** |
| M05-32 | mobility.* | agree with conditions |
| M05-33 | MEDICAL_REVIEW catalogue | agree with conditions |
| M02-34 | amber selection penalties | insufficient evidence |
| M02-35 | in-session pain ≥ 6 | agree |
| M06-36 | joint-load profiles | agree with conditions |
| M06-37 | screening → avoidTags | agree with conditions |
| M06-38 | amberJointPenalty 0.1 | insufficient evidence |
| M06-39 | SUBSTITUTES / similarity | insufficient evidence |
| M06-40 | impact levels | agree with conditions |
| M07-41 | olderAdultProtocolAge 55 | agree |
| M07-42 | chairStandWindowSeconds 30 | agree |
| M07-43 | chair_stand thresholds | insufficient evidence |
| M07-44 | assessing flagged users before clearance | **disagree** |
| M07-45 | rpeAtZeroRir tied to S1 | agree with conditions |
| M07-46 | 55+ protocol optional | agree with conditions |
| M03-49 | HRR zones | agree |
| M03-50 | HIIT gate | agree with conditions |
| M03-51 | BMI 35 low impact | agree with conditions |
| M03-52 | WHO 150/300 | agree |
| M03-53 | medication → effort zones | agree |
| M08-54 | older-adult program values | agree with conditions |
| M08-55 | S1 program behaviour | agree with conditions |
| M04/M10-56 | sustained-loss guardrails | insufficient evidence |

Totals: agree 12 · agree with conditions 33 · disagree 7 · insufficient evidence 6 (58 items). Item numbers are labels, not a count: M01 is 01–19, and later modules use their own labels.

Every item stays `validated: false`. Nothing in this file is a sign-off.
