import {
  addDays,
  adherence,
  aerobicMinutesLedger,
  bodyMetricSeries,
  effectiveWeeks,
  ewmaTrend,
  exerciseHistory,
  ledgerEntriesFrom,
  measurementSeries,
  mondayOf,
  sessionWasTrained,
  sustainedLossEvent,
  trainedExercises,
  trainingAgeOf,
  weeklyHardSets,
  weeklyRate,
  type DateOf,
} from '@fitadapt/engine';
import { ladderLookup, LADDERS, milestonesFor, type MilestoneView } from '@fitadapt/exercise-library';
import {
  MEASUREMENT_SITES,
  type AdherenceStat,
  type AerobicMinutesLedger,
  type ExecutionLog,
  type ExerciseHistoryPoint,
  type ExperienceLevel,
  type GuardrailEvent,
  type IsoDate,
  type MeasurementSite,
  type ProgramRecord,
  type ReflowRecord,
  type SessionHistoryEntry,
  type TrendPoint,
  type WeeklyMuscleSets,
  type WeeklyRate,
} from '@fitadapt/shared';
import { dashboardValue } from '../config/dashboard.config';
import type { StoredBodyMetric, StoredMeasurement } from './progress-store';

/**
 * The dashboard's model, computed on the device from the stored records with
 * the engine's pure analytics (packages/engine `analytics`): nothing here
 * decides a prescription. Charts show a bounded number of points so two
 * years of data render quickly on modest phones. The display limits are
 * config with a source and a validation status (src/config/dashboard.config.ts).
 */
export const DASHBOARD_LIMITS = Object.freeze({
  exercises: dashboardValue('exercises'),
  chartPoints: dashboardValue('chartPoints'),
  bodyWeeks: dashboardValue('bodyWeeks'),
  adherenceDays: dashboardValue('adherenceDays'),
});

export interface DashboardInput {
  readonly history: readonly SessionHistoryEntry[];
  readonly bodyMetrics: readonly StoredBodyMetric[];
  readonly measurements: readonly StoredMeasurement[];
  readonly program: ProgramRecord | null;
  readonly reflows: readonly ReflowRecord[];
  readonly executionLogs: readonly ExecutionLog[];
  readonly experience: ExperienceLevel;
  readonly today: IsoDate;
  readonly dateOf: DateOf;
}

export interface StrengthRow {
  readonly exerciseId: string;
  readonly sessions: number;
  readonly lastDate: IsoDate;
  readonly points: readonly ExerciseHistoryPoint[];
  readonly latest: ExerciseHistoryPoint;
  /** 1-based rung on its ladder and the ladder's length (variant level), or null. */
  readonly variant: { readonly rung: number; readonly steps: number } | null;
}

export interface BodyModel {
  readonly points: readonly TrendPoint[];
  readonly latestTrend: number | null;
  readonly rate: WeeklyRate | null;
  readonly lastBodyFat: number | null;
  readonly weighIns: number;
}

export interface DashboardModel {
  readonly sessionsTrained: number;
  readonly adherence: AdherenceStat | null;
  readonly strength: readonly StrengthRow[];
  readonly volume: readonly WeeklyMuscleSets[];
  readonly milestones: readonly MilestoneView[];
  readonly body: BodyModel;
  readonly measurements: readonly { readonly site: MeasurementSite; readonly valueCm: number; readonly date: IsoDate }[];
  readonly guardrail: GuardrailEvent | null;
  readonly ledger: AerobicMinutesLedger;
}

const ladderSteps = new Map(LADDERS.map((l) => [l.id, l.steps.length]));

function plannedDates(program: ProgramRecord | null, reflows: readonly ReflowRecord[]): IsoDate[] {
  if (!program) return [];
  return effectiveWeeks(program.program, reflows).flatMap((w) => w.sessions.filter((s) => s.state === 'planned' || s.state === 'shifted').map((s) => s.date));
}

export function buildDashboard(input: DashboardInput): DashboardModel {
  const { history, today, dateOf } = input;
  const trained = history.filter(sessionWasTrained);
  // Adherence over the last four weeks of the current program (none without a program).
  let stat: AdherenceStat | null = null;
  if (input.program) {
    const start = input.program.program.startDate;
    const from = [start, addDays(today, -(DASHBOARD_LIMITS.adherenceDays - 1))].sort().at(-1)!;
    if (from <= today) stat = adherence({ planned: plannedDates(input.program, input.reflows), trained: trained.map((h) => dateOf(h.startedAt)), from, to: today });
  }

  const strength: StrengthRow[] = trainedExercises(history, dateOf)
    .slice(0, DASHBOARD_LIMITS.exercises)
    .map((e) => {
      const points = exerciseHistory(history, e.exerciseId, dateOf, ladderLookup).slice(-DASHBOARD_LIMITS.chartPoints);
      const lookup = ladderLookup(e.exerciseId);
      return { ...e, points, latest: points.at(-1)!, variant: lookup ? { rung: lookup.rung + 1, steps: ladderSteps.get(lookup.ladderId)! } : null };
    });

  const volume = weeklyHardSets({ history, dateOf, trainingAge: trainingAgeOf(input.experience), through: today, weeks: 1 });

  const weights = bodyMetricSeries(input.bodyMetrics, 'weight');
  const trend = ewmaTrend(weights);
  const since = addDays(today, -7 * DASHBOARD_LIMITS.bodyWeeks);
  const shown = trend.filter((p) => p.date >= since && p.date <= today);
  const step = Math.max(1, Math.ceil(shown.length / DASHBOARD_LIMITS.chartPoints));
  const sampled = shown.filter((_, i) => (shown.length - 1 - i) % step === 0);
  const bodyFat = bodyMetricSeries(input.bodyMetrics, 'body_fat');

  const measurements = MEASUREMENT_SITES.flatMap((site) => {
    const last = measurementSeries(input.measurements, site).at(-1);
    return last ? [{ site, valueCm: last.value, date: last.date }] : [];
  });

  return {
    sessionsTrained: trained.length,
    adherence: stat,
    strength,
    volume,
    milestones: milestonesFor(history, dateOf, today),
    body: { points: sampled, latestTrend: trend.at(-1)?.trend ?? null, rate: weeklyRate(trend, today), lastBodyFat: bodyFat.at(-1)?.value ?? null, weighIns: weights.length },
    measurements,
    guardrail: sustainedLossEvent(trend, today),
    ledger: aerobicMinutesLedger(ledgerEntriesFrom(input.executionLogs, dateOf), mondayOf(today)),
  };
}
