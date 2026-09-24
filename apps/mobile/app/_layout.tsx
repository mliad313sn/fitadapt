import { resolveLocale } from '@fitadapt/i18n';
import { resolveJurisdiction } from '@fitadapt/privacy';
import { getRandomBytes, randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { Platform } from 'react-native';
import { useStore } from 'zustand';
import { AppProviders } from '../src/AppProviders';
import { createAppServices } from '../src/app-services';
import { secureStoreVault } from '../src/auth/vault';
import { clock } from '../src/clock';
import { reportError } from '../src/observability';
import { ONBOARDING_STEPS } from '../src/onboarding/steps';
import { useAgeGate } from '../src/privacy/PrivacyProvider';
import { useFirstWorkoutAccess } from '../src/profile/ProfileProvider';
import { openExpoDatabase } from '../src/sync/expo-db';
import { expoPhotoFiles } from '../src/progress/photo-vault';
import { secureDeviceKeyStore } from '../src/storage/device-keys';
import { StorageUnavailableScreen } from '../src/screens/StorageUnavailableScreen';
import { DatabaseOpenError } from '../src/storage/encrypted-db';

/**
 * S7 age gate: until the user has passed it, the only reachable screen is the
 * age gate; once blocked, it stays the only screen.
 * L2 (M01): the first-workout screen is reachable only once onboarding is
 * complete and the current Terms, Privacy Policy, health-data consent and
 * exercise-risk acknowledgment are accepted. The M07 assessment and the M08
 * calendar and the M02 workout sit behind the same gate.
 */
function GatedStack() {
  const passed = useAgeGate((s) => s.status === 'allowed');
  const workout = useFirstWorkoutAccess().allowed;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={passed}>
        <Stack.Screen name="index" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="library" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="equipment" />
        {/* M04: the dashboard and progress photos read health data only with the consents (fail closed). */}
        <Stack.Screen name="progress" />
        <Stack.Screen name="photos" />
        {ONBOARDING_STEPS.map((step) => (
          <Stack.Screen key={step} name={`onboarding/${step}`} />
        ))}
      </Stack.Protected>
      <Stack.Protected guard={passed && workout}>
        <Stack.Screen name="first-workout" />
        {/* M07: the assessment is a workout activity: same L2 gate as the first workout. */}
        <Stack.Screen name="assessment" />
        {/* M08: the training calendar is a workout activity too. */}
        <Stack.Screen name="calendar" />
        {/* M02: session execution, behind the same L2 gate. */}
        <Stack.Screen name="workout" />
        {/* M09: Fair Pair on one phone; the owner's L2 gate here, the partner's own gate inside the screen. */}
        <Stack.Screen name="pair" />
        {/* M10: nutrition behind the same L2 gate (screening done, Terms, Privacy and health consent accepted); deficit set-up shows its own L3 notice. */}
        <Stack.Screen name="nutrition" />
      </Stack.Protected>
      <Stack.Protected guard={!passed}>
        <Stack.Screen name="age-gate" />
      </Stack.Protected>
    </Stack>
  );
}

const platform = (): 'ios' | 'android' | 'web' => (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web');

/**
 * M04 (ADR-020): the device database is opened encrypted or not at all. When
 * it cannot be (no cipher in the SQLite build, a keystore failure), the app
 * fails closed: it shows why and opens, reads and writes nothing — there is
 * no unencrypted fallback. Only the error type is reported, never data.
 */
export default function RootLayout() {
  const storage = useMemo((): { db: SyncSqliteDatabase } | { failed: true } => {
    try {
      return { db: openExpoDatabase() };
    } catch (error) {
      // MOB-04: the SQLite result name (e.g. SQLITE_BUSY) says why; never data. The file is kept for the next start.
      const code = error instanceof DatabaseOpenError ? ` (${error.code})` : '';
      reportError(new Error(`local database unavailable: ${error instanceof Error ? error.name : 'unknown'}${code}`), { area: 'storage' });
      return { failed: true };
    }
  }, []);
  if ('failed' in storage) return <StorageUnavailableScreen languageTags={getLocales().map((l) => l.languageTag)} />;
  return <AppRoot db={storage.db} />;
}

function AppRoot({ db }: { db: SyncSqliteDatabase }) {
  const app = useMemo(() => {
    const locales = getLocales();
    const services = createAppServices({
      db,
      jurisdiction: resolveJurisdiction(locales[0]?.regionCode),
      initialLocale: resolveLocale(locales.map((l) => l.languageTag)),
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      randomUUID,
      randomBytes: getRandomBytes,
      now: clock.now,
      keys: secureDeviceKeyStore,
      photoFiles: expoPhotoFiles(),
      tokenVault: secureStoreVault,
      platform: platform(),
    });
    void services.session.getState().restore();
    return {
      ...services,
      progress: { progress: services.progress, nutrition: services.nutrition, vault: services.vault, randomBytes: getRandomBytes },
      privacy: { ageGate: services.ageGate, consents: services.consents, wipeLocalData: services.wipeLocalData },
    };
  }, [db]);
  // Export and deletion need a signed-in session (M17 deferred them to M01).
  const signedIn = useStore(app.session, (s) => s.status === 'signed_in');
  const privacy = useMemo(() => ({ ...app.privacy, client: signedIn ? app.privacyClient : undefined }), [app, signedIn]);
  // M04: the encrypted photo backup needs an account; without one no backup client exists at all.
  const progress = useMemo(() => ({ ...app.progress, backupApi: signedIn ? app.photoBackupApi : undefined }), [app, signedIn]);
  return (
    <AppProviders
      syncClient={app.syncClient}
      initialLocale={app.initialLocale}
      privacy={privacy}
      library={app.library}
      profile={app.profile}
      legal={app.legal}
      session={app.session}
      progress={progress}
      runSync={app.accountSync}
      pair={app.pair}
      nutrition={app.nutritionStore}
    >
      <StatusBar style="auto" />
      <GatedStack />
    </AppProviders>
  );
}
