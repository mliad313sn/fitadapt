import { MilestoneForecastSchema, type Confidence, type IsoDate, type MilestoneForecast, type SessionHistoryEntry } from '@fitadapt/shared';
import { addDays, daysBetween } from '../program/dates.js';
import { sessionValue } from '../config/session.js';
import { analyticsValue } from './config.js';
import { setE1RM, type DateOf } from './strength.js';

/**
 * Milestone forecasts (M04): "roughly when might I reach this?", as a date
 * range with a confidence, never as a promise (L1). The model is a
 * least-squares line through the recent progress points (the last
 * `forecast.windowDays`); the range comes from the slope ± `forecast.intervalZ`
 * standard errors. Every parameter is config, `validated: false` (A5, A3).
 *
 * Two kinds of milestone read the engine's history:
 * - a ladder milestone (e.g. P2's first strict pull-up): progress is the
 *   ladder rung reached plus the share of the rung's top reps done;
 * - a load milestone: the best e1RM (M07 Epley) of an exercise.
 */

export interface ProgressPoint {
  readonly date: IsoDate;
  readonly value: number;
}

export interface ForecastInput {
  readonly milestoneId: string;
  readonly points: readonly ProgressPoint[];
  readonly target: number;
  readonly today: IsoDate;
  /** True when the history already shows the milestone reached (a done set of the target, not a trend). */
  readonly achieved: boolean;
}

interface Fit {
  readonly slope: number;
  readonly intercept: number;
  readonly slopeSe: number;
  readonly r2: number;
}

function fit(points: readonly { x: number; y: number }[]): Fit {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  // Callers pass ≥ forecast.minPoints (> 2) points spread over ≥ forecast.minSpanDays, so sxx > 0.
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const p of points) sse += (p.y - (intercept + slope * p.x)) ** 2;
  const slopeSe = Math.sqrt(sse / (n - 2) / sxx);
  const r2 = syy === 0 ? 0 : Math.max(0, 1 - sse / syy);
  return { slope, intercept, slopeSe, r2 };
}

function confidenceOf(n: number, r2: number): Confidence {
  if (n >= analyticsValue('confidence.highMinPoints') && r2 >= analyticsValue('confidence.highMinR2')) return 'high';
  if (n >= analyticsValue('confidence.mediumMinPoints') && r2 >= analyticsValue('confidence.mediumMinR2')) return 'medium';
  return 'low';
}

const none = (milestoneId: string, status: 'achieved' | 'insufficient_data' | 'no_trend' | 'beyond_horizon', points: number, code: string): MilestoneForecast =>
  MilestoneForecastSchema.parse({ milestoneId, status, estimate: true, earliest: null, latest: null, confidence: null, points, reasonCodes: [code, 'progress.forecast.estimate_only'] });

export function forecastMilestone({ milestoneId, points, target, today, achieved }: ForecastInput): MilestoneForecast {
  const windowStart = addDays(today, -analyticsValue('forecast.windowDays'));
  const recent = points.filter((p) => p.date >= windowStart && p.date <= today && Number.isFinite(p.value));
  if (achieved) return none(milestoneId, 'achieved', recent.length, 'progress.forecast.achieved');
  const span = recent.length > 0 ? daysBetween(recent[0]!.date, recent[recent.length - 1]!.date) : 0;
  if (recent.length < analyticsValue('forecast.minPoints') || span < analyticsValue('forecast.minSpanDays')) {
    return none(milestoneId, 'insufficient_data', recent.length, 'progress.forecast.insufficient_data');
  }
  const xy = recent.map((p) => ({ x: daysBetween(today, p.date), y: p.value }));
  const f = fit(xy);
  const now = f.intercept; // the fitted value today (x = 0)
  const remaining = target - now;
  if (!(f.slope > 0)) return none(milestoneId, 'no_trend', recent.length, 'progress.forecast.no_trend');
  const z = analyticsValue('forecast.intervalZ');
  const horizon = analyticsValue('forecast.horizonDays');
  const likely = remaining <= 0 ? 0 : remaining / f.slope;
  const fast = f.slope + z * f.slopeSe;
  const slow = f.slope - z * f.slopeSe;
  let early = remaining <= 0 ? 0 : remaining / fast;
  let late = slow > 0 ? (remaining <= 0 ? 0 : remaining / slow) : Infinity;
  if (!(likely <= horizon)) return none(milestoneId, 'beyond_horizon', recent.length, 'progress.forecast.beyond_horizon');
  // Never a single day: the range is at least `forecast.minRangeDays` wide, around the likely date.
  const minRange = analyticsValue('forecast.minRangeDays');
  if (late - early < minRange) {
    early = Math.max(0, likely - minRange / 2);
    late = early + minRange;
  }
  const lateCapped = Math.min(late, horizon);
  const earliestOffset = Math.max(1, Math.round(early));
  const earliest = addDays(today, earliestOffset);
  const latest = addDays(today, Math.max(earliestOffset + minRange, Math.round(lateCapped)));
  const confidence = late > horizon ? 'low' : confidenceOf(recent.length, f.r2);
  return MilestoneForecastSchema.parse({
    milestoneId,
    status: 'forecast',
    estimate: true,
    earliest,
    latest,
    confidence,
    points: recent.length,
    reasonCodes: ['progress.forecast.linear_trend', `progress.forecast.confidence.${confidence}`, 'progress.forecast.estimate_only'],
  });
}

/** The rungs of a ladder in order, each a list of equivalent exercises (M06 seed `LADDERS`). */
export type LadderSteps = readonly (readonly string[])[];

/**
 * Ladder progress per session: the highest rung with a done set, plus the
 * share of the rung done, below the next rung (`ladder.maxRungFraction`):
 * reps as a share of the set's top reps, holds as a share of the longest
 * hold M02 prescribes before moving to the next variant
 * (SESSION_CONFIG `hold.maxSeconds`), so a hold that grows from session to
 * session shows as progress. The milestone is reached once a set of the
 * target rung (or above) was done.
 */
export function ladderProgress(history: readonly SessionHistoryEntry[], steps: LadderSteps, dateOf: DateOf): ProgressPoint[] {
  const rungOf = new Map<string, number>();
  steps.forEach((rung, i) => rung.forEach((id) => rungOf.set(id, i)));
  const cap = analyticsValue('ladder.maxRungFraction');
  const out: ProgressPoint[] = [];
  for (const entry of history) {
    let best: number | null = null;
    for (const ex of entry.exercises) {
      const rung = rungOf.get(ex.exerciseId);
      if (rung === undefined) continue;
      const top = ex.target.kind === 'reps' ? ex.target.max : sessionValue('hold.maxSeconds');
      for (const s of ex.performed) {
        if (s.status !== 'done') continue;
        const amount = ex.target.kind === 'reps' ? (s.reps ?? 0) : (s.seconds ?? 0);
        if (amount <= 0) continue;
        const value = rung + Math.min(cap, amount / top);
        if (best === null || value > best) best = value;
      }
    }
    if (best !== null) out.push({ date: dateOf(entry.startedAt), value: Math.round(best * 1000) / 1000 });
  }
  return out;
}

export interface LadderMilestone {
  readonly ladderId: string;
  readonly steps: LadderSteps;
  /** The exercise to reach (e.g. `pull_up`). */
  readonly targetExerciseId: string;
}

/** Forecast for reaching `targetExerciseId` on its ladder (e.g. a first strict pull-up). */
export function forecastLadderMilestone(history: readonly SessionHistoryEntry[], milestone: LadderMilestone, dateOf: DateOf, today: IsoDate): MilestoneForecast {
  const target = milestone.steps.findIndex((rung) => rung.includes(milestone.targetExerciseId));
  if (target < 0) throw new RangeError(`${milestone.targetExerciseId} is not on ladder ${milestone.ladderId}`);
  const points = ladderProgress(history, milestone.steps, dateOf);
  return forecastMilestone({
    milestoneId: `ladder.${milestone.ladderId}:${milestone.targetExerciseId}`,
    points,
    target,
    today,
    achieved: points.some((p) => p.value >= target && p.date <= today),
  });
}

/** Forecast for reaching an e1RM on an exercise (best loaded set of each session, M07 Epley). */
export function forecastLoadMilestone(history: readonly SessionHistoryEntry[], exerciseId: string, targetKg: number, dateOf: DateOf, today: IsoDate): MilestoneForecast {
  const points: ProgressPoint[] = [];
  for (const entry of history) {
    const e = entry.exercises.filter((x) => x.exerciseId === exerciseId).flatMap((x) => x.performed.map(setE1RM)).filter((v): v is number => v !== null);
    if (e.length > 0) points.push({ date: dateOf(entry.startedAt), value: Math.max(...e) });
  }
  return forecastMilestone({
    milestoneId: `e1rm.${exerciseId}:${Math.round(targetKg * 10) / 10}`,
    points,
    target: targetKg,
    today,
    achieved: points.some((p) => p.value >= targetKg && p.date <= today),
  });
}
