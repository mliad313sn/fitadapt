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
import { runAccountSync, createAccountApi, UploadLedger } from '../src/account/account-sync';
import { AppProviders } from '../src/AppProviders';
import { createAuthApi, jsonPost } from '../src/auth/auth-api';
import { createSessionStore, type SessionStore } from '../src/auth/session-store';
import { secureStoreVault } from '../src/auth/vault';
import { clock } from '../src/clock';
import { createLegalStore } from '../src/legal/legal-store';
import { LibraryStore } from '../src/library/library-store';
import { reportError } from '../src/observability';
import { ONBOARDING_STEPS } from '../src/onboarding/steps';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createHttpPrivacyClient } from '../src/privacy/client';
import { createConsentStore } from '../src/privacy/consents';
import { useAgeGate } from '../src/privacy/PrivacyProvider';
import { createProfileStore } from '../src/profile/profile-store';
import { useFirstWorkoutAccess } from '../src/profile/ProfileProvider';
import { SqliteKeyValueStore, wipeLocalDatabase } from '../src/storage/app-state';
import { apiBaseUrl, createDeviceSyncClient } from '../src/sync/device';
import { openExpoDatabase } from '../src/sync/expo-db';
import { createGuardrailInbox } from '../src/nutrition/guardrail-port';
import { createNutritionStore } from '../src/nutrition/nutrition-store';
import { httpPhotoBackupApi } from '../src/progress/photo-backup';
import { expoPhotoFiles, PhotoVault } from '../src/progress/photo-vault';
import { createProgressStore } from '../src/progress/progress-store';
import { secureDeviceKeyStore } from '../src/storage/device-keys';
import { StorageUnavailableScreen } from '../src/screens/StorageUnavailableScreen';
import { createPairStore } from '../src/pair/pair-store';

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
      reportError(new Error(`local database unavailable: ${error instanceof Error ? error.name : 'unknown'}`), { area: 'storage' });
      return { failed: true };
    }
  }, []);
  if ('failed' in storage) return <StorageUnavailableScreen languageTags={getLocales().map((l) => l.languageTag)} />;
  return <AppRoot db={storage.db} />;
}

function AppRoot({ db }: { db: SyncSqliteDatabase }) {
  const app = useMemo(() => {
    const kv = new SqliteKeyValueStore(db);
    const locales = getLocales();
    const jurisdiction = resolveJurisdiction(locales[0]?.regionCode);
    // M06: the exercise library lives in the on-device database (offline); installed or refreshed at start.
    const library = new LibraryStore(db);
    library.install();
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    const post = jsonPost(apiBaseUrl(apiUrl));
    // M01: the session provides access tokens to sync, privacy and the ledger upload (ADR-013).
    const sessionRef: { current?: SessionStore } = {};
    const getAccessToken = () => sessionRef.current!.getState().getAccessToken();
    const syncClient = createDeviceSyncClient({ openDatabase: () => db, randomUUID, apiUrl, getAccessToken });
    const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction });
    const legal = createLegalStore({ kv, newId: randomUUID, now: clock.now, jurisdiction });
    const profile = createProfileStore({ sync: syncClient, kv, now: clock.now });
    // M10: nutrition plans, intake logs and habits (sync records in the encrypted database); it handles every M04 hand-off as it arrives.
    const nutritionStore = createNutritionStore({ sync: syncClient, kv, now: clock.now, newSeed: () => new DataView(getRandomBytes(4).buffer).getUint32(0) >>> 1 });
    // M04: body data (sync records in the encrypted database), the guardrail inbox M10 handles, and the encrypted photo vault.
    const nutrition = createGuardrailInbox(kv, (event) => nutritionStore.getState().receiveGuardrail(event));
    const progress = createProgressStore({ sync: syncClient, kv, now: clock.now, nutrition });
    // M09: a partner on this phone keeps their own ledgers and logs under their own namespace.
    const pair = createPairStore({ kv, newId: randomUUID, now: clock.now, jurisdiction });
    const vault = new PhotoVault({ db, files: expoPhotoFiles(), keys: secureDeviceKeyStore, randomBytes: getRandomBytes, newId: randomUUID, now: clock.now });
    const accountApi = createAccountApi(post, getAccessToken);
    const ledger = new UploadLedger(kv);
    const accountSync = async () => {
      if (sessionRef.current?.getState().status !== 'signed_in') return;
      await runAccountSync({ api: accountApi, ledger, consents: consents.getState().records, acceptances: legal.getState().acceptances, notices: legal.getState().notices, sync: syncClient });
      profile.getState().reload();
      progress.getState().reload();
      nutritionStore.getState().reload();
    };
    const session = createSessionStore({
      api: createAuthApi(post),
      vault: secureStoreVault,
      device: () => ({ id: syncClient.deviceId, platform: platform() }),
      now: clock.now,
      onSignedIn: () => void accountSync().catch((error: unknown) => reportError(error, { area: 'sync' })),
    });
    sessionRef.current = session;
    void session.getState().restore();
    return {
      library,
      syncClient,
      session,
      legal,
      profile,
      accountSync,
      pair,
      nutritionStore,
      privacyClient: createHttpPrivacyClient({ baseUrl: apiBaseUrl(apiUrl), getAccessToken }),
      progress: { progress, nutrition, vault, randomBytes: getRandomBytes },
      photoBackupApi: httpPhotoBackupApi({ baseUrl: apiBaseUrl(apiUrl), getAccessToken }),
      initialLocale: resolveLocale(locales.map((l) => l.languageTag)),
      privacy: {
        ageGate: createAgeGateStore(kv),
        consents,
        wipeLocalData: () => {
          vault.wipe();
          wipeLocalDatabase(db);
          legal.getState().clear();
          profile.getState().reload();
          nutritionStore.getState().reload();
          void session.getState().forget();
        },
      },
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
