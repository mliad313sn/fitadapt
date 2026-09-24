import {
  DrizzleLocalStore,
  HttpTransport,
  SyncClient,
  type SyncSqliteDatabase,
  type SyncTransport,
} from '@fitadapt/sync';

const DEVICE_ID_KEY = 'device_id';

export interface DeviceSyncDeps {
  /** Opens the on-device SQLite database through Drizzle (expo-sqlite in the app). */
  openDatabase: () => SyncSqliteDatabase;
  randomUUID: () => string;
  /** Defaults to an HTTP transport against apiUrl. */
  transport?: SyncTransport;
  apiUrl?: string;
  getAccessToken?: () => string | Promise<string>;
  /** Defaults to React Native's __DEV__. */
  isDevelopment?: boolean;
  /** Tests: the fetch of the HTTP transport (defaults to the global fetch). */
  fetch?: typeof fetch;
}

function notSignedIn(): never {
  // Sign-in screens arrive with M01; until then sync stays local-only.
  throw new Error('not signed in');
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2']);

/**
 * TLS only (MASVS-NETWORK-1). Plain HTTP is accepted for a loopback address in
 * development builds only; anything else must be https.
 */
export function assertSecureApiUrl(url: string, isDevelopment: boolean): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return url;
  if (isDevelopment && parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return url;
  throw new Error('API URL must use https');
}

declare const __DEV__: boolean | undefined;
const isDevelopmentBuild = () => typeof __DEV__ !== 'undefined' && __DEV__ === true;

/** The API base URL the app talks to (sync, sign-in, privacy, legal), https-only outside local development. */
export function apiBaseUrl(apiUrl?: string, isDevelopment: boolean = isDevelopmentBuild()): string {
  return assertSecureApiUrl(apiUrl ?? 'http://127.0.0.1:3000', isDevelopment);
}

/** Builds the local-first sync client: SQLite store, persistent device id, HTTP transport. */
export function createDeviceSyncClient(deps: DeviceSyncDeps): SyncClient {
  const store = new DrizzleLocalStore(deps.openDatabase());
  store.migrate();
  const deviceId = store.transaction((tx) => {
    const existing = tx.getState(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = deps.randomUUID();
    tx.setState(DEVICE_ID_KEY, id);
    return id;
  });
  const transport =
    deps.transport ??
    new HttpTransport({
      baseUrl: apiBaseUrl(deps.apiUrl, deps.isDevelopment ?? isDevelopmentBuild()),
      getAccessToken: deps.getAccessToken ?? notSignedIn,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  return new SyncClient({ deviceId, store, transport, newId: deps.randomUUID });
}
