import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { clock } from '../clock';
import type { GuardrailInbox } from '../nutrition/guardrail-port';
import { usePrivacy } from '../privacy/PrivacyProvider';
import { expoProgressDeviceIo, type ProgressDeviceIo } from './device-io';
import { PhotoBackup, type PhotoBackupApi } from './photo-backup';
import type { PhotoVault, WipeOutcome } from './photo-vault';
import { reportError } from '../observability';
import type { ProgressState, ProgressStore } from './progress-store';

export interface ProgressContextValue {
  readonly progress: ProgressStore;
  readonly nutrition: GuardrailInbox;
  /** Encrypted photo storage; null where photos are not available (screen tests without it). */
  readonly vault: PhotoVault | null;
  /** The backup service client; absent while signed out (the backup needs an account). */
  readonly backupApi?: PhotoBackupApi;
  readonly io: ProgressDeviceIo;
  readonly randomBytes: (n: number) => Uint8Array;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

/** The photo key could not be confirmed deleted from the keystore (MOB-14). Carries no data. */
export class PhotoKeyErasureError extends Error {
  constructor() {
    super('photo key erasure not confirmed');
    this.name = 'PhotoKeyErasureError';
  }
}

/** Awaits a vault erasure and reports (without data) when the key deletion was not confirmed. Resolves to whether it was. */
export async function reportPhotoErasure(erasure: Promise<WipeOutcome>): Promise<boolean> {
  try {
    const { keyErased } = await erasure;
    if (!keyErased) reportError(new PhotoKeyErasureError(), { area: 'photos' });
    return keyErased;
  } catch (error) {
    reportError(error, { area: 'photos' });
    return false;
  }
}

export interface ProgressProviderProps extends Omit<ProgressContextValue, 'io'> {
  readonly io?: ProgressDeviceIo;
  readonly children?: ReactNode;
}

/**
 * M04 on the device. Withdrawing the photos consent deletes every photo, its
 * key and the backup choice at once (the server deletes the uploaded copies
 * in the withdrawal transaction).
 */
export function ProgressProvider({ progress, nutrition, vault, backupApi, io = expoProgressDeviceIo, randomBytes, children }: ProgressProviderProps) {
  const { consents } = usePrivacy();
  useEffect(
    () =>
      consents.subscribe((state, previous) => {
        for (const record of state.records.slice(previous.records.length)) {
          if (record.dataType === 'photos' && record.decision === 'withdrawn') {
            // MOB-14: files and metadata go at once; crypto-erasure of the key is awaited and a failure reported (no data).
            if (vault) void reportPhotoErasure(vault.wipe());
            progress.getState().setPhotoBackupEnabled(false);
          }
        }
      }),
    [consents, vault, progress],
  );
  const value = useMemo(() => ({ progress, nutrition, vault, backupApi, io, randomBytes }), [progress, nutrition, vault, backupApi, io, randomBytes]);
  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgressContext(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('must be used inside <ProgressProvider>');
  return ctx;
}

export function useProgress<T>(selector: (state: ProgressState) => T): T {
  return useStore(useProgressContext().progress, selector);
}

/** The backup (vault + account), or null while it cannot run. */
export function usePhotoBackup(): PhotoBackup | null {
  const { vault, backupApi, randomBytes } = useProgressContext();
  return useMemo(() => (vault && backupApi ? new PhotoBackup({ vault, api: backupApi, randomBytes, now: clock.now }) : null), [vault, backupApi, randomBytes]);
}
