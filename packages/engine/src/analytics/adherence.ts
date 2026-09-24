import { S2_RED_PAIN_SCORE } from '@fitadapt/safety';
import { AdherenceStatSchema, type AdherenceStat, type ExecutionLog, type IsoDate, type ReadinessCheck } from '@fitadapt/shared';
import { addDays } from '../program/dates.js';
import { readinessLevelOn } from '../recovery/readiness.js';
import type { DateOf } from './strength.js';

/**
 * Adherence (M04): planned vs completed sessions, and a streak that counts
 * planned rest days. A day continues the streak when every session planned
 * for it was done, or when nothing was planned (a rest day is part of the
 * plan, not a gap). Only a planned session that did not happen ends a
 * streak; the last day is still in progress, so a planned session not yet
 * done today does not end it. Sessions done on unplanned days are counted as
 * extra and never against the plan. No streak exists without a plan.
 *
 * L4 (docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md, streaks): a
 * day protected by a safety pause is part of the plan too. Its planned
 * sessions are neither kept nor missed (not in the planned count, so the rate
 * never drops for listening to a safety stop), the streak goes on like a rest
 * day, and a session done on it adds nothing (no completed, no extra): the
 * streak never rewards training through a safety stop. The primary figure is
 * the count over the window (the last 28 days on the dashboard), not the streak.
 */
export interface AdherenceInput {
  /** Dates of planned sessions (M08 schedule after reflows; one entry per session). */
  readonly planned: readonly IsoDate[];
  /** Dates on which a session was trained (a set done or a cardio block run). */
  readonly trained: readonly IsoDate[];
  readonly from: IsoDate;
  /** Usually today (the user's local calendar). */
  readonly to: IsoDate;
  /** Days protected by a safety pause (safetyProtectedDays). Required: none is `[]`. */
  readonly protectedDays: readonly IsoDate[];
}

function countBy(dates: readonly IsoDate[], from: IsoDate, to: IsoDate): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (const d of dates) if (d >= from && d <= to) out.set(d, (out.get(d) ?? 0) + 1);
  return out;
}

export function adherence({ planned, trained, from, to, protectedDays }: AdherenceInput): AdherenceStat {
  if (to < from) throw new RangeError('to before from');
  const plan = countBy(planned, from, to);
  const done = countBy(trained, from, to);
  const safe = new Set(protectedDays);
  let plannedCount = 0;
  let completed = 0;
  let extra = 0;
  let current = 0;
  let longest = 0;
  let protectedCount = 0;
  const hasPlan = plan.size > 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (safe.has(day)) {
      // A safety pause: like a planned rest day, whatever was planned or done.
      if ((plan.get(day) ?? 0) > 0) protectedCount += 1;
      if (hasPlan) {
        current += 1;
        longest = Math.max(longest, current);
      }
      continue;
    }
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
    protectedDays: protectedCount,
  });
}

export interface SafetyDayFacts {
  readonly executionLogs: readonly ExecutionLog[];
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly dateOf: DateOf;
  /** Usually today: an S3 lock without an attestation protects every day up to it. */
  readonly to: IsoDate;
}

/**
 * The days a safety pause protects (L4): a red pain report (S2), a session
 * ended for pain or a red flag, a red-flag stop and every day after it until
 * a medical review is attested (S3), and a day whose readiness check reads
 * low. Illness has no record of its own yet (it is reported through readiness).
 * Errs on the side of protecting: a day counted here can never end a streak.
 */
export function safetyProtectedDays({ executionLogs, readinessChecks, dateOf, to }: SafetyDayFacts): IsoDate[] {
  const out = new Set<IsoDate>();
  const attestations = executionLogs.filter((e): e is Extract<ExecutionLog, { kind: 'medical_review_attested' }> => e.kind === 'medical_review_attested').map((e) => e.at);
  for (const e of executionLogs) {
    if (e.kind === 'pain' && e.score >= S2_RED_PAIN_SCORE) out.add(dateOf(e.at));
    if (e.kind === 'ended' && (e.reason === 'pain' || e.reason === 'red_flag')) out.add(dateOf(e.at));
    if (e.kind === 'red_flag') {
      const lifted = attestations.filter((a) => a >= e.at).sort()[0];
      const until = lifted === undefined ? to : dateOf(lifted);
      for (let d = dateOf(e.at); d <= until; d = addDays(d, 1)) out.add(d);
    }
  }
  for (const date of new Set(readinessChecks.map((c) => c.date))) if (readinessLevelOn(readinessChecks, date) === 'reduced') out.add(date);
  return [...out].sort();
}
