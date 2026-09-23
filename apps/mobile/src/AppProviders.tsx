import type { Locale, UnitSystem } from '@fitadapt/i18n';
import { I18nProvider } from '@fitadapt/i18n/react';
import type { SyncClient } from '@fitadapt/sync';
import { ThemeProvider } from '@fitadapt/ui';
import { useMemo, type ReactNode } from 'react';
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

export interface AppProvidersProps {
  syncClient: SyncClient;
  initialLocale: Locale;
  initialUnitSystem?: UnitSystem;
  /** Age gate, consent ledger and privacy client; defaults to empty in-memory state (nothing consented). */
  privacy?: Omit<PrivacyProviderProps, 'children'>;
  /** The on-device exercise library (M06); absent in tests of screens that do not use it. */
  library?: LibraryStore;
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

export function AppProviders({ syncClient, initialLocale, initialUnitSystem = 'metric', privacy, library, children }: AppProvidersProps) {
  const privacyProps = useDefaultPrivacy(privacy);
  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={initialLocale} initialUnitSystem={initialUnitSystem}>
        <PrivacyProvider {...privacyProps}>
          <SyncProvider client={syncClient}>
            <LibraryProvider store={library ?? null}>
              <ThemedApp>{children}</ThemedApp>
            </LibraryProvider>
          </SyncProvider>
        </PrivacyProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
