import { DrizzleLocalStore } from '@fitadapt/sync';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_KEY_NAMES, MemoryDeviceKeyStore, fromHex, getOrCreateKey, secureDeviceKeyStore, toHex } from '../src/storage/device-keys';
import { DatabaseEncryptionUnavailableError, ENCRYPTED_DATABASE_NAME, LEGACY_PLAINTEXT_DATABASE_NAME, openEncryptedDatabase } from '../src/storage/encrypted-db';
import { Database, expoSqliteDouble } from './sqlcipher-double';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * PO requirement for M04 (docs/status/M01.md deviation 11, ADR-006, ADR-020):
 * the device database holds health data and is encrypted at rest. These
 * tests open the real `openEncryptedDatabase` over a SQLCipher-4-compatible
 * engine writing real files, then read the bytes on disk.
 */
const rand = (n: number) => new Uint8Array(randomBytes(n));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encdb-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CANARY = 'CANARY-knee-pain-7-of-10-weight-83.4kg';

function fileContains(path: string, text: string): boolean {
  return readFileSync(path).includes(Buffer.from(text, 'utf8'));
}

describe('device keys (OS keystore)', () => {
  it('creates a random 256-bit key once, keeps it, and replaces a damaged one', () => {
    const store = new MemoryDeviceKeyStore();
    const a = getOrCreateKey(store, 'k', rand);
    expect(a.created).toBe(true);
    expect(a.hex).toMatch(/^[0-9a-f]{64}$/);
    expect(getOrCreateKey(store, 'k', rand)).toEqual({ hex: a.hex, created: false });
    store.set('k', 'not-a-key');
    const b = getOrCreateKey(store, 'k', rand);
    expect(b.created).toBe(true);
    expect(b.hex).not.toBe(a.hex);
    expect(() => getOrCreateKey(new MemoryDeviceKeyStore(), 'k', () => new Uint8Array(16))).toThrow();
    expect(toHex(fromHex(a.hex))).toBe(a.hex);
    expect(() => fromHex('abc')).toThrow();
    store.remove('k');
    expect(store.get('k')).toBeNull();
  });

  it('keeps keys in expo-secure-store, this device only, after first unlock', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as { __items: Map<string, string>; __options: Map<string, unknown> };
    const { hex } = getOrCreateKey(secureDeviceKeyStore, DEVICE_KEY_NAMES.database, rand);
    expect(SecureStore.__items.get(DEVICE_KEY_NAMES.database)).toBe(hex);
    expect(SecureStore.__options.get(DEVICE_KEY_NAMES.database)).toEqual({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });
    expect(secureDeviceKeyStore.get(DEVICE_KEY_NAMES.database)).toBe(hex);
    secureDeviceKeyStore.remove(DEVICE_KEY_NAMES.database);
  });
});

describe('the local database is encrypted at rest (SQLCipher 4)', () => {
  it('stores health data as ciphertext: no SQLite header, no plaintext anywhere in the file', () => {
    const driver = expoSqliteDouble(dir);
    const keys = new MemoryDeviceKeyStore();
    const { db, cipher } = openEncryptedDatabase({ driver, keys, randomBytes: rand });
    expect(cipher).toMatch(/SQLCipher 4 compatible/);
    db.execSync('CREATE TABLE sync_records (collection TEXT, id TEXT, data TEXT)');
    db.execSync(`INSERT INTO sync_records VALUES ('execution_logs', '1', '${JSON.stringify({ kind: 'pain', joint: 'knee', note: CANARY })}')`);
    driver.closeAll();
    const path = join(dir, ENCRYPTED_DATABASE_NAME);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\u0000');
    expect(fileContains(path, CANARY)).toBe(false);
    expect(fileContains(path, 'execution_logs')).toBe(false);
    expect(fileContains(path, 'sync_records')).toBe(false);
    for (const suffix of ['-wal', '-journal']) if (existsSync(path + suffix)) expect(fileContains(path + suffix, CANARY)).toBe(false);
  });

  it('opens only with the keystore key: without it, or with another key, the file is not a database', () => {
    const driver = expoSqliteDouble(dir);
    const keys = new MemoryDeviceKeyStore();
    const { db } = openEncryptedDatabase({ driver, keys, randomBytes: rand });
    db.execSync("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('kept')");
    driver.closeAll();
    const path = join(dir, ENCRYPTED_DATABASE_NAME);
    const noKey = new Database(path);
    expect(() => noKey.prepare('SELECT * FROM t').all()).toThrow(/not a database/);
    noKey.close();
    const wrong = new Database(path);
    wrong.pragma("cipher = 'sqlcipher'");
    wrong.pragma('legacy = 4');
    wrong.exec(`PRAGMA key = "x'${'00'.repeat(32)}'"`);
    expect(() => wrong.prepare('SELECT * FROM t').all()).toThrow(/not a database/);
    wrong.close();
    // Reopened with the same keystore: the data is there.
    const again = expoSqliteDouble(dir);
    const reopened = openEncryptedDatabase({ driver: again, keys, randomBytes: rand });
    expect(reopened.db.getFirstSync<{ x: string }>('SELECT x FROM t')).toEqual({ x: 'kept' });
    again.closeAll();
  });

  it('a database the key no longer opens (keystore reset) is replaced by a new encrypted one, never read in plaintext', () => {
    const first = expoSqliteDouble(dir);
    const { db } = openEncryptedDatabase({ driver: first, keys: new MemoryDeviceKeyStore(), randomBytes: rand });
    db.execSync(`CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('${CANARY}')`);
    first.closeAll();
    const resets: string[] = [];
    const second = expoSqliteDouble(dir);
    const reopened = openEncryptedDatabase({ driver: second, keys: new MemoryDeviceKeyStore(), randomBytes: rand, onReset: (r) => resets.push(r) });
    expect(resets).toEqual(['key_mismatch']);
    expect(reopened.db.getFirstSync<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name = 't'")).toEqual({ n: 0 });
    second.closeAll();
  });

  it('fails closed when the SQLite library has no cipher: nothing is opened for health data', () => {
    const driver = expoSqliteDouble(dir, { cipher: false });
    expect(() => openEncryptedDatabase({ driver, keys: new MemoryDeviceKeyStore(), randomBytes: rand })).toThrow(DatabaseEncryptionUnavailableError);
    driver.closeAll();
  });

  it('migrates the pre-M04 plaintext database into the encrypted one and deletes the plaintext file', () => {
    const legacyPath = join(dir, LEGACY_PLAINTEXT_DATABASE_NAME);
    // The pre-M04 file: plain SQLite (no cipher), written through the same Drizzle driver the app used.
    const plain = expoSqliteDouble(dir, { cipher: false });
    const legacyDb = plain.openDatabaseSync(LEGACY_PLAINTEXT_DATABASE_NAME);
    new DrizzleLocalStore(drizzle(legacyDb as unknown as SQLiteDatabase)).migrate();
    const legacy = legacyDb.raw;
    legacy.exec(`INSERT INTO sync_records (collection, id, data, deleted, updated_at) VALUES ('screenings', 'a', '${JSON.stringify({ note: CANARY })}', 0, '2026-09-01T00:00:00.000Z')`);
    legacy.exec("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_kv VALUES ('age_gate_status', 'allowed')");
    legacy.close();
    expect(fileContains(legacyPath, CANARY)).toBe(true);

    const driver = expoSqliteDouble(dir);
    const { db, migratedTables } = openEncryptedDatabase({ driver, keys: new MemoryDeviceKeyStore(), randomBytes: rand });
    expect(migratedTables).toEqual(expect.arrayContaining(['app_kv', 'sync_outbox', 'sync_records', 'sync_state']));
    expect(db.getFirstSync<{ data: string }>("SELECT data FROM sync_records WHERE id = 'a'")!.data).toContain(CANARY);
    expect(db.getFirstSync<{ value: string }>("SELECT value FROM app_kv WHERE key = 'age_gate_status'")).toEqual({ value: 'allowed' });
    driver.closeAll();
    expect(existsSync(legacyPath)).toBe(false);
    expect(fileContains(join(dir, ENCRYPTED_DATABASE_NAME), CANARY)).toBe(false);

    // Next start: nothing left to migrate; the empty file ATTACH creates is removed again.
    const next = expoSqliteDouble(dir);
    expect(openEncryptedDatabase({ driver: next, keys: new MemoryDeviceKeyStore(), randomBytes: rand, onReset: () => undefined }).migratedTables).toEqual([]);
    next.closeAll();
    expect(existsSync(legacyPath)).toBe(false);
  });

  it('a failed migration rolls back and keeps the plaintext file for the next attempt', () => {
    const legacyPath = join(dir, LEGACY_PLAINTEXT_DATABASE_NAME);
    const legacy = new Database(legacyPath);
    legacy.exec("CREATE TABLE a (x TEXT); INSERT INTO a VALUES ('1'); CREATE TABLE b (y TEXT); INSERT INTO b VALUES ('2')");
    legacy.close();
    const driver = expoSqliteDouble(dir);
    const keys = new MemoryDeviceKeyStore();
    // Table b already exists in the encrypted database with other columns: the copy fails.
    const pre = openEncryptedDatabase({ driver, keys, randomBytes: rand, legacyName: null });
    pre.db.execSync('CREATE TABLE b (y TEXT, z TEXT NOT NULL)');
    driver.closeAll();
    const retry = expoSqliteDouble(dir);
    expect(() => openEncryptedDatabase({ driver: retry, keys, randomBytes: rand })).toThrow();
    retry.closeAll();
    expect(existsSync(legacyPath)).toBe(true);
    const check = expoSqliteDouble(dir);
    const after = openEncryptedDatabase({ driver: check, keys, randomBytes: rand, legacyName: null });
    expect(after.db.getFirstSync<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'")).toEqual({ n: 0 });
    check.closeAll();
  });
});
