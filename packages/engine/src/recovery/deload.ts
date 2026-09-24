import { classifyPainReport, type PainReport, type SafetyStopEvent } from '@fitadapt/safety';
import type { DeloadEvent, HistoryExercise, ReadinessCheck, SessionHistoryEntry } from '@fitadapt/shared';
import type { WorkExercise } from '../session/timebox.js';
import { recoveryValue } from './config.js';
import { readinessCheckOn, readinessFromCheck } from './readiness.js';

/**
 * M05 deload engine. Scheduled deloads are M08's deload weeks (the program
 * session already carries them: `scheduledDeloads` / `deloadOn`); this file
 * adds the TRIGGERED ones, each lasting `deload.triggeredDays` (7) from the
 * moment it fires:
 * - amber_weeks: amber (or red) pain on any joint in two different weeks —
 *   two such reports 7–14 days apart;
 * - red_flag: an S3 red flag; it lasts until 7 days after the medical
 *   review is attested (intensity is locked before that anyway);
 * - performance_drop: two sessions running in which most exercises done
 *   before came out more than 5 % below their previous best set;
 * - low_readiness: a low readiness score (readinessFromCheck) on three
 *   calendar days running.
 * A deload never re-triggers on the data that caused an earlier one: after
 * a triggered deload ends, only what happened after its end counts. Pure and
 * deterministic (device and server derive the same decision from the same
 * records); unreadable dates are ignored for triggers (the S3 lock and the
 * S2 flags, which fail closed, do not depend on this).
 */

const DAY = 86_400_000;
const TRIGGER_ORDER = ['red_flag', 'amber_weeks', 'performance_drop', 'low_readiness'] as const;

export interface DeloadFacts {
  /** The engine clock. */
  readonly asOfMs: number;
  /** Pain reports in the order recorded (packages/safety PainReport). */
  readonly painReports: readonly PainReport[];
  /** Red flags and medical-review attestations in the order recorded. */
  readonly safetyStops: readonly SafetyStopEvent[];
  /** Past sessions, oldest first (buildSessionHistory). */
  readonly history: readonly SessionHistoryEntry[];
  /** Readiness checks in the order recorded. */
  readonly readinessChecks: readonly ReadinessCheck[];
}

interface Fired {
  readonly trigger: DeloadEvent['trigger'];
  readonly at: number;
  /** End (exclusive), or null while it cannot end yet. */
  readonly until: number | null;
}

const valid = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

function redFlagTrigger(facts: DeloadFacts, cursor: number): Fired | null {
  let at = Number.POSITIVE_INFINITY;
  let index = -1;
  for (let i = 0; i < facts.safetyStops.length; i++) {
    const e = facts.safetyStops[i]!;
    const t = valid(e.at);
    if (e.kind === 'red_flag' && t !== null && t > cursor && t < at) {
      at = t;
      index = i;
    }
  }
  if (index < 0) return null;
  // The first attestation recorded after the flag and dated after it (the one that can lift the S3 lock).
  const attest = facts.safetyStops.slice(index + 1).find((e) => e.kind === 'medical_review_attested' && (valid(e.at) ?? Number.NEGATIVE_INFINITY) > at);
  return { trigger: 'red_flag', at, until: attest ? valid(attest.at)! + recoveryValue('deload.triggeredDays') * DAY : null };
}

function amberWeeksTrigger(facts: DeloadFacts, cursor: number): Fired | null {
  const times = facts.painReports
    .filter((r) => classifyPainReport(r) !== 'green')
    .map((r) => valid(r.at))
    .filter((t): t is number => t !== null && t > cursor)
    .sort((a, b) => a - b);
  const min = recoveryValue('deload.amberWeeksMinGapDays') * DAY;
  const max = recoveryValue('deload.amberWeeksMaxGapDays') * DAY;
  for (const t of times) {
    if (times.some((t0) => t - t0 >= min && t - t0 <= max)) return { trigger: 'amber_weeks', at: t, until: t + recoveryValue('deload.triggeredDays') * DAY };
  }
  return null;
}

/** The best set of an exercise entry: e1RM-like for loaded sets, reps or seconds otherwise; null when nothing was done. */
function best(e: HistoryExercise): { kind: 'load' | 'reps' | 'seconds'; value: number } | null {
  const done = e.performed.filter((p) => p.status === 'done');
  const loaded = done.filter((p) => p.loadKg !== null && p.loadKg > 0 && p.reps !== null);
  if (loaded.length > 0) return { kind: 'load', value: Math.max(...loaded.map((p) => p.loadKg! * (1 + p.reps! / 30))) };
  const reps = done.filter((p) => p.reps !== null);
  if (reps.length > 0) return { kind: 'reps', value: Math.max(...reps.map((p) => p.reps!)) };
  const secs = done.filter((p) => p.seconds !== null);
  if (secs.length > 0) return { kind: 'seconds', value: Math.max(...secs.map((p) => p.seconds!)) };
  return null;
}

/** Whether a counting session came out below the previous one on most exercises it shares with earlier sessions. */
export function performanceDropped(history: readonly SessionHistoryEntry[], index: number): boolean {
  const session = history[index]!;
  let compared = 0;
  let dropped = 0;
  for (const e of session.exercises) {
    const now = best(e);
    if (!now) continue;
    for (let j = index - 1; j >= 0; j--) {
      const h = history[j]!;
      if (!h.countsForProgression) continue;
      const prev = h.exercises.map((x) => (x.exerciseId === e.exerciseId ? best(x) : null)).find((b) => b !== null && b.kind === now.kind);
      if (!prev) continue;
      compared += 1;
      if (now.value < prev.value * (1 - recoveryValue('deload.performanceDropFraction'))) dropped += 1;
      break;
    }
  }
  return compared > 0 && dropped * 2 > compared;
}

function performanceTrigger(facts: DeloadFacts, cursor: number): Fired | null {
  const needed = recoveryValue('deload.performanceDropSessions');
  let run = 0;
  for (let i = 0; i < facts.history.length; i++) {
    const h = facts.history[i]!;
    const t = valid(h.startedAt);
    if (!h.countsForProgression || t === null || t <= cursor) continue;
    run = performanceDropped(facts.history, i) ? run + 1 : 0;
    if (run >= needed) return { trigger: 'performance_drop', at: t, until: t + recoveryValue('deload.triggeredDays') * DAY };
  }
  return null;
}

const nextDate = (d: string) => new Date(Date.parse(`${d}T00:00:00.000Z`) + DAY).toISOString().slice(0, 10);

function lowReadinessTrigger(facts: DeloadFacts, cursor: number): Fired | null {
  // The check that counts for each date (readinessCheckOn: the chain over ALL checks, fail closed), then only the
  // dates whose counting check is after the cursor. Filtering first (SAF-11) could resurrect a superseded check
  // whose replacement is dated at or before the cursor (a clock moved back).
  const byDate = new Map<string, { low: boolean; at: number }>();
  for (const date of new Set(facts.readinessChecks.map((c) => c.date))) {
    const c = readinessCheckOn(facts.readinessChecks, date)!;
    const t = valid(c.at);
    if (t === null || t <= cursor) continue;
    byDate.set(date, { low: readinessFromCheck(c).level === 'reduced', at: t });
  }
  const dates = [...byDate.keys()].sort();
  const needed = recoveryValue('deload.lowReadinessDays');
  let run = 0;
  let prev: string | null = null;
  let fired: Fired | null = null;
  for (const d of dates) {
    const day = byDate.get(d)!;
    run = day.low ? (prev !== null && nextDate(prev) === d && run > 0 ? run + 1 : 1) : 0;
    prev = d;
    if (run >= needed) {
      fired = { trigger: 'low_readiness', at: day.at, until: day.at + recoveryValue('deload.triggeredDays') * DAY };
      break;
    }
  }
  return fired;
}

/** The triggered deload in force at the engine clock, or null (a scheduled deload week is the program's). */
export function deloadStatus(facts: DeloadFacts): DeloadEvent | null {
  let cursor = Number.NEGATIVE_INFINITY;
  for (let guard = 0; guard < 1000; guard++) {
    const fired = [redFlagTrigger(facts, cursor), amberWeeksTrigger(facts, cursor), performanceTrigger(facts, cursor), lowReadinessTrigger(facts, cursor)]
      .filter((f): f is Fired => f !== null)
      .sort((a, b) => a.at - b.at || TRIGGER_ORDER.indexOf(a.trigger) - TRIGGER_ORDER.indexOf(b.trigger));
    const next = fired[0];
    if (!next || next.at > facts.asOfMs) return null;
    if (next.until === null || facts.asOfMs < next.until) {
      return { trigger: next.trigger, since: new Date(next.at).toISOString(), until: next.until === null ? null : new Date(next.until).toISOString() };
    }
    cursor = next.until;
  }
  /* c8 ignore next */
  return null;
}

const ROLE_RANK = { accessory: 0, secondary: 1, primary: 2 } as const;

/**
 * Triggered deload: the session's sets are cut by `deload.volumeReduction`
 * (−50 %, rounded so at least half the sets stay: −40–50 % from 5 sets up),
 * taking sets from the exercises with the most sets first (accessories, then
 * secondaries, then primaries; later exercises first), keeping ≥ 1 set per
 * exercise while possible, then leaving out accessory and secondary
 * exercises from the end. Never more sets than before; the first exercise
 * always stays.
 */
export function applyTriggeredDeload(work: readonly WorkExercise[]): WorkExercise[] {
  const out = work.map((w) => ({ ...w }));
  const total = out.reduce((s, w) => s + w.sets, 0);
  const keep = Math.max(1, Math.ceil(total * (1 - recoveryValue('deload.volumeReduction'))));
  let current = total;
  while (current > keep) {
    let pick = -1;
    for (let i = 0; i < out.length; i++) {
      const w = out[i]!;
      if (w.sets <= 1) continue;
      const p = pick < 0 ? null : out[pick]!;
      if (!p || w.sets > p.sets || (w.sets === p.sets && (ROLE_RANK[w.role] < ROLE_RANK[p.role] || (ROLE_RANK[w.role] === ROLE_RANK[p.role] && i > pick)))) pick = i;
    }
    if (pick < 0) break;
    out[pick]!.sets -= 1;
    current -= 1;
  }
  while (current > keep) {
    let drop = -1;
    for (let i = out.length - 1; i >= 1; i--) {
      if (out[i]!.role === 'primary') continue;
      if (drop < 0 || ROLE_RANK[out[i]!.role] < ROLE_RANK[out[drop]!.role]) drop = i;
    }
    if (drop < 0) break;
    current -= out[drop]!.sets;
    out.splice(drop, 1);
  }
  return out.map((w) => ({
    ...w,
    exercise: {
      ...w.exercise,
      sets: w.exercise.sets.slice(0, w.sets).map((s) => ({ ...s, reasonCodes: [...new Set([...s.reasonCodes, 'session.deload.sets_reduced'])] })),
    },
  }));
}
