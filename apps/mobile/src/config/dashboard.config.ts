import { defineConfig } from '@fitadapt/shared';

/**
 * What the M04 dashboard shows (CLAUDE.md rule 4): display windows and
 * sampling, not training values. Engineering defaults without an external
 * source (docs/adr/ADR-019), awaiting review with the design and PO; the
 * adherence window also changes the rate shown, so seat A3 (S&C coach)
 * should confirm it.
 */
const SOURCE = 'docs/adr/ADR-019-tracking-analytics-and-progress-dashboard.md (engineering default, no external source)';

export const dashboardConfig = defineConfig({
  /** Exercises listed in the strength card (most recently trained first). */
  exercises: { value: 6, unit: 'exercises', source: SOURCE, validated: false },
  /** Points per chart (the most recent), so two years of data render quickly on modest phones. */
  chartPoints: { value: 24, unit: 'points', source: SOURCE, validated: false },
  /** Weeks of weigh-ins shown in the body chart (the trend itself uses every weigh-in). */
  bodyWeeks: { value: 26, unit: 'weeks', source: SOURCE, validated: false },
  /** Days of the adherence window (planned vs done, streak). */
  adherenceDays: { value: 28, unit: 'days', source: SOURCE, validated: false },
});

export const dashboardValue = (key: keyof typeof dashboardConfig) => dashboardConfig[key].value;
