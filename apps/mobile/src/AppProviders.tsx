import type { Locale, UnitSystem } from '@fitadapt/i18n';
import { I18nProvider } from '@fitadapt/i18n/react';
import type { SyncClient } from '@fitadapt/sync';
import { ThemeProvider } from '@fitadapt/ui';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createAgeGateStore } from './privacy/age-gate';
import { LibraryProvider } from './library/LibraryProvider';
import type { LibraryStore } from './library/library-store';
import { createConsentStore } from './privacy/consents';
import { PrivacyProvider, type PrivacyProviderProps } from './privacy/PrivacyProvider';
import { useSettings } from './state/settings';
import { MemoryKeyValueStore } from './storage/app-state';
import { SyncProvider } from './sync/SyncProvider';
import type { SessionStore } from './auth/session-store';
import { clock } from './clock';
import { createLegalStore, type LegalStore } from './legal/legal-store';
import { createProfileStore, type ProfileStore } from './profile/profile-store';
import { ProfileProvider } from './profile/ProfileProvider';

export interface AppProvidersProps {
  syncClient: SyncClient;
  initialLocale: Locale;
  initialUnitSystem?: UnitSystem;
  /** Age gate, consent ledger and privacy client; defaults to empty in-memory state (nothing consented). */
  privacy?: Omit<PrivacyProviderProps, 'children'>;
  /** The on-device exercise library (M06); absent in tests of screens that do not use it. */
  library?: LibraryStore;
  /** M01 profile, legal ledgers and session; default to empty in-memory state (nothing accepted, signed out). */
  profile?: ProfileStore;
  legal?: LegalStore;
  session?: SessionStore;
  /** Replaces the plain sync on reconnect (M01: upload the device ledgers first). */
  runSync?: () => Promise<unknown>;
  children?: ReactNode;
}

let fallbackId = 0;
function useDefaultPrivacy(provided?: Omit<PrivacyProviderProps, 'children'>): Omit<PrivacyProviderProps, 'children'> {
  return useMemo(() => {
    if (provided) return provided;
    const kv = new MemoryKeyValueStore();
    return {
      ageGate: createAgeGateStore(kv),
      consents: createConsentStore({ kv, jurisdiction: 'ZZ', newId: () => `00000000-0000-4000-8000-${String(++fallbackId).padStart(12, '0')}` }),
      wipeLocalData: () => kv.data.clear(),
    };
  }, [provided]);
}

function ThemedApp({ children }: { children?: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const gymMode = useSettings((s) => s.gymMode);
  return (
    <ThemeProvider scheme={scheme} gymMode={gymMode}>
      {children}
    </ThemeProvider>
  );
}

function useDefaultM01(syncClient: SyncClient, profile?: ProfileStore, legal?: LegalStore) {
  return useMemo(() => {
    const kv = new MemoryKeyValueStore();
    return {
      profile: profile ?? createProfileStore({ sync: syncClient, kv, now: clock.now }),
      legal: legal ?? createLegalStore({ kv, jurisdiction: 'ZZ', now: clock.now, newId: () => `00000000-0000-4000-8000-${String(++fallbackId).padStart(12, '0')}` }),
    };
  }, [syncClient, profile, legal]);
}

export function AppProviders({ syncClient, initialLocale, initialUnitSystem = 'metric', privacy, library, profile, legal, session, runSync, children }: AppProvidersProps) {
  const privacyProps = useDefaultPrivacy(privacy);
  const m01 = useDefaultM01(syncClient, profile, legal);
  const onSynced = useCallback(() => m01.profile.getState().reload(), [m01]);
  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={initialLocale} initialUnitSystem={initialUnitSystem}>
        <PrivacyProvider {...privacyProps}>
          <SyncProvider client={syncClient} runSync={runSync} onSynced={onSynced}>
            <LibraryProvider store={library ?? null}>
              <ProfileProvider profile={m01.profile} legal={m01.legal} session={session}>
                <ThemedApp>{children}</ThemedApp>
              </ProfileProvider>
            </LibraryProvider>
          </SyncProvider>
        </PrivacyProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
