import { ReadinessCheckSchema, orderChain, type IsoDate, type ReadinessCheck } from '@fitadapt/shared';
import { recoveryValue } from './config.js';

/**
 * M05 readiness (optional 10-second check: sleep, soreness, stress, energy,
 * each 1–5, plus HRV / resting HR from M12 when available). The score is the
 * mean "goodness" of the four answers (sleep and energy: higher is better;
 * soreness and stress: lower is better) on 0–100, lowered when HRV is well
 * below its baseline or resting HR well above it. Below `readiness.lowScore`
 * the day is "reduced" (generateSession: one set fewer per exercise, extra
 * accessories left out, one more rep in reserve).
 *
 * Never blocking: no check, or missing wearable readings, simply mean no
 * adjustment from them. A readiness score never makes a session harder.
 */

export interface ReadinessResult {
  readonly score: number;
  readonly level: 'normal' | 'reduced';
  /** Which parts were used ('check' always; 'hrv' / 'resting_hr' only with both a reading and its baseline). */
  readonly used: readonly ('check' | 'hrv' | 'resting_hr')[];
  readonly reasonCodes: readonly string[];
}

export function readinessFromCheck(raw: ReadinessCheck): ReadinessResult {
  const check = ReadinessCheckSchema.parse(raw);
  const good = (v: number) => (v - 1) / 4;
  const bad = (v: number) => (5 - v) / 4;
  let score = ((good(check.sleep) + bad(check.soreness) + bad(check.stress) + good(check.energy)) / 4) * 100;
  const used: ('check' | 'hrv' | 'resting_hr')[] = ['check'];
  const codes: string[] = [];
  const w = check.wearable;
  if (w && w.hrvMs !== null && w.hrvBaselineMs !== null) {
    used.push('hrv');
    if (w.hrvMs < w.hrvBaselineMs * (1 - recoveryValue('readiness.hrvDropFraction'))) {
      score -= recoveryValue('readiness.hrvPenalty');
      codes.push('readiness.hrv_below_baseline');
    }
  }
  if (w && w.restingHr !== null && w.restingHrBaseline !== null) {
    used.push('resting_hr');
    if (w.restingHr > w.restingHrBaseline + recoveryValue('readiness.restingHrRiseBpm')) {
      score -= recoveryValue('readiness.restingHrPenalty');
      codes.push('readiness.resting_hr_above_baseline');
    }
  }
  if (!used.includes('hrv') && !used.includes('resting_hr')) codes.push('readiness.check_only');
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const level = rounded < recoveryValue('readiness.lowScore') ? 'reduced' : 'normal';
  return { score: rounded, level, used, reasonCodes: [level === 'reduced' ? 'readiness.low' : 'readiness.ok', ...codes] };
}

const LEGACY_AT = '1970-01-01T00:00:00.000Z';

/**
 * The check that counts for a calendar date, or null. ADR-023: a check names
 * the checks of the same day it replaces (`supersedes`, their `checkId`s),
 * so the device clock and the arrival order never decide; checks stored
 * before that are ordered as given (the order recorded). When the day still
 * has several candidates (two devices, a check next to an older unlinked
 * one) it fails closed: the lowest readiness among them.
 */
export function readinessCheckOn(checks: readonly ReadinessCheck[], date: IsoDate): ReadinessCheck | null {
  const day = checks.map((check, position) => ({ check, position })).filter((x) => x.check.date === date);
  const { heads } = orderChain(day, ({ check, position }) => {
    const legacy = check.supersedes === undefined;
    return { id: check.checkId ?? `legacy:${position}`, supersedes: check.supersedes, at: legacy ? LEGACY_AT : check.at, legacyRank: position };
  });
  if (heads.length <= 1) return heads[0]?.check ?? null;
  const scored = heads.map((h) => ({ check: h.check, score: readinessFromCheck(h.check).score }));
  return scored.reduce((a, b) => (b.score <= a.score ? b : a)).check;
}

/** The ids a new check for `date` supersedes: every current head of that day that has an id (ADR-023). */
export function readinessHeadsOn(checks: readonly ReadinessCheck[], date: IsoDate): string[] {
  const day = checks.map((check, position) => ({ check, position })).filter((x) => x.check.date === date);
  return orderChain(day, ({ check, position }) => ({ id: check.checkId ?? `legacy:${position}`, supersedes: check.supersedes, at: check.supersedes === undefined ? LEGACY_AT : check.at, legacyRank: position }))
    .heads.flatMap((h) => (h.check.checkId === undefined ? [] : [h.check.checkId]));
}

/** generateSession's `readiness` for a date: 'reduced' only when that day's check says so; no check → undefined (no adjustment). */
export function readinessLevelOn(checks: readonly ReadinessCheck[], date: IsoDate): 'normal' | 'reduced' | undefined {
  const check = readinessCheckOn(checks, date);
  return check ? readinessFromCheck(check).level : undefined;
}
