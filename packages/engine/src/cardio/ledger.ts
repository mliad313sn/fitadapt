import { AerobicMinutesLedgerSchema, type AerobicMinutesLedger, type CardioPlan, type ExecutionLog, type IsoDate } from '@fitadapt/shared';
import { addDays } from '../program/dates.js';
import { cardioValue } from './config.js';

/**
 * What a cardio block counted, and the weekly aerobic-minutes ledger
 * (WHO 2020 as cited by the spec: 150–300 moderate-equivalent minutes a week,
 * vigorous minutes counting double). Only moderate and vigorous steps count;
 * warm-up, recoveries and the cool-down are light. The seconds come from the
 * time actually spent in each step (a skipped or stopped step counts only up
 * to where it was left), never more than the step's planned duration.
 */

export interface SegmentTime {
  readonly index: number;
  readonly seconds: number;
}

export interface CardioDone {
  readonly moderateSeconds: number;
  readonly vigorousSeconds: number;
  /** Work steps (work, EMOM minutes, AMRAP, steady) run to their end, of all work steps. */
  readonly completedWork: number;
  readonly totalWork: number;
}

const WORK = new Set(['work', 'emom_minute', 'amrap', 'steady']);

export function cardioDone(plan: CardioPlan, spent: readonly SegmentTime[]): CardioDone {
  const bySegment = new Map<number, number>();
  for (const s of spent) if (Number.isFinite(s.seconds) && s.seconds > 0) bySegment.set(s.index, (bySegment.get(s.index) ?? 0) + s.seconds);
  let moderate = 0;
  let vigorous = 0;
  let completed = 0;
  let total = 0;
  for (const seg of plan.timeline) {
    const seconds = Math.min(seg.durationSeconds, Math.floor(bySegment.get(seg.index) ?? 0));
    if (seg.intensity === 'moderate') moderate += seconds;
    if (seg.intensity === 'vigorous') vigorous += seconds;
    if (WORK.has(seg.kind)) {
      total += 1;
      if (seconds >= seg.durationSeconds) completed += 1;
    }
  }
  return { moderateSeconds: moderate, vigorousSeconds: vigorous, completedWork: completed, totalWork: total };
}

export interface LedgerEntry {
  /** The local calendar date the block was run on. */
  readonly date: IsoDate;
  readonly moderateSeconds: number;
  readonly vigorousSeconds: number;
}

/** Ledger entries from the append-only execution logs (`cardio_done`), dated by the caller's local calendar. */
export function ledgerEntriesFrom(logs: readonly ExecutionLog[], dateOf: (iso: string) => IsoDate): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    if (log.kind !== 'cardio_done') continue;
    // One block per plan: a repeated log (retry) is counted once.
    if (seen.has(log.planId)) continue;
    seen.add(log.planId);
    out.push({ date: dateOf(log.at), moderateSeconds: log.moderateSeconds, vigorousSeconds: log.vigorousSeconds });
  }
  return out;
}

const tenth = (x: number) => Math.round(x * 10) / 10;

/** The week from `weekStart` (7 days) against the WHO 2020 range. */
export function aerobicMinutesLedger(entries: readonly LedgerEntry[], weekStart: IsoDate): AerobicMinutesLedger {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = entries.filter((e) => e.date >= weekStart && e.date <= weekEnd);
  const moderate = inWeek.reduce((s, e) => s + e.moderateSeconds, 0) / 60;
  const vigorous = inWeek.reduce((s, e) => s + e.vigorousSeconds, 0) / 60;
  const equivalent = moderate + cardioValue('who.vigorousFactor') * vigorous;
  const min = cardioValue('who.weeklyModerateMin');
  const max = cardioValue('who.weeklyModerateMax');
  const status = equivalent < min ? 'below' : equivalent > max ? 'above' : 'within';
  return AerobicMinutesLedgerSchema.parse({
    weekStart,
    weekEnd,
    moderateMinutes: tenth(moderate),
    vigorousMinutes: tenth(vigorous),
    equivalentMinutes: tenth(equivalent),
    targetMin: min,
    targetMax: max,
    status,
    sessions: inWeek.length,
    reasonCodes: [`cardio.ledger.${status}`, 'cardio.ledger.vigorous_double', 'cardio.ledger.who_range'],
  });
}
