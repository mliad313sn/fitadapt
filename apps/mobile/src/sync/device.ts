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
}

function notSignedIn(): never {
  // Sign-in screens arrive with M01; until then sync stays local-only.
  throw new Error('not signed in');
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
    new HttpTransport({ baseUrl: deps.apiUrl ?? 'http://127.0.0.1:3000', getAccessToken: deps.getAccessToken ?? notSignedIn });
  return new SyncClient({ deviceId, store, transport, newId: deps.randomUUID });
}
