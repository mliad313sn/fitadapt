import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { clock } from '../clock';
import { MemoryKeyValueStore } from '../storage/app-state';
import { createPairStore, type PairStore, type PairStoreState } from './pair-store';

const PairContext = createContext<PairStore | null>(null);

let fallbackId = 0;

/** M09: the device's pair records (guests' own ledgers and logs, the owner's sharing choices). Defaults to an empty in-memory store. */
export function PairProvider({ store, children }: { store?: PairStore; children?: ReactNode }) {
  const value = useMemo(
    () => store ?? createPairStore({ kv: new MemoryKeyValueStore(), jurisdiction: 'ZZ', now: clock.now, newId: () => `00000000-0000-4000-8000-${String(++fallbackId).padStart(12, '0')}` }),
    [store],
  );
  return <PairContext.Provider value={value}>{children}</PairContext.Provider>;
}

export function usePairStore(): PairStore {
  const store = useContext(PairContext);
  if (!store) throw new Error('must be used inside <PairProvider>');
  return store;
}

export function usePair<T>(selector: (state: PairStoreState) => T): T {
  return useStore(usePairStore(), selector);
}
