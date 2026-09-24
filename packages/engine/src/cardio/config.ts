import { defineConfig } from '@fitadapt/shared';

/**
 * M03 cardio and conditioning coefficients and thresholds (CLAUDE.md rule 4).
 * Every value is `validated: false`: none has been reviewed by the council.
 * Seats: A5 (exercise physiologist) for the heart-rate formulas and zones,
 * A1 (physician) for the zones and the gates, A3 (S&C coach) for interval
 * design (protocols, rounds, reps, rests) and the cue timing.
 *
 * "Spec" values quote docs/specs/M03-cardio-conditioning.md, which cites
 * Tanaka et al. (2001), Karvonen et al. (1957) and the WHO 2020 guidelines
 * (Bull et al. 2020). Those citations were compiled by the drafting
 * assistant and have NOT been checked against the papers (see
 * docs/specs/00-product-vision.md "Evidence references"). "Engineering
 * default" means no external source: the engineer chose a conservative value.
 *
 * The HIIT gate's S1 part (allowHIIT, unresolved flags) is packages/safety
 * `screeningGateCheck`, never configuration.
 */
const ENG = 'M03 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M03-cardio-conditioning.md';
const TANAKA = `${SPEC} (Scope: "HRmax estimated as 208 − 0.7 × age (Tanaka et al., 2001)"); citation compiled by the drafting assistant, not checked against the paper`;
const WHO = `${SPEC} (Scope: "Weekly aerobic target against WHO 2020: 150–300 min moderate or 75–150 min vigorous (vigorous minutes count double)"); Bull FC et al. (2020) as cited by docs/specs/00-product-vision.md, not checked against the guideline`;
const FIRST =
  'docs/governance/ai-reviews/A3-A5-training-science.md item 66 (AI pre-review, not a professional sign-off: "1 block / ≤ 6 rounds for the first interval sessions, increasing only after several completed sessions without red pain or S3 events; keep 3 / 10 as the long-term ceiling"); the number of sessions (3) is the engineer’s reading of "several"; seats A3, A5, A1 to decide';
const ZONES = `${ENG}; heart-rate-reserve bands for light/moderate/vigorous effort chosen by the engineer (the Karvonen method itself is cited by ${SPEC}), not checked against any guideline. The AI pre-reviews (docs/governance/ai-reviews/A3-A5-training-science.md, A1-A2-clinical-safety.md M03-49) point to ACSM 2011 (Garber et al.: moderate 40–59 % HRR, vigorous 60–89 %; the 84 % cap here is more conservative), from search summaries, not checked`;

/** Version of the cardio rules (protocols, gates, zones); the plan's session rules version moves with it. */
export const CARDIO_RULES_VERSION = '0.2.0';

export const CARDIO_CONFIG = defineConfig({
  // ---- Maximum heart rate (Tanaka) and heart-rate reserve (Karvonen)
  'hrMax.intercept': { value: 208, unit: 'bpm', source: TANAKA, validated: false },
  'hrMax.agePerYear': { value: 0.7, unit: 'bpm per year', source: TANAKA, validated: false },
  /** Below this reserve (HRmax − resting HR) the heart-rate method is not used: effort and talk test instead. */
  'hrr.minReserveBpm': { value: 40, unit: 'bpm', source: ENG, validated: false },
  'zone.light.minFraction': { value: 0.3, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  'zone.light.maxFraction': { value: 0.39, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  'zone.moderate.minFraction': { value: 0.4, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  'zone.moderate.maxFraction': { value: 0.59, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  'zone.vigorous.minFraction': { value: 0.6, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  'zone.vigorous.maxFraction': { value: 0.84, unit: 'fraction of HR reserve', source: ZONES, validated: false },
  // ---- Perceived exertion (0–10) per zone, always shown (the fallback without heart-rate data)
  'zone.light.rpeMin': { value: 2, unit: 'RPE 0–10', source: ENG, validated: false },
  'zone.light.rpeMax': { value: 3, unit: 'RPE 0–10', source: ENG, validated: false },
  'zone.moderate.rpeMin': { value: 4, unit: 'RPE 0–10', source: ENG, validated: false },
  'zone.moderate.rpeMax': { value: 6, unit: 'RPE 0–10', source: ENG, validated: false },
  'zone.vigorous.rpeMin': { value: 7, unit: 'RPE 0–10', source: ENG, validated: false },
  'zone.vigorous.rpeMax': { value: 8, unit: 'RPE 0–10', source: ENG, validated: false },

  // ---- Gates
  /** "HIIT/Tabata only when … ≥ 2 weeks of consistent training are logged": the weeks. */
  'hiit.consistentWeeks': { value: 2, unit: 'weeks', source: `${SPEC} (Rules: "≥ 2 weeks of consistent training are logged")`, validated: false },
  /** … and what "consistent" means: logged sessions in each of those weeks. */
  'hiit.minSessionsPerWeek': { value: 2, unit: 'sessions', source: ENG, validated: false },
  /** "Default impact is low for users with … BMI ≥ 35". */
  'impact.lowDefaultBmi': { value: 35, unit: 'kg/m²', source: `${SPEC} (Rules: "Default impact is low for users with knee/ankle/hip flags or BMI ≥ 35 until they opt up")`, validated: false },
  /** Skill ceiling of conditioning movements (0 entry, 1 beginner, 2 intermediate …), under the user's own ceiling. */
  'movement.maxSkillRank': { value: 1, unit: 'skill rank', source: ENG, validated: false },
  'movement.maxInCircuit': { value: 3, unit: 'movements', source: ENG, validated: false },
  'movement.maxInIntervals': { value: 4, unit: 'movements', source: ENG, validated: false },

  // ---- Protocols (interval design: seat A3)
  'tabata.workSeconds': { value: 20, unit: 's', source: `${SPEC} (Scope: "Tabata (20 s/10 s × 8)")`, validated: false },
  'tabata.restSeconds': { value: 10, unit: 's', source: `${SPEC} (Scope: "Tabata (20 s/10 s × 8)")`, validated: false },
  'tabata.rounds': { value: 8, unit: 'rounds', source: `${SPEC} (Scope: "Tabata (20 s/10 s × 8)")`, validated: false },
  'tabata.blockRestSeconds': { value: 60, unit: 's', source: ENG, validated: false },
  'tabata.maxBlocks': { value: 3, unit: 'blocks', source: ENG, validated: false },
  'hiit.workSeconds': { value: 30, unit: 's', source: ENG, validated: false },
  'hiit.recoverSeconds': { value: 60, unit: 's', source: ENG, validated: false },
  'hiit.maxRounds': { value: 10, unit: 'rounds', source: ENG, validated: false },
  // ---- First interval exposures (A3/A5 pre-review #66, stricter): start low, ramp after completed sessions
  /** HIIT and vigorous custom rounds until `hiit.rampCompletedSessions` interval sessions were completed. */
  'hiit.firstExposureMaxRounds': { value: 6, unit: 'rounds', source: FIRST, validated: false },
  /** Tabata blocks until then (the original protocol is a single ~4-minute block). */
  'tabata.firstExposureMaxBlocks': { value: 1, unit: 'blocks', source: FIRST, validated: false },
  /** Interval sessions completed (to the end, no red-flag stop, no red pain) before the long-term ceilings apply. */
  'hiit.rampCompletedSessions': { value: 3, unit: 'sessions', source: FIRST, validated: false },
  'emom.maxMinutes': { value: 20, unit: 'min', source: ENG, validated: false },
  'emom.reps': { value: 8, unit: 'reps', source: ENG, validated: false },
  'amrap.maxMinutes': { value: 20, unit: 'min', source: ENG, validated: false },
  'amrap.reps': { value: 8, unit: 'reps', source: ENG, validated: false },
  /** Easy minutes at the end of a whole cardio session, and of a finisher. */
  'coolDown.sessionSeconds': { value: 180, unit: 's', source: ENG, validated: false },
  'coolDown.finisherSeconds': { value: 60, unit: 's', source: ENG, validated: false },
  /** A main block shorter than this is not built (a cardio session of under ~10 minutes with its warm-up). */
  'session.minMainSeconds': { value: 240, unit: 's', source: ENG, validated: false },

  // ---- Weekly aerobic target (WHO 2020 as cited by the spec)
  'who.weeklyModerateMin': { value: 150, unit: 'min/week', source: WHO, validated: false },
  'who.weeklyModerateMax': { value: 300, unit: 'min/week', source: WHO, validated: false },
  'who.vigorousFactor': { value: 2, unit: 'moderate-equivalent min per vigorous min', source: WHO, validated: false },

  // ---- Eyes-free cues (audio and haptics lead: nobody looks at the screen mid-interval)
  'cues.countdownSeconds': { value: 3, unit: 's', source: ENG, validated: false },
  /** Segments at least this long get a countdown before the next hard step. */
  'cues.countdownMinSegmentSeconds': { value: 8, unit: 's', source: ENG, validated: false },
  'cues.halfwayMinSegmentSeconds': { value: 240, unit: 's', source: ENG, validated: false },
  'cues.minuteLeftMinSegmentSeconds': { value: 180, unit: 's', source: ENG, validated: false },
});

export type CardioConfigKey = keyof typeof CARDIO_CONFIG;
export const cardioValue = (key: CardioConfigKey): number => CARDIO_CONFIG[key].value;
