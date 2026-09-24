import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore, type StoreApi } from 'zustand';
import { MemoryKeyValueStore } from '../storage/app-state';
import { createCoachAdjustmentStore, type CoachAdjustmentState } from './adjustments';
import type { CoachClient } from './coach-client';

export interface CoachContextValue {
  /** The API client; absent when signed out (the coach then works offline only). */
  readonly client?: CoachClient;
  readonly adjustments: StoreApi<CoachAdjustmentState>;
}

const Ctx = createContext<CoachContextValue | null>(null);

export function CoachProvider({ client, adjustments, children }: { client?: CoachClient; adjustments?: StoreApi<CoachAdjustmentState>; children?: ReactNode }) {
  const store = useMemo(() => adjustments ?? createCoachAdjustmentStore(new MemoryKeyValueStore()), [adjustments]);
  const value = useMemo(() => ({ client, adjustments: store }), [client, store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoach(): CoachContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('must be used inside <CoachProvider>');
  return ctx;
}

export function useCoachAdjustment<T>(selector: (state: CoachAdjustmentState) => T): T {
  return useStore(useCoach().adjustments, selector);
}
