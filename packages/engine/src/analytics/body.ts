import { GuardrailEventSchema, TrendPointSchema, type BodyMetric, type BodyMetricKind, type GuardrailEvent, type IsoDate, type Measurement, type MeasurementSite, type TrendPoint, type WeeklyRate } from '@fitadapt/shared';
import { addDays, daysBetween } from '../program/dates.js';
import { analyticsValue } from './config.js';

/**
 * Body trends (M04): the bodyweight trend is an exponentially weighted moving
 * average over the weigh-ins, its rate of change in % body weight per week,
 * circumference series, and the sustained-loss guardrail that hands off to
 * M10. Pure: records in, numbers out. Body data is optional; with none, every
 * function returns an empty result.
 */

export interface StoredRecord<T> {
  readonly id: string;
  readonly data: T;
}

export interface DatedValue {
  readonly date: IsoDate;
  readonly value: number;
}

/**
 * The entries still in force: a correction replaces the entry it names (a
 * correction with no value removes it). Several entries of one day are
 * averaged. Oldest first.
 */
function effective<T extends { correctionOf: string | null; measuredOn: IsoDate; at: string }>(records: readonly StoredRecord<T>[], valueOf: (d: T) => number | null): DatedValue[] {
  const corrected = new Set(records.map((r) => r.data.correctionOf).filter((id): id is string => id !== null));
  const byDay = new Map<IsoDate, number[]>();
  for (const r of records) {
    if (corrected.has(r.id)) continue;
    const v = valueOf(r.data);
    if (v === null || !Number.isFinite(v)) continue;
    const list = byDay.get(r.data.measuredOn) ?? [];
    list.push(v);
    byDay.set(r.data.measuredOn, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, values]) => ({ date, value: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 }));
}

/** Weigh-ins (or body-fat estimates) in force, one value per day. */
export function bodyMetricSeries(records: readonly StoredRecord<BodyMetric>[], kind: BodyMetricKind): DatedValue[] {
  return effective(
    records.filter((r) => r.data.kind === kind),
    (d) => d.value,
  );
}

/** One circumference site's values in force, one per day. */
export function measurementSeries(records: readonly StoredRecord<Measurement>[], site: MeasurementSite): DatedValue[] {
  return effective(
    records.filter((r) => r.data.site === site),
    (d) => d.valueCm,
  );
}

/**
 * Exponentially weighted moving average, aware of gaps: after d days the new
 * value weighs 1 − (1 − α)^d, so a week without weigh-ins does not freeze the
 * trend and daily weigh-ins are not over-weighted.
 */
export function ewmaTrend(series: readonly DatedValue[], alphaPerDay = analyticsValue('trend.alphaPerDay')): TrendPoint[] {
  if (!(alphaPerDay > 0 && alphaPerDay <= 1)) throw new RangeError('alphaPerDay must be in (0, 1]');
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let last: IsoDate | null = null;
  for (const p of series) {
    if (trend === null || last === null) trend = p.value;
    else {
      const days = Math.max(1, daysBetween(last, p.date));
      const weight = 1 - Math.pow(1 - alphaPerDay, days);
      trend = trend + weight * (p.value - trend);
    }
    last = p.date;
    out.push(TrendPointSchema.parse({ date: p.date, value: p.value, trend: Math.round(trend * 1000) / 1000 }));
  }
  return out;
}

/** The trend on a date: the last trend point on or before it (null before the first weigh-in). */
export function trendOn(trend: readonly TrendPoint[], date: IsoDate): number | null {
  let lo = 0;
  let hi = trend.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (trend[mid]!.date <= date) {
      found = trend[mid]!.trend;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function entriesBetween(trend: readonly TrendPoint[], fromExclusive: IsoDate, toInclusive: IsoDate): number {
  let n = 0;
  for (const p of trend) if (p.date > fromExclusive && p.date <= toInclusive) n += 1;
  return n;
}

/**
 * The rate of change of the trend over the `rate.windowDays` ending on
 * `weekEnd`, in % of the trend at the window's start (negative = loss).
 * Null when the window has fewer than `rate.minEntriesPerWeek` weigh-ins or
 * no trend before it.
 */
export function weeklyRate(trend: readonly TrendPoint[], weekEnd: IsoDate): WeeklyRate | null {
  const window = analyticsValue('rate.windowDays');
  const start = addDays(weekEnd, -window);
  if (entriesBetween(trend, start, weekEnd) < analyticsValue('rate.minEntriesPerWeek')) return null;
  const before = trendOn(trend, start);
  const after = trendOn(trend, weekEnd);
  if (before === null || after === null || before <= 0) return null;
  return { weekEnd, percentPerWeek: Math.round(((after - before) / before) * 100 * 7 / window * 100) / 100 };
}

/** The last `weeks` weekly rates ending on `through` (oldest first); a week without enough data is null. */
export function weeklyRates(trend: readonly TrendPoint[], through: IsoDate, weeks: number): (WeeklyRate | null)[] {
  const window = analyticsValue('rate.windowDays');
  const out: (WeeklyRate | null)[] = [];
  for (let k = Math.max(1, Math.floor(weeks)) - 1; k >= 0; k -= 1) out.push(weeklyRate(trend, addDays(through, -window * k)));
  return out;
}

/**
 * M04 rule: a sustained loss above `guardrail.lossPercentPerWeek` for
 * `guardrail.consecutiveWeeks` consecutive weeks (each with enough
 * weigh-ins) ending on `today` emits the event M10 consumes. Anything else
 * (gain, a slower loss, a week without data) emits nothing.
 */
export function sustainedLossEvent(trend: readonly TrendPoint[], today: IsoDate): GuardrailEvent | null {
  const threshold = analyticsValue('guardrail.lossPercentPerWeek');
  const rates = weeklyRates(trend, today, analyticsValue('guardrail.consecutiveWeeks'));
  if (rates.some((r) => r === null || !(r.percentPerWeek < -threshold))) return null;
  return GuardrailEventSchema.parse({
    kind: 'bodyweight.sustained_loss',
    detectedOn: today,
    weeks: rates,
    thresholdPercentPerWeek: threshold,
    reasonCodes: ['progress.guardrail.sustained_loss'],
  });
}

/** Whether a new guardrail notice is due: an event now, and none handed off within `guardrail.repeatAfterDays`. */
export function guardrailDue(event: GuardrailEvent | null, lastHandedOffOn: IsoDate | null): boolean {
  if (event === null) return false;
  return lastHandedOffOn === null || daysBetween(lastHandedOffOn, event.detectedOn) >= analyticsValue('guardrail.repeatAfterDays');
}
