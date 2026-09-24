import type { IsoDate } from '@fitadapt/shared';
import { createStore, type StoreApi } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';

/**
 * A change the coach's engine proposed for today and the user chose to use
 * (M11): the minutes available or a lighter day. The workout screen builds
 * today's input with it, so the plan the user starts is the engine's own
 * again (and the server re-derives it as usual). Only for the day it was
 * made; never a load, set or reserve.
 */
export interface CoachAdjustment {
  readonly date: IsoDate;
  readonly minutes?: number;
  readonly readiness?: 'reduced';
}

export interface CoachAdjustmentState {
  readonly adjustment: CoachAdjustment | null;
  apply(adjustment: CoachAdjustment): void;
  clear(): void;
}

const KEY = 'coach.adjustment';

export function createCoachAdjustmentStore(kv: KeyValueStore): StoreApi<CoachAdjustmentState> {
  const load = (): CoachAdjustment | null => {
    try {
      const raw = kv.get(KEY);
      return raw ? (JSON.parse(raw) as CoachAdjustment) : null;
    } catch {
      return null;
    }
  };
  return createStore<CoachAdjustmentState>((set) => ({
    adjustment: load(),
    apply(adjustment) {
      kv.set(KEY, JSON.stringify(adjustment));
      set({ adjustment });
    },
    clear() {
      kv.remove(KEY);
      set({ adjustment: null });
    },
  }));
}

/** The adjustment in force today (an older one is ignored). */
export function adjustmentFor(adjustment: CoachAdjustment | null, today: IsoDate): CoachAdjustment | null {
  return adjustment && adjustment.date === today ? adjustment : null;
}
