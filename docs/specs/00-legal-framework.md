# Legal Framework & Defensibility (v2.1)

> No specification can guarantee that nobody will ever sue. What this version does is lower the probability of a claim, strengthen the defence if one is made, and move residual risk off the founder through a company structure and insurance. It is a design framework written by a non-lawyer drafting assistant; every document and decision here must be reviewed by qualified counsel in each launch jurisdiction before public release.
>
> In the EU and UK (and in many other systems), a disclaimer cannot exclude liability for death or personal injury caused by negligence, and consumer-protection rules limit what terms can waive. Disclaimers help, but the real protection is a product that is demonstrably safe by design, honest in its claims, documented, and insured.

## Legal invariants (enforced in code, covered by tests)
| ID | Name | Rule |
|---|---|---|
| L1 | No medical or results claims | The product is positioned as general wellness. No copy anywhere (app, store, website, ads, AI output) claims to diagnose, treat, cure or prevent a disease, or guarantees results (e.g., 'lose 10 kg in 30 days'). Enforced by a claims linter in CI. |
| L2 | Informed, recorded acceptance | Terms of Use, Privacy Policy, health-data consent and an exercise-risk acknowledgment are accepted before the first workout; each acceptance stores document version, locale, jurisdiction and timestamp; material changes require re-acceptance. |
| L3 | Notice at the point of risk | Short, plain-language notices appear where the risk is: first workout, first HIIT session, any assessment, nutrition deficit set-up, AI coach, camera mode. They are shown, not buried in the terms. |
| L4 | User stays in control | Every prescription can be skipped, modified or stopped; a stop control is always visible; no mechanic pressures users to continue through pain or fatigue. |
| L5 | AI transparency | Users are told they are interacting with an AI system at the start of every coach conversation and by a persistent label (EU AI Act Art. 50 duties apply since 2 August 2026); the AI never impersonates a human professional. |
| L6 | Licensed content only | Every media asset, font, sound, icon, dataset and open-source dependency has a recorded licence compatible with commercial use; the build fails on missing or incompatible licences. |
| L7 | Cleared names and marks | The product name, logo and feature names are used publicly only after trademark clearance in launch markets; third-party marks appear only in nominative, factual use. |
| L8 | Fair consumer dealing | Prices shown with applicable taxes; cancellation is as easy as sign-up; trial-end reminders; statutory withdrawal rights respected; no dark patterns; no fake or unconsented testimonials or before/after photos. |
| L9 | Lawful data processing | Explicit consent for health data; registrations/authorisations with data-protection authorities where required; lawful cross-border transfer mechanisms; health-platform data (HealthKit, Health Connect) never used for advertising or sold. |
| L10 | Clear third-party roles | Coaches are independent professionals bound by a coach agreement with verified credentials; community content has reporting, blocking and a notice-and-action process. |
| L11 | Defensibility file | Consents, notices shown, safety events, engine version per prescription, content approvals and incident handling are logged immutably and retained per schedule, so the company can show what the user saw and why a prescription was made. |
| L12 | No real people without consent | Committee personas are fictional; no real person's name, likeness, voice or testimonial is used without written consent; the AI never generates a real person's likeness. |

## Gate 0 — founder protections (before public beta)
| Item | Action | When |
|---|---|---|
| Company structure | Incorporate a limited-liability entity before any public release; the company (not the founder personally) contracts with users, coaches and suppliers and owns all code, content and trademarks. | Before beta |
| IP ownership | Written IP assignment from every contributor (co-founders, freelancers, advisors, content creators) to the company; keep a register. | Continuous |
| Founder employment check | If the founder is employed, review the employment contract for IP-assignment, confidentiality, outside-activity and non-compete clauses; build on personal time and equipment; obtain written approval where required. | Now |
| Counsel | Engage counsel in the primary jurisdiction and correspondents for each launch market; agree the jurisdiction matrix and document list. | Phase 0 |
| Name clearance | Trademark search (e.g., Nice classes 9, 41, 42, 44) in launch markets; file only after clearance; keep two fallback names. | Phase 0 |
| Insurance | Quotes for product/professional liability covering digital fitness guidance, cyber liability, and D&O once investors join. | Before beta |
| Advisory board | Written agreements with real experts: scope, compensation, liability, confidentiality, and whether their names may be used publicly. | Phase 1 |
| Data-protection filings | Plan registrations or authorisations with authorities where required (e.g., prior formalities with Senegal's CDP under Law No. 2008-12) and appoint representatives where needed (e.g., GDPR Art. 27 if established outside the EU). | Before beta |

## Legal risk register
| Domain | Exposure | Controls | Modules |
|---|---|---|---|
| Personal injury / negligence | A user is injured following a prescription or during a partner challenge. | S1–S7, L3, L4, conservative defaults, expert-validated content, L11 audit trail, insurance, terms with lawful limitation clauses. | M01–M05, M09, M20 |
| Medical-device regulation | Features or copy imply a medical purpose, bringing the app under medical-device rules. | L1 claims linter, no diagnosis, no condition-specific programs, regulatory review of screening, pain and nutrition copy. | M05, M10, M11, M20 |
| Regulated professions | Individual nutrition or rehabilitation advice treated as unlicensed practice of dietetics or physiotherapy. | General guidance only, no medical nutrition therapy or rehab plans, referral to professionals, credential checks for coaches. | M05, M10, M15 |
| Data protection | Unlawful processing of health data, breach, missing filings or unlawful transfers. | M17 + L9, DPIA, consent records, encryption, authority filings, transfer mechanisms, breach runbook. | M17, M12, M04 |
| AI regulation and AI harm | Missing AI disclosure or harmful AI advice. | L5 disclosure, S6 tool-only changes, safety evals at 100%, logging, provider usage-policy compliance. | M11, M14 |
| Consumer and subscription law | Hard-to-cancel subscriptions, unclear prices, withdrawal rights ignored. | L8, store-managed billing, cancellation parity test, trial reminders, withdrawal-waiver capture where applicable. | M16 |
| Misleading advertising | Unsubstantiated performance or weight-loss claims, fake reviews, unconsented before/after photos. | L1, L8, L12, substantiation file for every marketing claim, testimonial consent records. | M19, M20 |
| Copyright and licences | Unlicensed videos, questionnaires (e.g., PAR-Q+ wording), fonts, music, datasets (e.g., share-alike food databases) or code. | L6 asset register, SBOM, OSS licence allowlist in CI, licence checks before verbatim use. | M06, M10, M20 |
| Trademark conflict | Name or feature names infringe an existing mark. | L7 clearance before public use; codename in the meantime. | M19, M20 |
| Third-party coaches | A coach on the platform gives harmful advice. | L10 coach agreement with indemnity, credential verification, engine safety caps that coaches cannot lift, reporting channel. | M15 |
| User-generated content | Harassment, defamation or unlawful content in challenges or community features. | Report/block, moderation queue, notice-and-action procedure, community guidelines. | M13 |
| Minors | Under-age users, or minors exposed to calorie restriction. | Age gate at 16 (higher where local law requires), no targeting of minors, deficit features off under 18. | M01, M10 |
| Accessibility | Non-compliance with accessibility law for consumer digital services (e.g., European Accessibility Act, applicable since 28 June 2025). | WCAG 2.2 AA design system and audits. | M00, M19 |
| Store policies | Removal from App Store/Google Play for health-data, payments or account-deletion breaches. | Store compliance checklists, in-app account deletion, accurate privacy labels. | M16, M17, M19 |
| Founder personal exposure | Personal liability, or a conflict with an employer over IP or outside activities. | C12: company structure, IP assignments, employment-contract check, insurance. | Gate 0 |
| Tax | Cross-border VAT on digital services. | Stores as merchant of record for in-app sales; merchant-of-record provider for web checkout. | M16 |

## Jurisdiction matrix (starter — for counsel)
This matrix is a starting checklist for counsel, not a statement of the law. Confirm which markets you launch in, and have each row checked and completed by a qualified lawyer.

| Market | Frameworks to check |
|---|---|
| EU (e.g., France) | GDPR (health data = special category, Art. 9); EU AI Act Art. 50 transparency (applies since 2 Aug 2026); EU MDR boundary (no medical purpose); Consumer Rights Directive (withdrawal rights); Unfair Commercial Practices Directive; Digital Services Act (user content); European Accessibility Act; French-language requirements for consumer documents in France. |
| United Kingdom | UK GDPR and Data Protection Act 2018; consumer-protection and subscription-contract rules (DMCC Act 2024, as provisions come into force); UK medical-device rules for any medical purpose. |
| United States (only if launched) | FTC Act (deceptive claims); FTC Health Breach Notification Rule for health apps; state consumer-health-data laws (e.g., Washington My Health My Data Act); state auto-renewal laws; Illinois BIPA if any biometric identifiers; COPPA (users under 13 excluded anyway); FDA general-wellness policy. |
| Senegal | Law No. 2008-12 on personal data (a reform has long been under discussion — confirm the text in force) and prior formalities with the CDP, especially for health data and transfers abroad; Law No. 2008-08 on electronic transactions; consumer-protection rules. |
| Other WAEMU/ECOWAS markets (e.g., Côte d'Ivoire) | National data-protection laws (e.g., Côte d'Ivoire Law No. 2013-450, supervised by ARTCI), local consumer and e-commerce rules, language requirements. |
| App stores (all markets) | Apple App Review Guidelines (health-data use limits, in-app account deletion, payments); Google Play Health apps policy, data-safety form and payments policy. |

## Legal documents to draft (counsel review required)
| Document | Content |
|---|---|
| Terms of Use | Wellness positioning, assumption of risk, user responsibilities, lawful limitation of liability, subscription terms reference, governing law and consumer-compliant dispute resolution, per jurisdiction. |
| Privacy Policy + health-data consent | Per data type, purposes, retention, transfers, rights, authority contacts. |
| Exercise-risk acknowledgment | Plain-language, one screen, accepted before the first workout (L2). |
| Point-of-risk notices | First workout, HIIT, assessments, nutrition deficit, AI coach, camera mode (L3). |
| AI coach notice | AI disclosure, limits, no medical advice, how to reach a human/professional (L5). |
| Subscription & refund terms | Prices, renewal, cancellation, trials, withdrawal rights and waivers where applicable (L8). |
| Coach Agreement + data-processing terms | Independence, credentials, indemnity, conduct, data roles (L10). |
| Community guidelines | Acceptable behaviour, reporting, enforcement (L10). |
| Advisory-board agreements | Scope, liability, confidentiality, name use. |
| Substantiation file | Evidence for every marketing and in-app claim (L1). |

## Naming
'FitAdapt' is a working codename only (decision C13). Do not use it in stores, domains or marketing until trademark clearance is complete.
