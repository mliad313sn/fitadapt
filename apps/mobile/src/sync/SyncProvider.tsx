import NetInfo from '@react-native-community/netinfo';
import type { SyncClient } from '@fitadapt/sync';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reportError } from '../observability';

interface SyncContextValue {
  client: SyncClient;
  pendingCount: number;
  /** Changes the server refused for good; their records were removed from the device (PKG-03). */
  rejectedCount: number;
  /** Re-reads the outbox size (call after local writes). */
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export interface SyncProviderProps {
  client: SyncClient;
  /** Runs instead of the plain sync when connectivity returns (M01: device ledgers first, then the outbox). */
  runSync?: () => Promise<unknown>;
  /** Called after each sync attempt (e.g. to re-read pulled records). */
  onSynced?: () => void;
  children?: ReactNode;
}

export function SyncProvider({ client, runSync, onSynced, children }: SyncProviderProps) {
  const [pendingCount, setPendingCount] = useState(() => client.pendingCount());
  const [rejectedCount, setRejectedCount] = useState(() => client.rejectedCount());
  const refresh = useCallback(() => {
    setPendingCount(client.pendingCount());
    setRejectedCount(client.rejectedCount());
  }, [client]);

  useEffect(() => {
    // Push the outbox whenever connectivity comes back (offline-first, ADR-002).
    return NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      const run = runSync && online ? runSync() : client.handleConnectivityChange(online);
      run
        .catch((error: unknown) => reportError(error, { area: 'sync' }))
        .finally(() => {
          refresh();
          onSynced?.();
        });
    });
  }, [client, refresh, runSync, onSynced]);

  const value = useMemo(() => ({ client, pendingCount, rejectedCount, refresh }), [client, pendingCount, rejectedCount, refresh]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}
