import { AdherenceStatSchema, type AdherenceStat, type IsoDate } from '@fitadapt/shared';
import { addDays } from '../program/dates.js';

/**
 * Adherence (M04): planned vs completed sessions, and a streak that counts
 * planned rest days. A day continues the streak when every session planned
 * for it was done, or when nothing was planned (a rest day is part of the
 * plan, not a gap). Only a planned session that did not happen ends a
 * streak; the last day is still in progress, so a planned session not yet
 * done today does not end it. Sessions done on unplanned days are counted as
 * extra and never against the plan. No streak exists without a plan.
 */
export interface AdherenceInput {
  /** Dates of planned sessions (M08 schedule after reflows; one entry per session). */
  readonly planned: readonly IsoDate[];
  /** Dates on which a session was trained (a set done or a cardio block run). */
  readonly trained: readonly IsoDate[];
  readonly from: IsoDate;
  /** Usually today (the user's local calendar). */
  readonly to: IsoDate;
}

function countBy(dates: readonly IsoDate[], from: IsoDate, to: IsoDate): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (const d of dates) if (d >= from && d <= to) out.set(d, (out.get(d) ?? 0) + 1);
  return out;
}

export function adherence({ planned, trained, from, to }: AdherenceInput): AdherenceStat {
  if (to < from) throw new RangeError('to before from');
  const plan = countBy(planned, from, to);
  const done = countBy(trained, from, to);
  let plannedCount = 0;
  let completed = 0;
  let extra = 0;
  let current = 0;
  let longest = 0;
  const hasPlan = plan.size > 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const p = plan.get(day) ?? 0;
    const d = done.get(day) ?? 0;
    const kept = Math.min(p, d);
    plannedCount += p;
    completed += kept;
    extra += Math.max(0, d - p);
    if (!hasPlan) continue;
    if (kept === p) current += 1;
    else if (day === to) {
      // Today is not over: a session still to do neither extends nor ends the streak.
    } else current = 0;
    longest = Math.max(longest, current);
  }
  return AdherenceStatSchema.parse({
    from,
    to,
    planned: plannedCount,
    completed,
    rate: plannedCount === 0 ? null : Math.round((completed / plannedCount) * 1000) / 1000,
    currentStreakDays: current,
    longestStreakDays: longest,
    extra,
  });
}
