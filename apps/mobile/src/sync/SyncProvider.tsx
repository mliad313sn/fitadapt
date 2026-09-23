import NetInfo from '@react-native-community/netinfo';
import type { SyncClient } from '@fitadapt/sync';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reportError } from '../observability';

interface SyncContextValue {
  client: SyncClient;
  pendingCount: number;
  /** Re-reads the outbox size (call after local writes). */
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ client, children }: { client: SyncClient; children?: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(() => client.pendingCount());
  const refresh = useCallback(() => setPendingCount(client.pendingCount()), [client]);

  useEffect(() => {
    // Push the outbox whenever connectivity comes back (offline-first, ADR-002).
    return NetInfo.addEventListener((state) => {
      client
        .handleConnectivityChange(state.isConnected === true)
        .catch((error: unknown) => reportError(error, { area: 'sync' }))
        .finally(refresh);
    });
  }, [client, refresh]);

  const value = useMemo(() => ({ client, pendingCount, refresh }), [client, pendingCount, refresh]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}
