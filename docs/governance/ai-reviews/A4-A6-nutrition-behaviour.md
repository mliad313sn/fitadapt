# AI pre-review — Nutrition and behaviour (seats A4, A6) (not a professional sign-off)

> **Read this first.** An AI reviewer wrote this document. It is not a registered dietitian, a behavioural scientist, a physician or a lawyer. It holds the *subject* of seats A4 (registered sports dietitian) and A6 (behavioural scientist) but none of their *authority*. Nothing here is validated, approved or signed off, and nothing here may be used to change `validated: false` to `true`. It is a **pre-review** under docs/governance/03-expert-advisory-council.md §5: the seated A4 and A6 members, and A1 where named, can confirm or reject each point. No config, code, test, legal text, status file or governance file was edited. This file is the only output.
>
> Reviewed on 2026-09-24, branch `claude/vigilant-franklin-76iok4`. Inputs: CLAUDE.md, docs/specs/00-product-vision.md (S1–S7), docs/specs/00-legal-framework.md (L1–L12), docs/governance/03, docs/status/M01, M03, M04, M05, M08, M09, M10, the M10 and M13 specs, and the config and source files named under each item.
>
> **Source access limits.** This environment's network proxy blocked PubMed, PMC, ajcn.nutrition.org and USDA FoodData Central (fdc.nal.usda.gov, api.nal.usda.gov). Most primary sources were therefore checked through their publisher, NICE, EFSA, FAO or KDIGO landing pages and through search-engine abstracts, not by reading the full text. Where a claim rests on an abstract or a secondary page, the item says so. Food values marked "AI recollection" are the reviewer's memory of USDA SR Legacy figures and were **not** fetched. The A4 member must check them against the table itself.
>
> **Copyright (L6).** Sources are paraphrased. No questionnaire, table or dataset is reproduced. The food spot-check quotes single values for individual foods, with their citation, as review evidence. It is not a data extract and must not be pasted into the seed.

## Summary

**Items reviewed: 40** (M10: 25, M04: 5, M09: 3, M01: 1, M03/M05/M08 copy: 3, M13 design: 1, cross-cutting denylists: 2).

| Position | Count |
|---|---|
| Agree | 12 |
| Agree with conditions | 22 |
| Disagree | 3 |
| Insufficient evidence (keep the conservative default until a human decides) | 3 |

### What I would change first (highest safety impact)

1. **The S4 energy floor lets targets fall into NICE's "low-energy diet" range without supervision (item M10-16, the current value may be unsafe).** The floor is the estimated BMR alone. For a small, older, sedentary woman, Mifflin-St Jeor gives a BMR near 950 kcal/day (50 kg, 150 cm, 65 y: 10·50 + 6.25·150 − 5·65 − 161 ≈ 951). The engine then sets a target of 960 kcal/day (the floor, rounded up). NICE NG246 (2025) says low-energy diets of 800–1,200 kcal/day should only be used inside a specialist service with dietetic support. **Recommendation:** make the floor stricter, not looser: the higher of the estimated BMR and an absolute minimum (for example 1,200 kcal/day, the value A4 and A1 settle on). Below that the app should show supportive mode, not a number. This makes S4 stronger and is a spec change for the PO with A4 and A1. It is not a config tweak.
2. **Adaptive expenditure can push the target down to the floor when logging is incomplete (item M10-9).** The observation counts any day with at least one logged item as a logged day. People under-report intake by roughly 10–30 % on average in doubly-labelled-water studies, and by more in people with obesity (Burrows et al. 2019). Partly logged days make the observed expenditure look lower, and the ±25 % band then allows the "maintenance" figure to drop to about 0.9 × BMR for a sedentary user, which puts the target on the floor. **Recommendation:** make the band asymmetric (a small downward limit such as −10 %, upward unchanged). Count only days the user marks complete, or leave out days whose logged energy is implausibly low (for example below the BMR floor). Tell the user when the estimate went down because of their logs.
3. **Add a self-reported current or past eating disorder as its own disable path (item M10-20 / M01-1).** Today deficit features switch off only when a professional *advised against* restriction. Someone with an untreated or past eating disorder who was never so advised gets numeric deficit targets, and the L3 notice only asks them to self-select out. Calorie tracking has been linked to keeping eating-disorder symptoms going in people with an eating disorder (Levinson et al. 2017), and to eating concern and restraint in students (Simpson & Mazzeo 2017). **Recommendation:** add a screening item such as "Do you have, or have you had, an eating disorder?" whose "yes" works like `advised_against_calorie_restriction`: supportive mode, no numbers, signposting. A4, A1 and counsel (health-data consent) should review it.
4. **Streaks break when the user makes a safe choice (item M04-4, current behaviour disagrees with L4 and M13).** `adherence()` resets the streak whenever a planned session did not happen, including when the user skipped because of pain (S2), a red-flag lock (S3), illness or a readiness-based rest. Broken streaks lower later engagement, and the effect is stronger when people blame themselves (Silverman & Barasch 2023). Lally et al. (2010) found one missed repetition did not materially harm habit formation. **Recommendation:** count safety-driven and readiness-driven skips as protected days that keep the streak going. Add the streak-freeze allowance the M13 spec already asks for. Make the "N of M planned sessions in 4 weeks" count the main display and "Longest streak" a secondary one.
5. **Fair Pair: the side-by-side comparison only appears when both partners complete (item M09-1).** That makes finishing the only way to see the result, which is a quiet push to keep going (L4). **Recommendation:** default to a cooperative summary ("you both trained today") that appears whatever the completion state, let each person see their own score privately whenever they like, and make the relative-score comparison a second opt-in.

### Current values I consider unsafe or likely unsafe
- **S4 BMR-only floor** (M10-16): allows unsupervised targets below 1,200 kcal/day (see 1 above).
- **Symmetric ±25 % adaptive band with any-item day counting** (M10-9): biases toward lower targets when logs are incomplete (see 2 above). S4 still holds, but the practical deficit becomes larger than planned.
- **The sedentary activity factor of 1.2** (M10-3) is below the lowest physical activity level (PAL) band used by EFSA (1.4) and FAO/WHO/UNU (1.40–1.69). Under-estimating expenditure makes the true deficit larger than the one S4 checks. The M04 guardrail is the backstop. I rate this "likely unsafe for some users", not clearly unsafe.

### Sources relied on most
Mifflin et al. 1990 (AJCN 51:241); Frankenfield et al. 2005 (J Am Diet Assoc); FAO/WHO/UNU 2004 *Human energy requirements*; EFSA NDA 2013 DRVs for energy and 2012 DRVs for protein; Hall 2008 (Int J Obes 32:573) and Hall et al. 2011 (Lancet 378:826); Morton et al. 2018 (Br J Sports Med 52:376); Jäger et al. 2017 ISSN position stand; Thomas, Erdman & Burke 2016 AND/DC/ACSM joint position; Helms, Aragon & Fitschen 2014; Garthe et al. 2011; Iraki et al. 2019; NICE NG246 (2025) and NG69 (2017); Golden et al. 2016 (AAP); KDIGO 2024; Burrows et al. 2019; Simpson & Mazzeo 2017; Levinson et al. 2017; Lally et al. 2010; Silverman & Barasch 2023; Gollwitzer & Sheeran 2006; Michie et al. 2011 (COM-B); Zhang & Centola 2016; EDPB Guidelines 03/2022; FTC 2022 *Bringing Dark Patterns to Light*; Mathur et al. 2019. Full list with URLs at the end.

---

## M10 — Nutrition & energy balance

Config files: `packages/engine/src/nutrition/config.ts` (`NUTRITION_CONFIG`), `packages/safety/src/nutrition.config.ts` (`NUTRITION_SAFETY_CONFIG`), S4 constants in `packages/safety/src/nutrition-floors.ts`, logic in `packages/engine/src/nutrition/{energy,adaptive,targets}.ts`.

### M10-1 · Mifflin-St Jeor coefficients
| Field | Content |
|---|---|
| Item | `bmr.weightKcalPerKg` 10, `bmr.heightKcalPerCm` 6.25, `bmr.ageKcalPerYear` 5, `bmr.maleConstantKcal` +5, `bmr.femaleConstantKcal` −161. Source: "Mifflin MD, St Jeor ST et al. (1990), Am J Clin Nutr 51(2):241–247 … not checked against the source". |
| Source check | **Partly verified.** The citation is correct (AJCN 51(2):241–247, 1990, DOI 10.1093/ajcn/51.2.241, PMID 2305711): 498 healthy adults aged 19–78, normal-weight and obese, resting energy measured by indirect calorimetry, R² ≈ 0.71. The full text was blocked here. The coefficients match the form reproduced by clinical references (e.g. Medscape's calculator), but I could not read them in the original. |
| Evidence summary | A systematic review found Mifflin-St Jeor predicted resting metabolic rate within ±10 % of the measured value more often than Harris-Benedict, Owen or WHO/FAO/UNU, in both non-obese and obese adults. Accuracy was lower in people with obesity, and the authors warn of individual errors and weak data for some age and ethnic groups (Frankenfield et al. 2005). |
| AI position | **Agree.** Mifflin-St Jeor is the right default equation for adults. |
| Safety note | The equation can be 10 % or more off for a given person. Its errors matter most at the S4 floor. Athletes with high lean mass tend to be under-estimated, which is the safe direction for the floor but gives lower targets. Accuracy for West and Central African populations is poorly documented, and the user base includes them. |
| Confidence | High for the equation choice. Medium for the exact coefficients (not read in the primary text). |
| Human still needed? | Yes — seat A4 (with A5). First confirm the five coefficients against the AJCN paper itself. |

### M10-2 · "Unspecified" sex constant
| Field | Content |
|---|---|
| Item | `bmr.unspecifiedConstantKcal` −78. Source: engineering default, midpoint of the two constants. |
| Source check | Not applicable (no external source; the arithmetic is correct: (5 − 161)/2 = −78). |
| Evidence summary | The published equation has only two sex terms. A midpoint has no validation data. For a female body it adds about 83 kcal to BMR (a higher floor, the safe direction). For a male body it removes about 83 kcal (a slightly lower floor). |
| AI position | **Agree with conditions.** Keep the midpoint. The reason text (`nutrition.sex.unspecified`, "average of both") should say that the estimate is less certain for this option. |
| Safety note | The error is small (≤ 83 kcal/day) compared with the equation's own ±10 %. There is no strong safety direction. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4 (with A5, and A6 for the wording). Check open question 3 in the M10 status file. |

### M10-3 · Activity factors
| Field | Content |
|---|---|
| Item | `activity.sedentary` 1.2, `light` 1.375, `moderate` 1.55, `very_active` 1.725, `extra_active` 1.9. Source: "commonly used multipliers … no primary source identified". |
| Source check | **Not found as cited.** I found no primary source for this exact set. The authoritative references use different, higher bands. FAO/WHO/UNU (2004) uses PAL 1.40–1.69 for sedentary or light activity, 1.70–1.99 for active, and 2.00–2.40 for vigorous. EFSA (2013) builds energy requirements from resting energy × PAL, with 1.4 as the low activity level and 1.6, 1.8 and 2.0 above it. |
| Evidence summary | Apart from sedentary 1.2, the factor set matches the usual practitioner scale. The authoritative population references do not use 1.2 for free-living adults. A PAL of 1.2 is closer to bed rest or very restricted activity. Most people who use a training app are at least 1.4. |
| AI position | **Agree with conditions.** (a) Rewrite `source` to say these are practitioner multipliers with no identified primary source, and cite FAO/WHO/UNU 2004 and EFSA 2013 as the reference bands. (b) A4 and A5 should decide whether `sedentary` should be about 1.4, aligned with EFSA's low PAL. (c) The level labels the user picks should say whether planned training sessions are included. |
| Safety note | A factor that is too low under-estimates maintenance. The S4 rate check and the ≤ 1 %/week cap are then measured against a maintenance figure that is too low, so the *true* deficit and loss rate are higher than planned. Example: true PAL 1.45 versus assumed 1.2 for a BMR of 1,650 kcal means about 410 kcal/day more deficit than planned. The safe direction for disordered-eating risk is the higher factor. Adaptive expenditure (M10-8/9) and the M04 guardrail partly correct this over weeks. |
| Confidence | Medium (the PAL references are solid; how the labels map to real users is uncertain). |
| Human still needed? | Yes — seat A4 with A5. Start with the sedentary value and the level labels. |

### M10-4 · Default loss rate
| Field | Content |
|---|---|
| Item | `loss.defaultPercentPerWeek` 0.5 %/week. Source: M10 spec "~0.5–1 % BW/week", lower end. |
| Source check | **Verified in substance.** Helms, Aragon & Fitschen (2014, JISSN) recommend intakes that give about 0.5–1 %/week of body-weight loss to keep muscle. In an RCT in elite athletes, a slower loss of about 0.7 %/week preserved or increased lean mass and strength better than about 1.4 %/week (Garthe et al. 2011, IJSNEM 21:97). |
| Evidence summary | The evidence supports slow loss for people who train. 0.5 %/week is the conservative end. The Helms paper is about competitive bodybuilders, a narrow population, but its direction fits the general-population guidance. |
| AI position | **Agree.** |
| Safety note | Lower is the safe direction. No concern. |
| Confidence | High. |
| Human still needed? | Yes — seat A4. Confirm the same default suits the general, non-athlete personas. |

### M10-5 · Muscle-gain surplus
| Field | Content |
|---|---|
| Item | `gain.surplusFraction` 5 %, `gain.maxSurplusKcal` 300 kcal. Source: engineering default (spec: "a small surplus"). |
| Source check | Not applicable (no source). Compared with Iraki et al. (2019, Sports 7:154), which suggests about 10–20 % above maintenance for novice and intermediate lifters and about 5–10 % for advanced lifters, aiming at about 0.25–0.5 % BW/week gain. |
| Evidence summary | 5 %, capped at 300 kcal, is at or below the lower end of that range. It may slow gains in novices but carries little risk. |
| AI position | **Agree.** It is conservative. The `source` should cite Iraki et al. 2019 as the comparison. |
| Safety note | Lower is the safe direction for unwanted fat gain. No safety concern. |
| Confidence | Medium (narrative review about bodybuilders). |
| Human still needed? | Yes — seat A4. |

### M10-6 · Protein range
| Field | Content |
|---|---|
| Item | `protein.minGPerKg` 1.6, `protein.maxGPerKg` 2.2 g/kg/day. Source: spec, citing Morton et al. 2018, "not checked". |
| Source check | **Verified, with a nuance.** Morton et al. 2018 (BJSM 52:376–384; a correction was published later, PMID 32943392, not read) reported that gains in fat-free mass from resistance training levelled off at about 1.62 g/kg/day, with a 95 % CI of about 1.03–2.20. So **2.2 is the upper bound of that interval, not a recommended ceiling**. The ISSN position stand (Jäger et al. 2017) gives about 1.4–2.0 g/kg/day for most exercising people, and higher intakes during energy restriction. The AND/DC/ACSM joint position (Thomas et al. 2016) gives about 1.2–2.0 g/kg/day. EFSA's population reference intake for adults is 0.83 g/kg/day (EFSA 2012). |
| Evidence summary | 1.6–2.2 g/kg/day fits the evidence for people who resistance-train, and the upper part is reasonable in a deficit. These are sport-nutrition ranges. For healthy adults, higher intakes have no established harm (ISSN). KDIGO 2024 recommends about 0.8 g/kg/day in CKD stages G3–G5 and advises against more than about 1.3 g/kg/day. |
| AI position | **Agree with conditions.** (a) Correct `source` for `maxGPerKg`: "upper 95 % CI bound of the Morton 2018 breakpoint; also consistent with ISSN 2017 (up to ~2.0, higher in a deficit)". (b) Protein targets should come with a short note: if you have kidney disease, check with your doctor before eating more protein. Better still, a kidney-disease screening answer should switch the protein range off. |
| Safety note | For a user with undiagnosed or known CKD, 1.6–2.2 g/kg is about double what KDIGO advises. The safe direction for that group is a lower range or no number. |
| Confidence | High for the range. Medium for the CKD handling (a clinical question for A1). |
| Human still needed? | Yes — seat A4 with A1. First decide the CKD screening and notice. |

### M10-7 · Reference weight for protein
| Field | Content |
|---|---|
| Item | `protein.referenceBmi` 25 kg/m². Protein is sized on min(actual weight, 25 × height²). Source: engineering default. |
| Source check | Not applicable. I found no primary source that sets exactly BMI 25. Practice varies (adjusted body weight, goal weight, or lean mass). The protein recommendations above are per kg of body weight or of lean mass, mostly measured in non-obese trainees. |
| Evidence summary | Scaling protein on total mass over-states needs at high body fat. Capping at a reference weight is a common, reasonable approach. For someone at BMI 40, height 170 cm, it gives about 115–160 g/day (≈ 1.0–1.4 g per kg of actual weight), which is still above the EFSA PRI. |
| AI position | **Agree with conditions.** Keep BMI 25 as the reference. Record it honestly as practice-based, and have A4 pick between BMI 25 and goal weight. |
| Safety note | Low risk either way. A lower reference only matters for CKD (see M10-6). |
| Confidence | Low–medium (no direct evidence for the exact value). |
| Human still needed? | Yes — seat A4. |

### M10-8 · Adaptive window and minimum logged days
| Field | Content |
|---|---|
| Item | `adaptive.windowDays` 14, `adaptive.minLoggedDays` 10. Source: engineering default. |
| Source check | Not applicable. |
| Evidence summary | Self-reported intake is systematically low: a systematic review against doubly labelled water found under-reporting in most studies (recalls roughly −10 to −20 %, larger in people with obesity) (Burrows et al. 2019). Weight trends over 14 days are noisy (water, glycogen). A 14-day window with most days logged is a reasonable minimum. The weak point is what counts as a "logged day": today it is any day with energy > 0, so one logged snack qualifies. |
| AI position | **Agree with conditions.** Keep 14/10. Change the day rule to "a day the user marked complete", or leave out days with implausibly low logged energy (for example below the BMR floor). |
| Safety note | Counting partly logged days biases observed expenditure **down**, which lowers targets. That is the unsafe direction for restriction and disordered eating. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4 with A5. |

### M10-9 · Adaptive blend and deviation band
| Field | Content |
|---|---|
| Item | `adaptive.blend` 0.5, `adaptive.maxDeviationFraction` 0.25 (symmetric ± 25 % of the formula). Source: engineering default. |
| Source check | Not applicable. |
| Evidence summary | Energy-balance back-calculation is sound in principle (Hall et al. 2011), but with self-reported intake it inherits under-reporting (M10-8). A symmetric ± 25 % band lets the "maintenance" used by S4 fall to about 0.9 × BMR for a sedentary user (1.2 × BMR × 0.75), so the target lands on the BMR floor. |
| AI position | **Disagree** with the symmetric band. Use an asymmetric one: a small downward limit (I suggest −10 % of the formula estimate as a starting point) and keep +25 % upward. When the adaptive estimate falls, show a reason code explaining that the logs suggest lower needs, and ask the user to confirm that their logs were complete. Blend 0.5 is acceptable. |
| Safety note | The unsafe direction is down. The floor still holds because of S4, but the real-world deficit can go well above the planned one, especially combined with M10-3 and M10-16. |
| Confidence | Medium (the reasoning is strong; the exact −10 % is my judgement, not a published value). |
| Human still needed? | Yes — seat A4 with A5. Decide the downward limit. |

### M10-10 · Update interval
| Field | Content |
|---|---|
| Item | `update.intervalDays` 7. Source: spec ("updated weekly"). |
| Source check | Spec only, no primary source. |
| Evidence summary | Updating weekly and blending (M10-9) avoids reacting to daily water swings. It is common practice. |
| AI position | **Agree.** |
| Safety note | None beyond M10-9. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4. |

### M10-11 · Sustained-loss pause
| Field | Content |
|---|---|
| Item | `guardrail.pauseDays` 14 days of maintenance after an M04 hand-off. Source: engineering default, citing the M04 copy "will not suggest eating less for now". |
| Source check | Not applicable. No published value found. |
| Evidence summary | I found no trial that sets a pause length after unplanned fast loss. NICE NG69 lists rapid weight loss and worrying restrictive eating among the things to take into account when an eating disorder might be present, which supports pausing and signposting. |
| AI position | **Insufficient evidence** to set the number. Keep 14 days as a conservative default. Conditions: (a) the user cannot end the pause early (answering open question 2: no self-override); (b) a second hand-off within, say, 90 days should switch the deficit off entirely and show signposting (see M10-24), not just pause again; (c) the pause should also apply when the user is not on a fat-loss goal (then it is copy only). |
| Safety note | Longer pauses are the safe direction. A self-override is the main risk. |
| Confidence | Low (no direct evidence). |
| Human still needed? | Yes — seat A4 with A1 (and A6 on the override question). |

### M10-12 · Reduced pace after the pause
| Field | Content |
|---|---|
| Item | `guardrail.reducedRateDays` 56, `guardrail.reducedRateMaxPercent` 0.5 %/week. Source: engineering default. |
| Source check | Not applicable. |
| Evidence summary | 0.5 %/week sits at the slow end of the evidence in M10-4. Eight weeks is arbitrary but plausible. |
| AI position | **Insufficient evidence** for the duration. The rate of 0.5 %/week is supported indirectly. Keep both as conservative defaults. |
| Safety note | Longer and slower is safer. |
| Confidence | Low. |
| Human still needed? | Yes — seat A4 with A1. |

### M10-13 · Rounding
| Field | Content |
|---|---|
| Item | `rounding.kcal` 10 (always up), `rounding.proteinG` 5 (to nearest). Source: engineering default. |
| Source check | Not applicable. |
| Evidence summary | Rounding energy up can only shrink a deficit. Rounding protein to 5 g is well inside the precision of intake estimates. |
| AI position | **Agree.** |
| Safety note | None. |
| Confidence | High. |
| Human still needed? | Yes — seat A4 (routine). |

### M10-14 · Hand-portion values
| Field | Content |
|---|---|
| Item | Palm of protein 150 kcal / 25 g; fist of vegetables 30 kcal / 2 g; cupped hand of starchy food 120 kcal / 3 g; thumb of fat 90 kcal / 1 g. Source: "engineer's rough estimates … coaching practice". |
| Source check | **Not found** as a primary source. Hand-portion systems are commercial coaching tools, not peer-reviewed standards. Gibson et al. (2016, J Nutr Sci) found hand-based estimation methods more accurate than household measures in a lab setting: with the finger-width method, about 80 % of estimates were within 25 % of true weight. That is about estimating size, not these energy values. |
| Evidence summary | The values are plausible for mixed typical foods: lean meat or fish about 100–120 g → about 25 g protein. A thumb of oil is about 10 g → about 90 kcal. A cupped hand of rice or starch → about 25 g carbohydrate → about 110–120 kcal. Real values vary by 2× with the food (fatty meat versus white fish, fried versus boiled starch). West African staples eaten by hand (fufu, attiéké) are denser than a cupped hand of rice. |
| AI position | **Agree with conditions.** Keep them, labelled as rough, and let A4 check them against a composition table. Consider a second "protein (fatty)" portion such as 250 kcal for fatty meat, fried fish or suya, because the one value under-counts those foods. |
| Safety note | Under-counting energy feeds the downward bias in M10-8/9 (the unsafe direction). |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4. |

### M10-15 · Energy density of weight change
| Field | Content |
|---|---|
| Item | `NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg` 7,700 kcal/kg. Source: "rule of thumb (≈ 3,500 kcal/lb) … not checked … a known simplification". |
| Source check | **Partly verified (as a simplification).** Hall (2008, Int J Obes 32:573–576) explains that the 3,500 kcal/lb rule (≈ 32.2 MJ/kg, ≈ 7,700 kcal/kg) roughly matches the energy density of weight lost by people with a lot of body fat (over about 30 kg), but **over-estimates the deficit needed per kg for leaner people**, because more of their loss is low-energy lean tissue. Hall et al. (2011, Lancet 378:826) show that the static rule over-predicts long-term loss, because expenditure adapts. |
| Evidence summary | For a *weekly planned rate*, 7,700 kcal/kg is acceptable for people with more body fat. For lean users, a given deficit produces **more** weight loss than planned. Early loss is also partly water and glycogen. |
| AI position | **Agree with conditions.** Keep 7,700 as the single S4 value, because one shared value is good design. Conditions: (a) rewrite `source` to cite Hall 2008 and state the direction of the error; (b) never use it to show users a long-term weight forecast (Hall 2011); (c) A4 and A5 should decide whether leaner users (for example BMI < 22) need a lower density, which would make the S4 rate check stricter, or whether the M04 guardrail is enough. |
| Safety note | For lean users, the planned ≤ 1 %/week can be exceeded in practice. Those are the users closest to the BMI 18.5 floor. The safe direction for the S4 check is a *lower* density, because it allows a smaller deficit per % of loss. In the adaptive back-calculation (M10-9), a lower density *lowers* observed expenditure, so the two uses pull in opposite directions. A4 and A5 should look at each use separately. |
| Confidence | High on the direction of the error. Medium on what to do about it. |
| Human still needed? | Yes — seat A4 with A5. |

### M10-16 · S4 floor: target ≥ estimated BMR (constant)
| Field | Content |
|---|---|
| Item | `enforceNutritionFloors`: target never below `ceil(BMR)`. It is an invariant, not configuration. Vision S4: "Energy target never below estimated BMR". |
| Source check | No external source is cited for "BMR" as the floor. NICE NG246 (2025) says low-energy diets (800–1,200 kcal/day) should only be considered inside a specialist obesity service with ongoing clinical and dietetic support, and very-low-energy diets (< 800 kcal/day) only for people with a clinically assessed need to lose weight fast. It also says people should not follow nutritionally unbalanced restrictive diets. |
| Evidence summary | For many small, older or sedentary women, BMR is under 1,200 kcal/day (e.g. 50 kg/150 cm/65 y ≈ 951; 55 kg/155 cm/50 y ≈ 1,108). The current floor then allows targets in NICE's supervised-only low-energy range. Meeting micronutrient needs is also hard at these intakes. |
| AI position | **Disagree (as the only floor).** Keep "≥ BMR" and add an absolute minimum, for example **1,200 kcal/day**, below which the app shows supportive mode and no number. This makes the invariant stricter, which CLAUDE.md rule 1 allows only through a spec change. It must never be made configurable downwards. |
| Safety note | **I consider the current behaviour potentially unsafe for this subgroup.** The safe direction is a higher floor. |
| Confidence | Medium–high (NICE is explicit about the ranges; the exact absolute number is for A4 and A1). |
| Human still needed? | Yes — seat A4 with A1, and the PO for the S4 spec wording. First check the 1,200 figure and whether it should differ by sex. |

### M10-17 · S4 rate cap ≤ 1 % BW/week (constant)
| Field | Content |
|---|---|
| Item | `S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK = 1`. |
| Source check | **Supported.** Helms et al. 2014 (0.5–1 %/week); Garthe et al. 2011 (0.7 %/week better than 1.4 %/week for lean mass and strength). |
| Evidence summary | Well supported as an upper limit for people who train. It is conservative compared with general weight-management practice. |
| AI position | **Agree.** Note that the real rate can exceed 1 % because of M10-3 and M10-15. The M04 guardrail is the backstop. |
| Safety note | See M10-3, M10-15. |
| Confidence | High. |
| Human still needed? | Yes — seat A4. |

### M10-18 · S4 goal-weight floor BMI 18.5 (constant)
| Field | Content |
|---|---|
| Item | `S4_MIN_GOAL_BMI = 18.5`; deficit disabled at or below the floor. |
| Source check | The WHO adult cut-off for underweight is BMI < 18.5 (a well-known classification; I did not open the WHO page in this run). |
| Evidence summary | It is a sensible hard limit. NICE NG69 warns against using BMI **alone** to judge eating-disorder risk. That concerns diagnosis, but it also means the floor is not enough protection on its own for users with a BMI of 19–21 who keep losing. |
| AI position | **Agree with conditions.** Keep 18.5. Also: when the *current* weight trend is within about 1 BMI unit of the floor and falling, show supportive copy and stop deficit numbers. Treat a goal weight rejected for being below the floor as a soft signal for the eating-disorder signposting in M10-24, recorded without judgement. |
| Safety note | A higher floor is safer. The present value is not unsafe. |
| Confidence | High. |
| Human still needed? | Yes — seat A4 with A1. |

### M10-19 · Under-18: no deficit and no numbers
| Field | Content |
|---|---|
| Item | S4 age 18; the engine shows supportive mode (no calorie number at all) to every user whose deficit features are off, including minors (Deviation 1 in the M10 status file). |
| Source check | **Supported.** The AAP clinical report by Golden, Schneider & Wood (2016, Pediatrics 138(3):e20161649) advises against encouraging dieting in adolescents and favours healthy behaviours over weight talk, as a way to prevent both obesity and eating disorders. |
| Evidence summary | Showing any calorie number to adolescents risks dieting behaviour. Habits-only is consistent with the AAP. |
| AI position | **Agree.** Keep the stricter default (no numbers for minors, including surplus targets). This answers open question 1 for minors. |
| Safety note | The stricter rule is the safe one. |
| Confidence | High. |
| Human still needed? | Yes — seat A4 with A1. |

### M10-20 · Other disable paths (advised against, not screened, special population) and the missing eating-disorder path
| Field | Content |
|---|---|
| Item | `deficitFeatures()`: off when advised against calorie restriction, not screened, S7 special population, or under 18. No path for a self-reported eating disorder. |
| Source check | NICE NG69: take into account factors such as rapid weight loss, dieting or restrictive eating that worries the person, and other signs; do not use screening tools such as SCOFF as the only method. Levinson et al. (2017, Eating Behaviors 27:14–16): among 105 people with an eating disorder who used a calorie tracker, about three-quarters felt it had contributed to their disorder. Simpson & Mazzeo (2017, Eating Behaviors 26:89–92): calorie-tracking use was associated with eating concern and restraint in students. |
| Evidence summary | Calorie tracking is a known risk for people with current or past eating disorders. The current design relies on the person having been *advised* by a professional, or choosing to opt out after reading the L3 notice. |
| AI position | **Agree with conditions.** Keep the existing paths. **Add** a self-reported "current or past eating disorder" answer that works like advised-against. Do not add a scored screening questionnaire (NICE: not as the only method; SCOFF is copyrighted; this is a wellness app, not a clinical service). |
| Safety note | High impact. The safe direction is more disable paths. |
| Confidence | Medium–high. |
| Human still needed? | Yes — seat A4 with A1, B1/counsel for special-category data and consent wording. |

### M10-21 · Food seed (270 items): provenance and accuracy
| Field | Content |
|---|---|
| Item | `packages/food-library/src/seed/foods.ts`, 270 items, each `source.kind: 'estimate'`, `licence: 'Owned'`, `validated: false`. |
| Source check | **Partly verified (spot-check, 20 items below).** Many generic items match USDA SR Legacy figures exactly (e.g. roasted goat 143 kcal/27 g, roasted chicken breast 165/31, both confirmed by FDC-derived pages). This suggests the engineer's "general knowledge" reflects widely published USDA values. **USDA FoodData Central is public domain under CC0 1.0**, and FDC asks users to cite it. The schema already accepts `CC0-1.0` and `source.kind: 'public'`. |
| Evidence summary | Generic foods look accurate. The weaker parts are prepared foods and regional dishes, where home recipes vary widely and no table was used. Some entries seem to use raw values for cooked foods. |
| AI position | **Agree with conditions.** (1) For generic foods, have A4 (with B3) **re-source** each item from FDC with its `fdcId`, `source.kind: 'public'`, `licence: 'CC0-1.0'` and the FDC attribution. This fixes both accuracy and the honesty of the provenance note. (2) For West and Central African foods, check against the **FAO/INFOODS Food Composition Table for Western Africa (2019)**; B3 must check its licence before any value is used. (3) For French foods, check against **CIQUAL (ANSES)**; B3 must check the Etalab/open-licence terms. (4) Mark regional dish values as "typical home recipe, wide range" in the UI. |
| Safety note | *Under*-estimates of logged food push adaptive targets down (the unsafe direction, M10-8/9). *Over*-estimates are the safe direction. Oil-rich dishes (thieboudienne, mafé, domoda) are the most likely to be under-estimated. |
| Confidence | Medium for generic foods. Low for dishes. |
| Human still needed? | Yes — seat A4 (all values) and B3 (table licences). Start with the high-energy dishes and the "cooked vs raw" entries. |

**Spot-check** (per 100 g as eaten; "ref" = my recollection of USDA SR Legacy unless a URL is given; the A4 member must re-check every figure):

| Seed id | Seed kcal / protein g | Reference | Note |
|---|---|---|---|
| rice_white_cooked | 130 / 2.7 | ≈130 / 2.7 (AI recollection) | matches |
| pasta_cooked | 158 / 5.8 | ≈158 / 5.8 (AI recollection) | matches |
| chicken_breast_cooked | 165 / 31 | 165 / 31.0 (FDC 171477, via FDC-derived pages) | matches |
| goat_meat_cooked | 143 / 27 | 143 / 27.1 (FDC 175304, via MyFoodData) | matches |
| egg_boiled | 155 / 13 | ≈155 / 12.6 (AI recollection) | matches |
| lentils_cooked | 116 / 9 | ≈116 / 9.0 (AI recollection) | matches |
| chickpeas_cooked | 164 / 8.9 | ≈164 / 8.9 (AI recollection) | matches |
| black_eyed_peas_cooked | 116 / 7.7 | ≈116 / 7.7 (AI recollection) | matches |
| banana | 89 / 1.1 | ≈89 / 1.1 (AI recollection) | matches |
| oats_dry | 380 / 13 | ≈379 / 13 (AI recollection) | matches |
| french_fries | 312 / 3.4 | ≈312 / 3.4 (AI recollection) | matches |
| yam_boiled | 118 / 1.5 | ≈116 / 1.5 (AI recollection) | matches |
| moringa_leaves_cooked | 60 / 5 | ≈60 / 5.3 boiled (AI recollection) | matches |
| **cassava_boiled** | 160 / 1.4 | raw 160 / 1.36; boiled ≈112 / 1 (secondary pages) | **raw value used for boiled**: over-estimate (safe direction) |
| **hummus** | 250 / 8 | 166 / 7.9 commercial (FDC 174289, via MyFoodData) | **over-estimate by ~50 %** vs USDA; CIQUAL may be higher; A4 decides |
| **mozzarella** | 250 / 18 | 300 / 22 whole milk (FDC 170845, via FDC-derived pages); part-skim ≈254 / 24 | under-estimate vs whole milk, or protein low vs part-skim |
| butter | 740 / 0.6 | ≈717 (USDA); CIQUAL ≈ 740s (AI recollection) | within table differences |
| fufu | 160 / 1 | WAFCT 2019 not read; one secondary page gives ≈398 kcal per 240 g (≈166/100 g) | plausible, verify in WAFCT |
| attieke | 170 / 1.2 | unreliable app value 340 (likely dry product) | **verify in WAFCT**, high uncertainty |
| thieboudienne | 160 / 8 | no composition study found | **likely under-estimate** for oil-rich home recipes; verify |

### M10-22 · Habits
| Field | Content |
|---|---|
| Item | Habits: some protein at each meal; vegetables or fruit at two meals; water through the day. |
| Source check | WHO healthy-diet guidance: at least about 400 g of fruit and vegetables a day (well known; not fetched this run). |
| Evidence summary | These are simple, non-restrictive, positively framed habits that suit implementation-intention prompts (Gollwitzer & Sheeran 2006). "Two meals" is below the WHO amount but is a sensible first step. |
| AI position | **Agree with conditions.** Keep them. Consider "regular meals" as a habit in its own right for supportive mode (a guard against restriction). Do not show a habit count as a streak. |
| Safety note | None. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4 (content), A6 (framing). |

### M10-23 · Supportive-mode wording and referral
| Field | Content |
|---|---|
| Item | `nutrition.supportive.*`, `nutrition.guardrail.*`, `legal.notice.nutritionDeficit.v1.body` (EN/FR). |
| Source check | Checked against CLAUDE.md rule 8 and NICE NG69 (early help-seeking). |
| Evidence summary | The copy is neutral, non-diagnostic and non-shaming. It points to "a doctor or a registered dietitian". It does not name a specialist eating-disorder support line. |
| AI position | **Agree with conditions.** Add per-jurisdiction signposting to a recognised eating-disorder support service, chosen and verified by A4 and counsel for each launch market. I deliberately give no names or numbers here, because they must be verified. Keep "general guidance, not a diet prescription". |
| Safety note | Signposting reduces delay in getting help. It carries no downside. |
| Confidence | Medium. |
| Human still needed? | Yes — seats A4 and A6, B-seat/counsel for the claims, a native FR editor. |

### M10-24 · Nutrition KPIs
| Field | Content |
|---|---|
| Item | M10 spec KPIs: "weekly logging days per user", "protein target attainment", "guardrail trigger rate (monitored, not optimised)". |
| Source check | Not applicable. |
| Evidence summary | Optimising for logging frequency pushes towards more tracking, the behaviour linked to eating-disorder symptoms in vulnerable users (M10-20). |
| AI position | **Agree with conditions.** Label "weekly logging days" *monitored, not optimised*, like the guardrail rate. Never A/B-test mechanics that raise logging frequency in deficit users (M18). |
| Safety note | Stops the metric from pulling the product towards more tracking. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6 with A4. |

### M10-25 · Nutrition copy denylist
| Field | Content |
|---|---|
| Item | `packages/i18n/src/nutrition-language.ts` `NUTRITION_COPY_DENYLIST` (46 EN, 43 FR entries), whole-word matching. |
| Source check | Checked against the M10 rule "no 'earn your food' mechanics" and CLAUDE.md rule 8 ("no 'fat-burning zone'"). |
| Evidence summary | It covers earn, burn off, cheat, guilt, good/bad food, detox and compensation well. Missing: the "eat back" family of exercise-for-food wording; food as a reward; the "fat-burning" and "metabolism" claims; starvation and meal-skipping wording. |
| AI position | **Agree with conditions.** Suggested additions: EN "eat back", "eat back your calories", "calorie budget", "calories left", "allowance", "treat yourself", "reward yourself", "indulge", "sin", "fat-burning", "fat burner", "boost your metabolism", "toxins", "starve", "skip a meal", "skip meals"; FR "brûle-graisse", "brûler les graisses", "récompense", "se récompenser", "se priver", "sauter un repas", "toxines", "booster le métabolisme", "calories restantes". "Calories left" is a UI pattern question as well as a wording one: A6 should decide whether a remaining-budget display is used at all. |
| Safety note | A blocked phrase is only a proxy. The mechanics matter more (see M10-24). |
| Confidence | Medium. |
| Human still needed? | Yes — seats A6 and A4, a native FR editor. |

## M01 — Screening

### M01-1 · "Advised against calorie restriction" question
| Field | Content |
|---|---|
| Item | `screening.question.advised_against_calorie_restriction` ("Has a health professional advised you not to restrict calories or not to follow a weight-loss diet?") → S4 deficit off. |
| Source check | See M10-20. |
| Evidence summary | Clear, non-diagnostic wording. It relies on prior professional contact. |
| AI position | **Agree with conditions.** Keep it. Add the separate self-report item from M10-20. |
| Safety note | See M10-20. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4 with A1, counsel. |

## M04 — Tracking and dashboard

Config: `packages/engine/src/analytics/config.ts` (`ANALYTICS_CONFIG`), logic `analytics/body.ts`, `analytics/adherence.ts`.

### M04-1 · Sustained-loss trigger
| Field | Content |
|---|---|
| Item | `guardrail.lossPercentPerWeek` 1 %, `guardrail.consecutiveWeeks` 3 (loss strictly above 1 %/week in each of 3 weeks, each with at least 2 weigh-ins). Source: M04 spec. |
| Source check | Spec only. The 1 % matches the S4 ceiling (M10-17). |
| Evidence summary | Three weeks above the planned ceiling is a reasonable signal. Two gaps: (a) someone who weighs themselves less than twice a week never triggers it; (b) a steady loss of 0.9 %/week near the BMI floor never triggers it. |
| AI position | **Agree with conditions.** Keep 1 %/3 weeks. Add: a trigger when the trend crosses within about 1 BMI unit of 18.5 while falling (see M10-18), and a gentler "not enough weigh-ins" state that pauses deficit *increases* rather than doing nothing. |
| Safety note | More triggers is the safe direction. The false-positive cost is only a supportive notice. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A4 with A1. |

### M04-2 · Notice repeat interval
| Field | Content |
|---|---|
| Item | `guardrail.repeatAfterDays` 14. Source: engineering default. |
| Source check | Not applicable. |
| Evidence summary | It lines up with the 14-day pause. Repeating more often could feel like nagging. Repeating less often risks missing a continued fast loss. |
| AI position | **Agree.** See M10-11 for escalation on a repeat. |
| Safety note | None extra. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6 with A4. |

### M04-3 · Adherence window
| Field | Content |
|---|---|
| Item | `dashboardConfig.adherenceDays` 28. |
| Source check | Not applicable. |
| Evidence summary | A rolling 4-week "N of M" count is forgiving and puts consistency ahead of perfection. That fits Lally et al. 2010. |
| AI position | **Agree.** Make it the primary adherence display (see M04-4). |
| Safety note | None. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6 with A3. |

### M04-4 · Streak rules (not a config value)
| Field | Content |
|---|---|
| Item | `adherence()`: a planned session that did not happen resets the streak to 0. There is no freeze, and safety- or readiness-driven skips get no protection. The UI shows current and "Longest". |
| Source check | M13 spec: "streaks that count planned rest days, with a streak-freeze allowance". Silverman & Barasch (2023, J Consumer Res 49:1095): an intact logged streak increases further engagement compared with a broken one; the effect is stronger when people blame themselves for the break and weaker when the streak can be "repaired". Lally et al. (2010, EJSP 40:998): the median time to automaticity was about 66 days, and one missed opportunity did not materially affect habit formation. |
| Evidence summary | Hard-reset streaks turn a single miss into a visible loss. That is a guilt cue (rule 8) and pressure to train when unwell or in pain (L4). |
| AI position | **Disagree** with the current reset rule. (a) Days skipped because of S2, S3, M05 readiness, or a user-marked illness count as *protected* and keep the streak going. (b) Add the M13 streak-freeze allowance. (c) Make the 28-day count the headline and drop or de-emphasise "Longest". |
| Safety note | Protected days remove an incentive to train through pain or red flags. |
| Confidence | Medium–high. |
| Human still needed? | Yes — seat A6 (and A2 on the pain-skip link). |

### M04-5 · Sustained-loss notice copy and channel
| Field | Content |
|---|---|
| Item | `progress.guardrail.*` copy; open question 4 (notification outside the dashboard, user off-switch). |
| Source check | Rule 8. NICE NG69 (early signposting). |
| Evidence summary | The copy is calm and non-judgemental ("That is a fast pace … a doctor or a registered dietitian can help"). |
| AI position | **Agree with conditions.** Show it in the app at the next open; do not send a push notification about weight, which could be seen on a lock screen and is health data. The user must not be able to turn the *pause* off while deficit features are on. They may hide the dashboard card after acknowledging it. Add the signposting from M10-23. |
| Safety note | Privacy (rule 7) and no self-override. |
| Confidence | Medium. |
| Human still needed? | Yes — seats A6, A4, A1. |

## M09 — Fair Pair

### M09-1 · Challenge mechanic
| Field | Content |
|---|---|
| Item | Opt-in by both partners; relative-effort score capped at the prescription; nothing counted after the first pain report; red flag ends it; scores shown side by side **only when both completed**; no winner field; "stopped" never shown to the partner as a result. |
| Source check | L4. Zhang & Centola (2016, Prev Med Rep 4:453): in a 4-arm RCT (n = 790), online social *comparison* increased class attendance more than social *support*. EDPB Guidelines 03/2022 and the FTC 2022 report on deceptive design (pressure and "nagging" patterns). |
| Evidence summary | Comparison motivates, which is exactly why it needs guardrails. The design already removes the worst patterns (winner, credit for grinding reps, credit after pain). What is left is that the comparison is contingent on completing: the only way to "see how we did" is to finish. |
| AI position | **Agree with conditions.** (a) Make a cooperative summary the default and show it whatever the completion state ("you both trained", shared minutes). (b) Each partner sees their *own* score privately at any time (this answers open question 3: yes). (c) The side-by-side comparison is a second, separate opt-in. (d) Never show a partner's pain pause, and keep "stopped" neutral. |
| Safety note | Removes the finish-to-see incentive (L4). |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6 (with A5 for the score). |

### M09-2 · Set credit cap
| Field | Content |
|---|---|
| Item | `PAIR_CONFIG['score.setCreditCap']` 1. Source: M09 spec, cap chosen by the engineer. |
| Source check | M09 spec rule "never rewards training through pain". |
| Evidence summary | A cap at the prescription means extra reps or load earn nothing. This takes away the incentive to over-reach. |
| AI position | **Agree.** Never raise it above 1. |
| Safety note | Values above 1 would reward over-reaching. |
| Confidence | High. |
| Human still needed? | Yes — seat A6 with A5. |

### M09-3 · Pair pressure denylist
| Field | Content |
|---|---|
| Item | `PAIR_PRESSURE_DENYLIST` (`packages/i18n/src/pair-language.ts`), substring matching with padded spaces. |
| Source check | L4; M13 persona comment ("no leaderboards comparing me to 25-year-olds"). |
| Evidence summary | It covers winner/loser, beat, age wording and "push through". Missing: pace-keeping and letting-down cues, and ranking words. |
| AI position | **Agree with conditions.** Suggested additions: EN "keep up", "can you keep up", "first to", "fastest", "rank", "ranking", "leaderboard", "champion", "don't let your partner down", "let your partner down", "your partner is waiting", "catch up with", "still got it", "for a woman", "like a girl"; FR "suivre le rythme", "tenir le rythme", "classement", "champion", "championne", "le premier", "la première", "ne laisse pas tomber", "laisser tomber ton partenaire", "ton partenaire t'attend", "votre partenaire vous attend", "pour une femme". Note: ' old ' also blocks "years old", which is acceptable because age should not appear in pair copy. |
| Safety note | Proxy only. The mechanic (M09-1) matters more. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6, a native FR editor. |

## Cross-cutting denylists

### X-1 · No-guilt denylist
| Field | Content |
|---|---|
| Item | `NO_GUILT_DENYLIST` (`packages/i18n/src/guilt.ts`), substring matching. |
| Source check | Rule 8; Mathur et al. 2019 ("confirmshaming"); EDPB 03/2022 (emotional steering). |
| Evidence summary | Good coverage of blame and make-up wording. Missing: the typical re-engagement guilt patterns in notifications. |
| AI position | **Agree with conditions.** Add EN "we miss you", "haven't seen you", "where have you been", "don't lose", "don't break", "your streak is at risk", "last chance", "you owe", "comeback", "everyone else"; FR "vous nous manquez", "tu nous manques", "on ne vous a pas vu", "ne perdez pas", "ne cassez pas", "dernière chance", "votre série est en danger", "tout le monde". Because matching is by substring, check each new entry for false positives (e.g. "comeback" inside an exercise name). This list should also be run over the M13 notification templates when they exist. |
| Safety note | Low direct safety impact. Engagement ethics (L8). |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6, a native FR editor. |

### X-2 · Body-shaming denylist
| Field | Content |
|---|---|
| Item | `BODY_SHAMING_DENYLIST` (`packages/i18n/src/body-language.ts`), whole-word matching, "fat" allowed only in "body fat" and "fat loss". |
| Source check | Rule 8; M04 rule "no judgemental language about weight or body shape". |
| Evidence summary | A thorough list. A few body-ideal phrases are missing. |
| AI position | **Agree with conditions.** Add EN "flat stomach", "flat belly", "tone up", "toned", "slim down", "get rid of", "thigh gap", "baby weight", "post-baby body", "shredded", "shred"; FR "perdre du ventre", "ventre plat" (present), "mincir", "affiner", "silhouette de rêve", "kilos de grossesse". Do not block "séchage" automatically: it is the users' own goal word in the spec. A6 should decide whether the app echoes it. |
| Safety note | Low. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6, a native FR editor. |

## M03, M05, M08 copy (A6 scope, light review)

### C-1 · M03 cardio ledger copy
| Field | Content |
|---|---|
| Item | `engine.reason.cardio.ledger.below/within/above`. |
| Source check | Rule 8; WHO 2020 range cited in the copy. |
| Evidence summary | "Every minute counts, at your own pace" and "Rest days are part of training too" are non-pressuring, and "above" is not praised. |
| AI position | **Agree.** |
| Safety note | None. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6. |

### C-2 · M08 post-miss (reflow) copy
| Field | Content |
|---|---|
| Item | `calendar.reflow.*` ("No problem. …"). |
| Source check | Rule 8; M08 "no punitive messaging". |
| Evidence summary | Neutral and forward-looking. The "merged" option (main exercises added to the next session) is a catch-up *mechanic*. Its load is an A3 question, but it should never be described as making up for a miss, and it isn't. |
| AI position | **Agree.** |
| Safety note | A3 to check the volume of merged sessions. |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6 (copy), A3 (merge volume). |

### C-3 · M05 readiness and pain-check copy
| Field | Content |
|---|---|
| Item | Readiness and pain-check copy (`recovery*.ts`). |
| Source check | Not reviewed in detail in this run. |
| Evidence summary | — |
| AI position | **Insufficient evidence** (not reviewed). The only link I checked is that a readiness-based skip should protect the streak (M04-4). |
| Safety note | — |
| Confidence | Low. |
| Human still needed? | Yes — seat A6. |

## M13 — Engagement (spec only; nothing built)

### M13-1 · Notification budget, streak freeze, leaderboards, KPIs
| Field | Content |
|---|---|
| Item | M13 spec: at most one notification a day by default, quiet hours; streak freeze; no public bodyweight or body-shape leaderboards; opt-in social features; KPI "notification opt-out rate < 10 %". |
| Source check | Gollwitzer & Sheeran 2006 (implementation intentions, d ≈ 0.65 across 94 studies) supports plan-based reminders ("after work, Mon/Wed/Fri"). Michie et al. 2011 (COM-B) is a good framework for choosing mechanics. EDPB 03/2022 and FTC 2022 on nagging and obstruction. |
| Evidence summary | The design choices are sound. The **opt-out KPI is a Goodhart risk**: a target of "< 10 % opt-out" rewards making opting out harder or less visible, which is a dark pattern (L8). "No public bodyweight leaderboards" still allows cross-user leaderboards on other metrics, which bring the age and fitness comparison the Mariam persona objects to. |
| AI position | **Agree with conditions.** (a) Make the opt-out rate *monitored, not optimised*, and add a counter-metric (complaints or uninstalls after a notification). (b) No cross-user leaderboards of any kind by default. Group challenges compare each person with their *own* baseline. (c) Notification settings are reachable in one tap from any notification. (d) No notifications about weight, food or missed sessions. (e) Every notification template runs through X-1. |
| Safety note | Dark patterns (L8) and eating-disorder risk (weight or food notifications). |
| Confidence | Medium. |
| Human still needed? | Yes — seat A6, B-seat for L8. |

---

## Tally check

- Agree (12): M10-1, M10-4, M10-5, M10-10, M10-13, M10-17, M10-19, M04-2, M04-3, M09-2, C-1, C-2.
- Agree with conditions (22): M10-2, M10-3, M10-6, M10-7, M10-8, M10-14, M10-15, M10-18, M10-20, M10-21, M10-22, M10-23, M10-24, M10-25, M01-1, M04-1, M04-5, M09-1, M09-3, X-1, X-2, M13-1. (For M10-3, the condition includes reconsidering the sedentary value of 1.2, which I flag as likely unsafe for some users.)
- Disagree (3): M10-9, M10-16, M04-4.
- Insufficient evidence (3): M10-11, M10-12, C-3.

## Sources (URLs; accessed 2026-09-24)

Energy and body weight
- Mifflin MD et al. 1990, AJCN 51:241–247 — https://ajcn.nutrition.org/article/S0002-9165(23)16698-6/fulltext (blocked here; details from search abstract and https://www.scirp.org/reference/referencespapers?referenceid=1207451)
- Frankenfield D et al. 2005, J Am Diet Assoc — https://www.jandonline.org/article/S0002-8223(05)00149-5/abstract
- FAO/WHO/UNU 2004, Human energy requirements — https://www.fao.org/4/y5686e/y5686e00.htm
- EFSA NDA 2013, DRVs for energy, EFSA J 11(1):3005 — https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2013.3005
- Hall KD 2008, Int J Obes 32:573–576 — https://www.nature.com/articles/0803720
- Hall KD et al. 2011, Lancet 378:826–837 — https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(11)60812-X/fulltext
- Burrows TL et al. 2019, validity of dietary assessment vs doubly labelled water (systematic review) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6928130/
- NICE NG246 (2025), Overweight and obesity management: physical activity and diet — https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet

Protein and sport nutrition
- Morton RW et al. 2018, BJSM 52:376–384 — https://pubmed.ncbi.nlm.nih.gov/28698222/ (correction: https://pubmed.ncbi.nlm.nih.gov/32943392/, not read)
- Jäger R et al. 2017, ISSN position stand: protein and exercise — https://pubmed.ncbi.nlm.nih.gov/28642676/
- Thomas DT, Erdman KA, Burke LM 2016, AND/DC/ACSM joint position — https://pubmed.ncbi.nlm.nih.gov/26891166/
- EFSA NDA 2012, DRVs for protein, EFSA J 10(2):2557 — https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2012.2557
- KDIGO 2024 CKD guideline — https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf
- Helms ER, Aragon AA, Fitschen PJ 2014, JISSN — https://pubmed.ncbi.nlm.nih.gov/24864135/
- Garthe I et al. 2011, IJSNEM 21:97 — https://pubmed.ncbi.nlm.nih.gov/21558571/
- Iraki J et al. 2019, Sports 7:154 — https://www.mdpi.com/2075-4663/7/7/154
- Gibson AA et al. 2016, J Nutr Sci — https://www.cambridge.org/core/journals/journal-of-nutritional-science/article/accuracy-of-hands-v-household-measures-as-portion-size-estimation-aids/E7193B701BF92DDF0A043D71EE70C95A

Eating disorders and minors
- NICE NG69 (2017), Eating disorders: recognition and treatment — https://www.nice.org.uk/guidance/ng69/chapter/recommendations
- Golden NH, Schneider M, Wood C 2016, Pediatrics 138(3):e20161649 — https://publications.aap.org/pediatrics/article/138/3/e20161649/52684/Preventing-Obesity-and-Eating-Disorders-in
- Simpson CC, Mazzeo SE 2017, Eating Behaviors 26:89–92 — https://pubmed.ncbi.nlm.nih.gov/28214452/
- Levinson CA et al. 2017, Eating Behaviors 27:14–16 — https://www.researchgate.net/publication/319194941_My_Fitness_Pal_calorie_tracker_usage_in_the_eating_disorders

Food composition
- USDA FoodData Central (CC0 1.0 public domain; attribution requested) — https://fdc.nal.usda.gov/api-guide/ (blocked here; licence statement confirmed via search), dataset record https://data.nal.usda.gov/dataset/fooddata-central-0
- Single-food values via FDC-derived pages: goat https://tools.myfooddata.com/nutrition-facts/175304/wt1 · hummus https://tools.myfooddata.com/nutrition-facts/174289/wt1 · mozzarella https://tools.myfooddata.com/nutrition-facts/170845/wt2 · cassava raw https://tools.myfooddata.com/nutrition-facts/169985/wt1 · chicken breast https://foods.fatsecret.com/calories-nutrition/usda/chicken-breast-meat-(broilers-or-fryers-roasted-cooked)
- FAO/INFOODS Food Composition Table for Western Africa (2019) — https://openknowledge.fao.org/items/f817f8ff-fb99-44d3-ba9e-2168da12e389 (licence to be checked by B3)
- CIQUAL (ANSES) — https://www.anses.fr/en/content/ciqual-nutritional-composition-table (licence to be checked by B3)

Behaviour and design
- Lally P et al. 2010, EJSP 40:998–1009 — https://onlinelibrary.wiley.com/doi/10.1002/ejsp.674
- Silverman J, Barasch A 2023, J Consumer Res 49(6):1095–1117 — https://academic.oup.com/jcr/article-abstract/49/6/1095/6623414
- Gollwitzer PM, Sheeran P 2006, Adv Exp Soc Psychol 38:69–119 — https://www.researchgate.net/publication/37367696_Implementation_Intentions_and_Goal_Achievement_A_Meta-Analysis_of_Effects_and_Processes
- Michie S, van Stralen MM, West R 2011, Implementation Science 6:42 — https://link.springer.com/article/10.1186/1748-5908-6-42
- Zhang J, Centola D et al. 2016, Prev Med Rep 4:453–458 — https://pubmed.ncbi.nlm.nih.gov/27617191/
- EDPB Guidelines 03/2022 on deceptive design patterns (v2, 2023) — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-032022-deceptive-design-patterns-social-media_en
- FTC 2022, Bringing Dark Patterns to Light — https://www.ftc.gov/reports/bringing-dark-patterns-light
- Mathur A et al. 2019, Proc ACM HCI 3(CSCW):81 — https://dl.acm.org/doi/10.1145/3359183
