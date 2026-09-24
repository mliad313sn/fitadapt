import { evaluateAgeGate, type AgeGateOutcome, type CalendarDate } from '@fitadapt/safety';
import { createStore } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';

export type AgeGateStatus = 'unknown' | 'allowed' | 'blocked';

export interface AgeGateState {
  status: AgeGateStatus;
  /** Checks a date of birth. Only the outcome is stored, never the date. */
  /** FIX-B (MOB-13): `minimumAge` is the jurisdiction's own minimum (it can only raise the S7 floor of 16). */
  submit(birth: CalendarDate, today: CalendarDate, jurisdiction?: string, minimumAge?: number): AgeGateOutcome;
}

const KEY = 'age_gate_status';

/**
 * S7 age gate on the device. A "blocked" outcome is kept, so entering another
 * date right away does not get past it (reinstalling the app does: see
 * docs/status/M17.md, open questions).
 */
export function createAgeGateStore(kv: KeyValueStore) {
  const stored = kv.get(KEY);
  const initial: AgeGateStatus = stored === 'allowed' || stored === 'blocked' ? stored : 'unknown';
  return createStore<AgeGateState>((set, get) => ({
    status: initial,
    submit(birth, today, jurisdiction, minimumAge) {
      if (get().status === 'blocked') return { status: 'blocked', reasonCode: 'safety.s7.under_minimum_age' };
      const outcome = evaluateAgeGate(birth, today, jurisdiction, minimumAge);
      if (outcome.status !== 'invalid') {
        kv.set(KEY, outcome.status);
        set({ status: outcome.status });
      }
      return outcome;
    },
  }));
}

export type AgeGateStore = ReturnType<typeof createAgeGateStore>;

/** Today's date on the device's calendar (the age gate works on local dates). */
export function localToday(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
