import { evaluateAgeGate, type AgeGateOutcome, type CalendarDate } from '@fitadapt/safety';
import { createStore } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';

export type AgeGateStatus = 'unknown' | 'allowed' | 'blocked';

export interface AgeGateState {
  status: AgeGateStatus;
  /** Checks a date of birth. Only the outcome is stored, never the date. */
  submit(birth: CalendarDate, today: CalendarDate, jurisdiction?: string): AgeGateOutcome;
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
    submit(birth, today, jurisdiction) {
      if (get().status === 'blocked') return { status: 'blocked', reasonCode: 'safety.s7.under_minimum_age' };
      const outcome = evaluateAgeGate(birth, today, jurisdiction);
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
