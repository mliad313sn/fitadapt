import { resolveLocale } from '@fitadapt/i18n';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { AppProviders } from '../src/AppProviders';
import { createDeviceSyncClient } from '../src/sync/device';
import { openExpoDatabase } from '../src/sync/expo-db';

export default function RootLayout() {
  const syncClient = useMemo(
    () =>
      createDeviceSyncClient({
        openDatabase: openExpoDatabase,
        randomUUID,
        apiUrl: process.env.EXPO_PUBLIC_API_URL,
      }),
    [],
  );
  const initialLocale = useMemo(() => resolveLocale(getLocales().map((l) => l.languageTag)), []);
  return (
    <AppProviders syncClient={syncClient} initialLocale={initialLocale}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
