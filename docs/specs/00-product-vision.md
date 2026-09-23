# FitAdapt — Product Vision, Principles & Safety Invariants (v2.1)

FitAdapt is a bilingual (FR/EN), offline-first training companion that turns one person's — or two partners' — goals, equipment and daily readiness into a safe, explainable session, and gets smarter with every logged set.

## Principles
- Safety beats engagement: no metric justifies bypassing a safety invariant.
- The engine decides, the interface explains, the AI converses.
- Progress is shown in the user's own currency: reps gained, variant unlocked, minutes done — not only kilograms.
- Every screen must be usable with sweaty hands, at arm's length, offline.
- Evidence-traceable: every coefficient and rule carries a source and a validation status.

## Safety invariants (enforced in code, covered by tests)
| ID | Name | Rule |
|---|---|---|
| S1 | Screening gate | A user with an unresolved screening flag cannot receive HIIT, maximal tests, or prescriptions above RPE 7 until they attest professional clearance. |
| S2 | Pain gate | A joint rated red (pain ≥ 6/10, or not settled by next morning) causes exercises that load that joint at medium/high level to be substituted in the next session. |
| S3 | Red-flag stop | Reported chest pain/pressure, fainting, disproportionate breathlessness, palpitations or sudden numbness/weakness ends the session, shows seek-care guidance and locks intensity until the user attests medical review. |
| S4 | Nutrition floors | Energy target never below estimated BMR; planned loss rate ≤ 1% bodyweight/week; no goal weight below BMI 18.5; deficit features disabled for users under 18 or who report being advised against calorie restriction. |
| S5 | Load ceiling | Prescribed load for an exercise never increases by more than 10% of its e1RM-based value within 7 days. |
| S6 | AI boundary | The AI coach can only change plans through engine APIs that enforce S1–S5 and S7; it never diagnoses. |
| S7 | Special populations | Pregnancy/postpartum and users under 16 are excluded from automatic programming in v1 (age gate at 16; pregnancy routes to professional guidance and a low-intensity library). |

## Committee decisions
| ID | Decision | Detail |
|---|---|---|
| C1 | Safety first, enforced in code | Health screening in onboarding and seven safety invariants (S1–S7) enforced by the engine and covered by property-based tests. |
| C2 | Deterministic, explainable engine | The engine is the only source of prescriptions; every set carries reason codes rendered as a sentence ('why this load'). |
| C3 | Double progression with RIR autoregulation | Replaces the fixed +2.5–5 kg rule; increments depend on exercise size and the smallest step available on the user's equipment. |
| C4 | Partner training becomes a flagship | 'Fair Pair' (M09): single-device first, then multi-device; fairness through relative intensity, not absolute load. |
| C5 | Nutrition is in scope, with guardrails | Energy and protein targets with hard floors; deficit features disabled for minors and on self-reported contraindication. |
| C6 | Knowledge graph as backbone | Exercises, variants, substitutions and joint-load profiles live in one reviewed, versioned graph (M06). |
| C7 | Assess, then periodize | Safe submaximal baseline tests (M07) feed mesocycle-based programs (M08). |
| C8 | Offline-first, bilingual, low-end friendly | Sessions work without network; FR/EN from the first screen; performance budgets on low-end Android. |
| C9 | Honest physiology copy | No 'fat-burning zone' claims; wellness positioning, not medical claims. |
| C10 | Real advisory board before launch | All coefficients and content flagged 'validated: false' must be signed off by qualified professionals. |
| C11 | Legal defensibility by design | Legal invariants L1–L12 are implemented and tested like safety invariants; module M20 owns legal documents, acceptance, claims linting, licences and the defensibility file. |
| C12 | Protect the founder before writing code | Operate through a limited-liability company that owns all IP, check any employment obligations, clear the name, engage counsel and insurance before public beta (Gate 0). |
| C13 | 'FitAdapt' is a working codename | The fitness-app name space around 'Adapt' is crowded; the public brand is chosen only after a clearance search (L7). |

## Differentiators
- **Fair Pair** — Two people of very different capacity (e.g., 120 kg and 60 kg) train the same session on one phone, with individual variants and loads and a fairness-adjusted challenge score.
- **Explainable adaptation** — Every prescription explains itself; the AI coach can talk about it but cannot bypass the engine.
- **Pain-aware autoregulation** — A physio-grade pain-monitoring model automatically substitutes exercises and triggers deloads.
- **Anywhere Switcher** — Multiple equipment profiles; changing location keeps the training stimulus, not the exercise list.
- **On-device motion sensing** — Camera rep counting and voice coaching with no video leaving the phone.
- **Local food intelligence** — A community-verified database of regional dishes and typical portions.
- **Offline-first on modest devices** — Designed for intermittent connectivity and mid/low-range Android phones.

## Test personas (golden tests)
| Persona | Profile |
|---|---|
| P1 Ibrahima | 38, M, 120 kg, 178 cm, beginner, home (pull-up bar, bands, 2×10 kg dumbbells), 3×40 min, goal fat loss, knees: amber history |
| P2 Awa | 32, F, 60 kg, 165 cm, beginner, home + gym, 3×45 min, goal first strict pull-up + tone; trains with P1 |
| P3 David | 44, M, 82 kg, intermediate (3 yrs), commercial gym, 3×45 min, goal hypertrophy, often misses Fridays |
| P4 Mariam | 62, F, 70 kg, returning after 10 yrs, home, 3×30 min, goal health/balance, screening: controlled hypertension (cleared with restrictions) |
| P5 Ousmane | 29, M, 93 kg, advanced powerlifter, full gym with microplates, 4×75 min, goal strength |
| P6 Léa-type | 27, F, 58 kg, advanced calisthenics, park + rings, 5×60 min, goal skills (muscle-up) |

## Product KPIs
| Area | Metric | Target |
|---|---|---|
| Activation | First workout completed within 24 h of sign-up | ≥ 60% |
| Adherence | Completed / planned sessions (weeks 1–8) | ≥ 70% |
| Retention | Week-4 active users | ≥ 35% |
| Trust | Share of prescriptions manually overridden | < 15% |
| Safety | Red pain flags per 1,000 sessions (trend) | Decreasing; reviewed monthly |
| Quality | Crash-free sessions | ≥ 99.5% |
| Partner | Share of paying users using Fair Pair | ≥ 25% |

## Evidence references
References were compiled by the drafting assistant from its own knowledge, not retrieved and checked for this document. Verify each citation and every numeric value against the original source before it is marked 'validated: true' in the codebase.

- Achten J, Jeukendrup AE (2004). Optimizing fat oxidation through exercise and diet. Nutrition, 20(7–8), 716–727.
- Bull FC et al. (2020). World Health Organization 2020 guidelines on physical activity and sedentary behaviour. British Journal of Sports Medicine, 54(24), 1451–1462.
- Ebben WP et al. (2011). Kinetic analysis of several variations of push-ups. Journal of Strength and Conditioning Research, 25(10), 2891–2894.
- Epley B (1985). Poundage chart. Boyd Epley Workout (origin of the Epley 1RM estimate: 1RM = w × (1 + reps/30)).
- Jones CJ, Rikli RE, Beam WC (1999). A 30-s chair-stand test as a measure of lower body strength in community-residing older adults. Research Quarterly for Exercise and Sport, 70(2), 113–119.
- Karvonen MJ, Kentala E, Mustala O (1957). The effects of training on heart rate: a longitudinal study. Annales Medicinae Experimentalis et Biologiae Fenniae, 35(3), 307–315.
- Mifflin MD, St Jeor ST et al. (1990). A new predictive equation for resting energy expenditure in healthy individuals. American Journal of Clinical Nutrition, 51(2), 241–247.
- Morton RW et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. British Journal of Sports Medicine, 52(6), 376–384.
- PAR-Q+ Collaboration / Warburton DER et al. The Physical Activity Readiness Questionnaire for Everyone (PAR-Q+), current edition — licence terms to be checked before verbatim use.
- Schoenfeld BJ, Ogborn D, Krieger JW (2017). Dose-response relationship between weekly resistance training volume and increases in muscle mass. Journal of Sports Sciences, 35(11), 1073–1082.
- Silbernagel KG et al. (2007). Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy. American Journal of Sports Medicine, 35(6), 897–906.
- Tanaka H, Monahan KD, Seals DR (2001). Age-predicted maximal heart rate revisited. Journal of the American College of Cardiology, 37(1), 153–156.
- Zourdos MC et al. (2016). Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. Journal of Strength and Conditioning Research, 30(1), 267–275.
- Regulation (EU) 2024/1689 (AI Act), Article 50 — transparency obligations; application from 2 August 2026, unaffected by the Digital Omnibus on AI (Regulation (EU) 2026/1744).
- Regulation (EU) 2016/679 (GDPR), Articles 9 and 27.
- Directive (EU) 2019/882 (European Accessibility Act).
- Senegal Law No. 2008-12 of 25 January 2008 on the protection of personal data; Commission de Protection des Données Personnelles (CDP).
