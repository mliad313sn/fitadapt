import type { Locale } from '@fitadapt/i18n';
import type { DeviceInfo, Jurisdiction } from '@fitadapt/shared';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { AccountBinding } from './account/account-binding';
import { createAccountApi, runAccountSync, UploadLedger } from './account/account-sync';
import { createAuthApi, jsonPost } from './auth/auth-api';
import { createSessionStore, type SessionStore } from './auth/session-store';
import type { TokenVault } from './auth/vault';
import { createCoachAdjustmentStore } from './coach/adjustments';
import { createHttpCoachClient } from './coach/coach-client';
import { createLegalStore } from './legal/legal-store';
import { LibraryStore } from './library/library-store';
import { createGuardrailInbox } from './nutrition/guardrail-port';
import { createNutritionStore } from './nutrition/nutrition-store';
import { reportError } from './observability';
import { createPairStore } from './pair/pair-store';
import { createAgeGateStore } from './privacy/age-gate';
import { createHttpPrivacyClient } from './privacy/client';
import { createConsentStore } from './privacy/consents';
import { createProfileStore } from './profile/profile-store';
import { httpPhotoBackupApi } from './progress/photo-backup';
import { PhotoVault, type PhotoFiles } from './progress/photo-vault';
import { reportPhotoErasure } from './progress/ProgressProvider';
import { createProgressStore } from './progress/progress-store';
import { createServerLockApi, refreshServerLock } from './safety/server-lock';
import { SqliteKeyValueStore, wipeLocalDatabase } from './storage/app-state';
import type { DeviceKeyStore } from './storage/device-keys';
import { apiBaseUrl, createDeviceSyncClient } from './sync/device';

export interface AppServicesDeps {
  readonly db: SyncSqliteDatabase;
  readonly jurisdiction: Jurisdiction;
  readonly initialLocale: Locale;
  readonly apiUrl?: string;
  readonly randomUUID: () => string;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly now: () => Date;
  readonly keys: DeviceKeyStore;
  readonly photoFiles: PhotoFiles;
  readonly tokenVault: TokenVault;
  readonly platform: DeviceInfo['platform'];
  /** FIX-B: the app version and native build, recorded with every acceptance (never personal data). */
  readonly appBuild?: string;
  /** Tests: the HTTP fetch the API clients use (defaults to the global fetch). */
  readonly fetch?: typeof fetch;
}

/**
 * Every store and client of the app over one on-device database (what
 * AppRoot mounts), built in one place so the whole local data lifecycle —
 * in particular the account wipe — can be tested end to end.
 */
export function createAppServices({ db, jurisdiction, initialLocale, apiUrl, randomUUID, randomBytes, now, keys, photoFiles, tokenVault, platform, appBuild, fetch: doFetch }: AppServicesDeps) {
  const kv = new SqliteKeyValueStore(db);
  // M06: the exercise library lives in the on-device database (offline); installed or refreshed at start.
  const library = new LibraryStore(db);
  library.install();
  const post = jsonPost(apiBaseUrl(apiUrl), doFetch);
  // M01: the session provides access tokens to sync, privacy and the ledger upload (ADR-013).
  const sessionRef: { current?: SessionStore } = {};
  const getAccessToken = () => sessionRef.current!.getState().getAccessToken();
  const syncClient = createDeviceSyncClient({ openDatabase: () => db, randomUUID, apiUrl, getAccessToken, ...(doFetch ? { fetch: doFetch } : {}) });
  // FIX-B (B pre-review §1.5 item 1): the country the user confirmed ("Where do you live?") wins over the device locale;
  // the legal store keeps it, and consents follow it.
  const legal = createLegalStore({ kv, newId: randomUUID, now, jurisdiction, ...(appBuild ? { appBuild } : {}) });
  const consents = createConsentStore({ kv, newId: randomUUID, now, jurisdiction, getJurisdiction: () => legal.getState().jurisdiction });
  const profile = createProfileStore({ sync: syncClient, kv, now });
  // M10: nutrition plans, intake logs and habits (sync records in the encrypted database); it handles every M04 hand-off as it arrives.
  const nutritionStore = createNutritionStore({ sync: syncClient, kv, now, newSeed: () => new DataView(randomBytes(4).buffer).getUint32(0) >>> 1 });
  // M04: body data (sync records in the encrypted database), the guardrail inbox M10 handles, and the encrypted photo vault.
  const nutrition = createGuardrailInbox(kv, (event) => nutritionStore.getState().receiveGuardrail(event));
  const progress = createProgressStore({ sync: syncClient, kv, now, nutrition });
  // M09: a partner on this phone keeps their own ledgers and logs under their own namespace.
  const pair = createPairStore({ kv, newId: randomUUID, now, jurisdiction });
  const vault = new PhotoVault({ db, files: photoFiles, keys, randomBytes, newId: randomUUID, now });
  const ageGate = createAgeGateStore(kv);
  // M11: today's adjustments the user chose from the coach's engine proposals (device kv).
  const coachAdjustments = createCoachAdjustmentStore(kv);
  // MOB-07: the device data, and the record of what was uploaded, belong to one account.
  const binding = new AccountBinding(kv);
  const accountApi = createAccountApi(post, getAccessToken);
  const fetchServerLock = createServerLockApi({ baseUrl: apiBaseUrl(apiUrl), getAccessToken, ...(doFetch ? { fetch: doFetch } : {}) });
  const ledger = new UploadLedger(kv, () => binding.boundTo());
  const accountSync = async () => {
    if (sessionRef.current?.getState().status !== 'signed_in') return;
    await runAccountSync({ api: accountApi, ledger, consents: consents.getState().records, acceptances: legal.getState().acceptances, notices: legal.getState().notices, sync: syncClient });
    // MOB-08 × FIX-D: online, the S3 lock the server retains (after the push, so an attestation just uploaded counts).
    await refreshServerLock(fetchServerLock, (lock) => profile.getState().receiveServerLock(lock), (error) => reportError(error, { area: 'sync' }));
    profile.getState().reload();
    progress.getState().reload();
    nutritionStore.getState().reload();
  };
  const session = createSessionStore({
    api: createAuthApi(post),
    vault: tokenVault,
    device: () => ({ id: syncClient.deviceId, platform }),
    now,
    onSignedIn: () => void accountSync().catch((error: unknown) => reportError(error, { area: 'sync' })),
    claimAccount: (accountId) => binding.claim(accountId),
  });
  sessionRef.current = session;

  /**
   * MOB-01: erases the account's data on this device (after an account
   * deletion, or "delete this phone's data") AND resets every in-memory store
   * built from it, so no later ordinary action (a sharing choice, a draft
   * edit, a new partner) can write the deleted data back. The photo key's
   * erasure and the session's end are awaited (MOB-14).
   */
  const wipeLocalData = async (): Promise<void> => {
    const photos = reportPhotoErasure(vault.wipe());
    wipeLocalDatabase(db);
    consents.getState().clear();
    legal.getState().clear();
    profile.getState().reset();
    progress.getState().reset();
    nutritionStore.getState().reload();
    pair.getState().reset();
    coachAdjustments.getState().clear();
    await Promise.all([photos, session.getState().forget()]);
  };

  return {
    kv,
    db,
    library,
    syncClient,
    session,
    consents,
    legal,
    profile,
    progress,
    nutrition,
    nutritionStore,
    pair,
    vault,
    ageGate,
    binding,
    accountSync,
    wipeLocalData,
    initialLocale,
    privacyClient: createHttpPrivacyClient({ baseUrl: apiBaseUrl(apiUrl), getAccessToken }),
    photoBackupApi: httpPhotoBackupApi({ baseUrl: apiBaseUrl(apiUrl), getAccessToken }),
    // M11: the coach's API client (the model runs behind the API; the app holds no provider key) and today's adjustments.
    coachClient: createHttpCoachClient({ baseUrl: apiBaseUrl(apiUrl), getAccessToken, ...(doFetch ? { fetch: doFetch } : {}) }),
    coachAdjustments,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
