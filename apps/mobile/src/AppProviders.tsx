import type { Locale, UnitSystem } from '@fitadapt/i18n';
import { I18nProvider } from '@fitadapt/i18n/react';
import type { SyncClient } from '@fitadapt/sync';
import { ThemeProvider } from '@fitadapt/ui';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSettings } from './state/settings';
import { SyncProvider } from './sync/SyncProvider';

export interface AppProvidersProps {
  syncClient: SyncClient;
  initialLocale: Locale;
  initialUnitSystem?: UnitSystem;
  children?: ReactNode;
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

export function AppProviders({ syncClient, initialLocale, initialUnitSystem = 'metric', children }: AppProvidersProps) {
  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={initialLocale} initialUnitSystem={initialUnitSystem}>
        <SyncProvider client={syncClient}>
          <ThemedApp>{children}</ThemedApp>
        </SyncProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
