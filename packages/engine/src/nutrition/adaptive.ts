import { NUTRITION_SAFETY_CONFIG } from '@fitadapt/safety';
import type { AdaptiveObservation, IntakeLog, IsoDate, TrendPoint } from '@fitadapt/shared';
import type { StoredRecord } from '../analytics/body.js';
import { trendOn } from '../analytics/body.js';
import { addDays } from '../program/dates.js';
import { nutritionValue } from './config.js';

/**
 * Adaptive expenditure (M10 Scope: "adaptive expenditure updated weekly from
 * bodyweight trend and logged intake"). Energy balance says expenditure ≈
 * intake − (change of body mass × energy density). The observed value is
 * noisy (portion estimates, water), so each weekly update moves only part of
 * the way from the previous estimate and stays within a band around the
 * formula estimate. Pure: records in, numbers out.
 */

export interface DayIntake {
  readonly energyKcal: number;
  readonly proteinG: number;
}

/** Intake per day from the entries in force (a correction replaces the entry it names; `removed` takes it out). */
export function dailyIntake(logs: readonly StoredRecord<IntakeLog>[]): Map<IsoDate, DayIntake> {
  const corrected = new Set(logs.map((l) => l.data.correctionOf).filter((id): id is string => id !== null));
  const days = new Map<IsoDate, DayIntake>();
  for (const { id, data } of logs) {
    if (corrected.has(id) || data.removed) continue;
    const day = days.get(data.loggedOn) ?? { energyKcal: 0, proteinG: 0 };
    days.set(data.loggedOn, { energyKcal: day.energyKcal + data.estimate.energyKcal, proteinG: day.proteinG + data.estimate.proteinG });
  }
  return days;
}

/**
 * The observation of the complete days before `today` (`adaptive.windowDays`):
 * mean intake over the days that count, and the change of the M04 weight
 * trend across the window. Null without a trend at both ends.
 *
 * A4/A6 pre-review (M10-8/9): partly logged days make the observed
 * expenditure look lower (people under-report), which pushes targets down.
 * Only days the user marked complete count when `completeDays` is given, and
 * a day with less than `adaptive.minPlausibleDayKcal` logged never counts.
 */
export function adaptiveObservation(intake: ReadonlyMap<IsoDate, DayIntake>, trend: readonly TrendPoint[], today: IsoDate, completeDays?: ReadonlySet<IsoDate>): AdaptiveObservation | null {
  const windowDays = nutritionValue('adaptive.windowDays');
  const from = addDays(today, -windowDays);
  const to = addDays(today, -1);
  const start = trendOn(trend, from);
  const end = trendOn(trend, to);
  if (start === null || end === null) return null;
  let logged = 0;
  let total = 0;
  for (let d = 0; d < windowDays; d++) {
    const date = addDays(from, d);
    const day = intake.get(date);
    if (day && day.energyKcal >= nutritionValue('adaptive.minPlausibleDayKcal') && (completeDays === undefined || completeDays.has(date))) {
      logged += 1;
      total += day.energyKcal;
    }
  }
  return { from, to, windowDays, loggedDays: logged, meanIntakeKcal: logged > 0 ? Math.round(total / logged) : 0, trendChangeKg: Math.round((end - start) * 1000) / 1000 };
}

export interface ExpenditureEstimate {
  readonly expenditureKcal: number;
  readonly method: 'formula' | 'adaptive';
  readonly reasonCodes: readonly string[];
}

/**
 * The expenditure a target uses: the formula, or the weekly adaptive update
 * when enough days were logged. The band is asymmetric (A4/A6: at most
 * `adaptive.maxDownwardFraction` below the formula, `maxDeviationFraction`
 * above), one update lowers it by at most `maxDecreasePerUpdateFraction`, and
 * a lowered estimate says so (`nutrition.energy.adaptive_lowered`).
 */
export function adaptiveExpenditure(formulaKcal: number, previousKcal: number | null, observation: AdaptiveObservation | null): ExpenditureEstimate {
  const up = nutritionValue('adaptive.maxDeviationFraction');
  const down = nutritionValue('adaptive.maxDownwardFraction');
  const clamp = (v: number) => Math.min(formulaKcal * (1 + up), Math.max(formulaKcal * (1 - down), v));
  const prior = previousKcal === null ? formulaKcal : clamp(previousKcal);
  if (!observation || observation.loggedDays < nutritionValue('adaptive.minLoggedDays') || observation.windowDays <= 0) {
    return { expenditureKcal: prior, method: previousKcal === null ? 'formula' : 'adaptive', reasonCodes: ['nutrition.energy.adaptive_insufficient_data'] };
  }
  const density = NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;
  const observed = observation.meanIntakeKcal - (observation.trendChangeKg / observation.windowDays) * density;
  const blended = clamp(prior + nutritionValue('adaptive.blend') * (observed - prior));
  const next = Math.max(blended, prior * (1 - nutritionValue('adaptive.maxDecreasePerUpdateFraction')));
  return { expenditureKcal: next, method: 'adaptive', reasonCodes: next < prior ? ['nutrition.energy.adaptive', 'nutrition.energy.adaptive_lowered'] : ['nutrition.energy.adaptive'] };
}
