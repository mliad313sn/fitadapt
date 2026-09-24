import { defineConfig } from '@fitadapt/shared';

/**
 * M04 tracking and analytics coefficients and thresholds (CLAUDE.md rule 4).
 * Every value is `validated: false`: none has been reviewed by the council.
 * Seats: A5 (exercise physiologist) for the bodyweight trend, the hard-set
 * definition and the forecast model; A3 (S&C coach) for milestone
 * forecasting; A4 (dietitian) with A1 (physician) for the sustained-loss
 * guardrail that hands off to M10.
 *
 * "Spec" values quote docs/specs/M04-tracking-progress-dashboard.md, not
 * checked against any primary source. "Engineering default" means no
 * external source: the engineer chose a conservative value.
 *
 * The weekly hard-set ranges per muscle are M08's (PROGRAM_CONFIG
 * `volume.*`), read, not copied. e1RM is M07's Epley formula
 * (ASSESSMENT_CONFIG). Nothing here changes a prescription: M04 only reads.
 */
const ENG = 'M04 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M04-tracking-progress-dashboard.md';
const FORECAST = `${ENG}; least-squares trend with an interval from the slope's standard error, chosen by the engineer, not a published model`;
const HORIZON =
  'docs/governance/ai-reviews/A3-A5-training-science.md item 75 (AI pre-review, not a professional sign-off: "horizon ≤ min(3 × observed span, 180 days); use a prediction interval"; gains slow down over time, so a line fitted to a few weeks overstates a year ahead — L1 no promise); stricter than the earlier 365 days; seats A5, A3 and counsel (B2) to decide';

/** Version of the M04 analytics rules (trend, rate, guardrail, forecasts). */
export const ANALYTICS_RULES_VERSION = '0.1.0';

export const ANALYTICS_CONFIG = defineConfig({
  // ---- Bodyweight trend (exponentially weighted moving average)
  /** Smoothing per day: after d days without a weigh-in the next entry weighs 1 − (1 − α)^d. */
  'trend.alphaPerDay': { value: 0.1, unit: 'fraction per day', source: `${ENG}; ${SPEC} (Scope: "exponentially weighted moving average") names the method, not the factor`, validated: false },
  /** The rate of change is the change of the trend over this many days, as % of the trend at its start. */
  'rate.windowDays': { value: 7, unit: 'days', source: `${SPEC} (Scope: "rate of change in %BW/week")`, validated: false },
  /** A week's rate is computed only with at least this many weigh-ins in it. */
  'rate.minEntriesPerWeek': { value: 2, unit: 'entries', source: ENG, validated: false },

  // ---- Sustained-loss guardrail (hand-off to M10)
  'guardrail.lossPercentPerWeek': { value: 1, unit: '% body weight per week', source: `${SPEC} (Rules: "Sustained loss > 1% BW/week for 3 weeks triggers a supportive notice and hands off to M10 guardrails"); the same 1 % as the S4 planned-loss ceiling`, validated: false },
  'guardrail.consecutiveWeeks': { value: 3, unit: 'weeks', source: `${SPEC} (Rules: "Sustained loss > 1% BW/week for 3 weeks")`, validated: false },
  /** After a notice, the next one waits this long (the hand-off to M10 is repeated with it). */
  'guardrail.repeatAfterDays': { value: 14, unit: 'days', source: ENG, validated: false },

  // ---- Hard sets (weekly volume per muscle against M08's ranges)
  /** A done working set counts as hard with at most this many reps in reserve (or, unreported, when its target was). */
  'hardSet.maxRir': { value: 4, unit: 'reps in reserve', source: `${ENG}; ${SPEC} (Scope: "Weekly hard sets per muscle group against goal ranges (e.g., roughly 10–20 for hypertrophy, following the dose-response trend in Schoenfeld et al., 2017)") names the measure, the RIR cut-off is the engineer's`, validated: false },

  // ---- Milestone forecasts (a date range with a confidence, never a promise)
  'forecast.windowDays': { value: 84, unit: 'days', source: FORECAST, validated: false },
  'forecast.minPoints': { value: 4, unit: 'sessions', source: FORECAST, validated: false },
  'forecast.minSpanDays': { value: 21, unit: 'days', source: FORECAST, validated: false },
  /** Never a window further than this ahead (A3/A5 #75: was 365). */
  'forecast.horizonDays': { value: 180, unit: 'days', source: HORIZON, validated: false },
  /** … nor further than this many times the span of the points it is fitted on. */
  'forecast.horizonSpanMultiple': { value: 3, unit: '× observed span', source: HORIZON, validated: false },
  /** Width of the range: a prediction band of ± this many residual standard deviations around the line (≈ 80 % under normal errors). */
  'forecast.intervalZ': { value: 1.28, unit: 'standard deviations (prediction interval)', source: `${FORECAST}; a prediction interval (residual scatter included), not the slope's standard error only, per ${'docs/governance/ai-reviews/A3-A5-training-science.md'} item 75`, validated: false },
  'forecast.minRangeDays': { value: 14, unit: 'days', source: FORECAST, validated: false },
  'confidence.highMinPoints': { value: 12, unit: 'sessions', source: FORECAST, validated: false },
  'confidence.highMinR2': { value: 0.7, unit: 'R²', source: FORECAST, validated: false },
  'confidence.mediumMinPoints': { value: 6, unit: 'sessions', source: FORECAST, validated: false },
  'confidence.mediumMinR2': { value: 0.4, unit: 'R²', source: FORECAST, validated: false },
  /** Progress on a ladder rung counts reps up to this share of the rung's top reps (the next rung starts at 1). */
  'ladder.maxRungFraction': { value: 0.99, unit: 'fraction', source: ENG, validated: false },
});

export type AnalyticsConfigKey = keyof typeof ANALYTICS_CONFIG;

export function analyticsValue(key: AnalyticsConfigKey): number {
  return ANALYTICS_CONFIG[key].value;
}
