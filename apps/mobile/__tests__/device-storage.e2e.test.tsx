import { DrizzleLocalStore } from '@fitadapt/sync';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Index from '../app/index';
import Library from '../app/library';
import Privacy from '../app/privacy';
import { installErrorReporter } from '../src/observability';
import { DEVICE_KEY_NAMES } from '../src/storage/device-keys';
import { ENCRYPTED_DATABASE_NAME, LEGACY_PLAINTEXT_DATABASE_NAME } from '../src/storage/encrypted-db';
import { tr } from './helpers';
import { m01Routes } from './routes';
import { Database, expoSqliteDouble, type DoubleOptions } from './sqlcipher-double';

/**
 * PO requirement for M04: health data at rest on the device is encrypted.
 * Here the WHOLE APP runs over its real storage code path — `openExpoDatabase`
 * → `openEncryptedDatabase` → Drizzle — with expo-sqlite replaced by a
 * SQLCipher-4-compatible engine writing real files (sqlcipher-double.ts; a
 * file it writes opens with the SQLCipher 4.7.0 that expo-sqlite compiles in
 * with `useSQLCipher`, and the reverse: docs/adr/ADR-020, "Evidence") and the
 * OS keystore replaced by the expo-secure-store stand-in (jest.setup.js).
 * The network is down for every test (airplane mode): every fetch fails.
 *
 * What only a phone can prove (the native SQLCipher build, the Keychain /
 * Keystore) is the manual device test in docs/status/M04.md.
 */
let mockDir = '';
let mockOptions: DoubleOptions = {};
let mockLocale = 'en-GB';
let mockDriver: ReturnType<typeof expoSqliteDouble> | null = null;

jest.mock('expo-sqlite', () => ({
  get defaultDatabaseDirectory() {
    return mockDir;
  },
  openDatabaseSync: (name: string) => {
    mockDriver ??= jest.requireActual('./sqlcipher-double').expoSqliteDouble(mockDir, mockOptions);
    return mockDriver!.openDatabaseSync(name);
  },
  deleteDatabaseSync: (name: string) => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) jest.requireActual('node:fs').rmSync(`${mockDir}/${name}${suffix}`, { force: true });
  },
}));
jest.mock('expo-crypto', () => {
  const c = jest.requireActual('node:crypto');
  return { randomUUID: () => c.randomUUID(), getRandomBytes: (n: number) => new Uint8Array(c.randomBytes(n)) };
});
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: mockLocale }] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SecureStore = require('expo-secure-store') as { __items: Map<string, string>; __options: Map<string, unknown>; __setFailure: (error: Error | null) => void };

let fetchSpy: jest.SpyInstance;
const reported: { message: string; area: string }[] = [];
beforeEach(() => {
  mockDir = mkdtempSync(join(tmpdir(), 'm04-app-db-'));
  mockOptions = {};
  mockLocale = 'en-GB';
  mockDriver = null;
  SecureStore.__items.clear();
  SecureStore.__options.clear();
  reported.length = 0;
  installErrorReporter((error, context) => reported.push({ message: error instanceof Error ? error.message : String(error), area: context.area }));
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  SecureStore.__setFailure(null);
  mockDriver?.closeAll();
  fetchSpy.mockRestore();
  installErrorReporter(null);
  rmSync(mockDir, { recursive: true, force: true });
});

const routes = { _layout: RootLayout, index: Index, 'age-gate': AgeGate, privacy: Privacy, library: Library, ...m01Routes };
const dbPath = () => join(mockDir, ENCRYPTED_DATABASE_NAME);
const contains = (path: string, text: string) => readFileSync(path).includes(Buffer.from(text, 'utf8'));

async function passAgeGate() {
  await screen.findByRole('header', { name: 'Before you start' });
  fireEvent.changeText(screen.getByTestId('age-gate-day'), '1');
  fireEvent.changeText(screen.getByTestId('age-gate-month'), '1');
  fireEvent.changeText(screen.getByTestId('age-gate-year'), '1990');
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('header', { name: 'Welcome' });
}

/** Opens the file the app wrote, with the key the app keeps in the keystore, outside the app. */
function readWithKeystoreKey<T>(query: string): T[] {
  mockDriver?.closeAll();
  const hex = SecureStore.__items.get(DEVICE_KEY_NAMES.database)!;
  const db = new Database(dbPath());
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.exec(`PRAGMA key = "x'${hex}'"`);
  try {
    return db.prepare(query).all() as T[];
  } finally {
    db.close();
  }
}

describe('the app stores health data encrypted and works offline', () => {
  it('a body weight logged in airplane mode is shown, and is ciphertext in the file on disk', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await passAgeGate();
    // The database key: 256 random bits in the OS keystore, this device only, after first unlock.
    expect(SecureStore.__items.get(DEVICE_KEY_NAMES.database)).toMatch(/^[0-9a-f]{64}$/);
    expect(SecureStore.__options.get(DEVICE_KEY_NAMES.database)).toEqual({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });

    act(() => router.push('/privacy'));
    fireEvent.press(await screen.findByRole('switch', { name: 'Health data' }));
    act(() => router.push('/progress'));
    fireEvent.changeText(await screen.findByTestId('progress-weight-input'), '83.4');
    fireEvent.press(screen.getByTestId('progress-weight-save'));
    expect((await screen.findByTestId('progress-body-trend')).props.children).toMatch(/83\.4 kg$/);

    screen.unmount();
    const path = dbPath();
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(mockDir, LEGACY_PLAINTEXT_DATABASE_NAME))).toBe(false);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\u0000');
    for (const plain of ['SQLite format 3', 'body_metrics', '"kind":"weight"', '83.4', 'age_gate_status', 'sync_records', 'app_kv', 'consent']) expect({ plain, found: contains(path, plain) }).toEqual({ plain, found: false });
    for (const suffix of ['-wal', '-journal']) if (existsSync(path + suffix)) expect(contains(path + suffix, 'body_metrics')).toBe(false);

    // The data is there, readable only with the keystore key.
    const rows = readWithKeystoreKey<{ data: string }>("SELECT data FROM sync_records WHERE collection = 'body_metrics'");
    expect(rows.map((r) => JSON.parse(r.data))).toEqual([expect.objectContaining({ kind: 'weight', value: 83.4 })]);
    const plainOpen = new Database(path);
    expect(() => plainOpen.prepare('SELECT * FROM sync_records').all()).toThrow(/not a database/);
    plainOpen.close();
    // Airplane mode: nothing could reach the network, and nothing had to.
    for (const [input] of fetchSpy.mock.calls) expect(String(input)).not.toMatch(/body|photo/);
  });

  it('after a restart the same keystore key opens the data again (no re-onboarding)', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await passAgeGate();
    screen.unmount();
    mockDriver?.closeAll();
    mockDriver = null;
    renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
    expect(reported).toEqual([]);
  });

  it('the plaintext database of an earlier version is moved into the encrypted one and deleted', async () => {
    // What a pre-M04 install left: plain SQLite `local.db`, written by the same Drizzle store.
    const plain = expoSqliteDouble(mockDir, { cipher: false });
    const legacyDb = plain.openDatabaseSync(LEGACY_PLAINTEXT_DATABASE_NAME);
    new DrizzleLocalStore(drizzle(legacyDb as unknown as SQLiteDatabase)).migrate();
    legacyDb.raw.exec("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_kv VALUES ('age_gate_status', 'allowed')");
    legacyDb.raw.exec(`INSERT INTO sync_records (collection, id, data, deleted, updated_at) VALUES ('body_metrics', '7d1b3c1e-8f0a-4c1e-9b1a-1f2e3d4c5b6a', '{"note":"LEGACY-CANARY-71.9"}', 0, '2026-09-01T00:00:00.000Z')`);
    plain.closeAll();
    expect(contains(join(mockDir, LEGACY_PLAINTEXT_DATABASE_NAME), 'LEGACY-CANARY-71.9')).toBe(true);

    renderRouter(routes, { initialUrl: '/' });
    // The age-gate outcome came across: the app opens on Welcome, not on the age gate.
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
    screen.unmount();
    expect(existsSync(join(mockDir, LEGACY_PLAINTEXT_DATABASE_NAME))).toBe(false);
    expect(contains(dbPath(), 'LEGACY-CANARY-71.9')).toBe(false);
    expect(readWithKeystoreKey<{ data: string }>("SELECT data FROM sync_records WHERE collection = 'body_metrics'")).toEqual([{ data: '{"note":"LEGACY-CANARY-71.9"}' }]);
  });
});

describe('fail closed: without encryption nothing is opened or stored', () => {
  it('a SQLite library without a cipher: the app explains, stores nothing and calls nothing (EN)', async () => {
    mockOptions = { cipher: false };
    renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: tr('en').t('storage.unavailable.title') })).toBeTruthy();
    expect(screen.getByText(tr('en').t('storage.unavailable.body'))).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Before you start' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Welcome' })).toBeNull();
    expect(reported).toEqual([{ message: 'local database unavailable: DatabaseEncryptionUnavailableError', area: 'storage' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    screen.unmount();
    mockDriver?.closeAll();
    // No table, no row: nothing was written unencrypted (or at all).
    if (existsSync(dbPath())) {
      const db = new Database(dbPath());
      expect(db.prepare('SELECT count(*) AS n FROM sqlite_master').get()).toEqual({ n: 0 });
      db.close();
    }
    expect(existsSync(join(mockDir, LEGACY_PLAINTEXT_DATABASE_NAME))).toBe(false);
  });

  it('a keystore failure: the same, in French, and the legacy plaintext file is left untouched for a later start', async () => {
    mockLocale = 'fr-FR';
    const plain = expoSqliteDouble(mockDir, { cipher: false });
    plain.openDatabaseSync(LEGACY_PLAINTEXT_DATABASE_NAME).raw.exec("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_kv VALUES ('age_gate_status', 'allowed')");
    plain.closeAll();
    SecureStore.__setFailure(new Error('User interaction is not allowed.'));
    renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: tr('fr').t('storage.unavailable.title') })).toBeTruthy();
    expect(screen.getByText(tr('fr').t('storage.unavailable.action'))).toBeTruthy();
    expect(reported).toEqual([{ message: 'local database unavailable: Error', area: 'storage' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(dbPath())).toBe(false);
    expect(existsSync(join(mockDir, LEGACY_PLAINTEXT_DATABASE_NAME))).toBe(true);
  });

  it('a database the keystore key no longer opens is replaced, never read without the key; only the reason is reported', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await passAgeGate();
    screen.unmount();
    mockDriver?.closeAll();
    mockDriver = null;
    // The keystore lost the key (for example a restore onto a new phone): the old file cannot be opened by anyone.
    SecureStore.__items.clear();
    renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: 'Before you start' })).toBeTruthy();
    expect(reported).toEqual([{ message: 'local database reset: key_mismatch', area: 'storage' }]);
  });
});
