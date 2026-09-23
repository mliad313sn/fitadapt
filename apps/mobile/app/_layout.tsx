import { resolveLocale } from '@fitadapt/i18n';
import { resolveJurisdiction } from '@fitadapt/privacy';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { AppProviders } from '../src/AppProviders';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { useAgeGate } from '../src/privacy/PrivacyProvider';
import { SqliteKeyValueStore, wipeLocalDatabase } from '../src/storage/app-state';
import { createDeviceSyncClient } from '../src/sync/device';
import { openExpoDatabase } from '../src/sync/expo-db';

/**
 * S7 age gate: until the user has passed it, the only reachable screen is the
 * age gate; once blocked, it stays the only screen.
 */
function GatedStack() {
  const passed = useAgeGate((s) => s.status === 'allowed');
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={passed}>
        <Stack.Screen name="index" />
        <Stack.Screen name="privacy" />
      </Stack.Protected>
      <Stack.Protected guard={!passed}>
        <Stack.Screen name="age-gate" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const app = useMemo(() => {
    const db = openExpoDatabase();
    const kv = new SqliteKeyValueStore(db);
    const locales = getLocales();
    return {
      syncClient: createDeviceSyncClient({ openDatabase: () => db, randomUUID, apiUrl: process.env.EXPO_PUBLIC_API_URL }),
      initialLocale: resolveLocale(locales.map((l) => l.languageTag)),
      privacy: {
        ageGate: createAgeGateStore(kv),
        consents: createConsentStore({ kv, newId: randomUUID, jurisdiction: resolveJurisdiction(locales[0]?.regionCode) }),
        // No privacy client until sign-in exists (M01): export and deletion show a sign-in note.
        wipeLocalData: () => wipeLocalDatabase(db),
      },
    };
  }, []);
  return (
    <AppProviders syncClient={app.syncClient} initialLocale={app.initialLocale} privacy={app.privacy}>
      <StatusBar style="auto" />
      <GatedStack />
    </AppProviders>
  );
}
