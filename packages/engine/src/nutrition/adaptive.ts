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
 * mean intake over the days with a log, and the change of the M04 weight
 * trend across the window. Null without a trend at both ends.
 */
export function adaptiveObservation(intake: ReadonlyMap<IsoDate, DayIntake>, trend: readonly TrendPoint[], today: IsoDate): AdaptiveObservation | null {
  const windowDays = nutritionValue('adaptive.windowDays');
  const from = addDays(today, -windowDays);
  const to = addDays(today, -1);
  const start = trendOn(trend, from);
  const end = trendOn(trend, to);
  if (start === null || end === null) return null;
  let logged = 0;
  let total = 0;
  for (let d = 0; d < windowDays; d++) {
    const day = intake.get(addDays(from, d));
    if (day && day.energyKcal > 0) {
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

/** The expenditure a target uses: the formula, or the weekly adaptive update when enough days were logged. */
export function adaptiveExpenditure(formulaKcal: number, previousKcal: number | null, observation: AdaptiveObservation | null): ExpenditureEstimate {
  const dev = nutritionValue('adaptive.maxDeviationFraction');
  const clamp = (v: number) => Math.min(formulaKcal * (1 + dev), Math.max(formulaKcal * (1 - dev), v));
  const prior = previousKcal === null ? formulaKcal : clamp(previousKcal);
  if (!observation || observation.loggedDays < nutritionValue('adaptive.minLoggedDays') || observation.windowDays <= 0) {
    return { expenditureKcal: prior, method: previousKcal === null ? 'formula' : 'adaptive', reasonCodes: ['nutrition.energy.adaptive_insufficient_data'] };
  }
  const density = NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;
  const observed = observation.meanIntakeKcal - (observation.trendChangeKg / observation.windowDays) * density;
  const next = clamp(prior + nutritionValue('adaptive.blend') * (observed - prior));
  return { expenditureKcal: next, method: 'adaptive', reasonCodes: ['nutrition.energy.adaptive'] };
}
