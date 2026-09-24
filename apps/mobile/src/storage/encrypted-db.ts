import { DEVICE_KEY_NAMES, getOrCreateKey, type DeviceKeyStore } from './device-keys';

/**
 * The on-device database, encrypted at rest (ADR-006, ADR-020).
 *
 * expo-sqlite is built with SQLCipher (config plugin `useSQLCipher: true`,
 * app.json): every page of the database file, its WAL and journal is
 * encrypted with AES-256 (SQLCipher 4 defaults: AES-256-CBC per page with an
 * HMAC-SHA512 per page). The raw 256-bit key comes from the OS keystore and is
 * given to SQLCipher as `PRAGMA key = "x'…'"` before any other statement.
 *
 * Fail closed: if the SQLite library has no cipher (for example a build
 * without the plugin), the database is not opened and nothing is stored. A
 * database the key no longer opens (keystore reset, restored copy) cannot be
 * read by anyone; it is deleted and a new one created (synced records come
 * back from the account; unsynced ones were unreadable anyway).
 *
 * The pre-M04 database (`local.db`, plaintext) is migrated into the
 * encrypted one on first start and then deleted, so no plaintext copy of
 * health data remains.
 */

/** The subset of expo-sqlite's synchronous API used here (a test double implements it over a SQLCipher-compatible engine). */
export interface RawDatabase {
  execSync(source: string): void;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
  closeSync(): void;
}

export interface SqliteDriver<D extends RawDatabase = RawDatabase> {
  openDatabaseSync(name: string): D;
  deleteDatabaseSync(name: string): void;
  /** Directory of the database files (absolute path), for ATTACH. */
  readonly directory: string;
}

export const ENCRYPTED_DATABASE_NAME = 'local-encrypted.db';
export const LEGACY_PLAINTEXT_DATABASE_NAME = 'local.db';

export class DatabaseEncryptionUnavailableError extends Error {
  constructor() {
    super('database encryption is not available in this build');
    this.name = 'DatabaseEncryptionUnavailableError';
  }
}

export interface OpenEncryptedOptions<D extends RawDatabase> {
  readonly driver: SqliteDriver<D>;
  readonly keys: DeviceKeyStore;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly name?: string;
  /** Plaintext database of earlier builds to migrate and delete (null: none). */
  readonly legacyName?: string | null;
  /** Called (without any data) when an unreadable database was replaced. */
  readonly onReset?: (reason: 'key_mismatch') => void;
}

export interface OpenedDatabase<D extends RawDatabase> {
  readonly db: D;
  /** The cipher the engine reports (e.g. "4.7.0 community"): proof the file is encrypted. */
  readonly cipher: string;
  readonly migratedTables: readonly string[];
}

function keyDatabase(db: RawDatabase, hex: string): string {
  // Validated hex only (getOrCreateKey): nothing user-controlled reaches this statement.
  db.execSync(`PRAGMA key = "x'${hex}'";`);
  const cipher = db.getFirstSync<{ cipher_version?: string | null }>('PRAGMA cipher_version;')?.cipher_version ?? '';
  if (!cipher.trim()) throw new DatabaseEncryptionUnavailableError();
  // Reading the schema fails ("file is not a database") when the key does not open the file.
  db.getFirstSync('SELECT count(*) AS n FROM sqlite_master;');
  // Deleted health data is overwritten, not left in free pages.
  db.execSync('PRAGMA secure_delete = ON;');
  return cipher;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (text: string) => `'${text.replace(/'/g, "''")}'`;

function migrateLegacy(db: RawDatabase, driver: SqliteDriver, legacyName: string): string[] {
  const path = `${driver.directory.replace(/\/+$/, '')}/${legacyName}`;
  // KEY '' attaches a plaintext database to the encrypted connection (SQLCipher).
  db.execSync(`ATTACH DATABASE ${quoteLiteral(path)} AS legacy KEY '';`);
  const migrated: string[] = [];
  try {
    const tables: { name: string; sql: string }[] = [];
    for (let i = 0; ; i += 1) {
      const row = db.getFirstSync<{ name: string; sql: string }>("SELECT name, sql FROM legacy.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name LIMIT 1 OFFSET ?;", i);
      if (!row) break;
      tables.push(row);
    }
    if (tables.length > 0) {
      db.execSync('BEGIN;');
      try {
        for (const t of tables) {
          const exists = db.getFirstSync<{ n: number }>("SELECT count(*) AS n FROM main.sqlite_master WHERE type = 'table' AND name = ?;", t.name);
          if (!exists || exists.n === 0) db.execSync(`${t.sql};`);
          db.execSync(`INSERT OR IGNORE INTO main.${quoteIdent(t.name)} SELECT * FROM legacy.${quoteIdent(t.name)};`);
          migrated.push(t.name);
        }
        db.execSync('COMMIT;');
      } catch (error) {
        db.execSync('ROLLBACK;');
        throw error;
      }
    }
  } finally {
    db.execSync('DETACH DATABASE legacy;');
  }
  // The plaintext file (or the empty one ATTACH created) is removed.
  driver.deleteDatabaseSync(legacyName);
  return migrated;
}

export function openEncryptedDatabase<D extends RawDatabase>({ driver, keys, randomBytes, name = ENCRYPTED_DATABASE_NAME, legacyName = LEGACY_PLAINTEXT_DATABASE_NAME, onReset }: OpenEncryptedOptions<D>): OpenedDatabase<D> {
  const { hex } = getOrCreateKey(keys, DEVICE_KEY_NAMES.database, randomBytes);
  let db = driver.openDatabaseSync(name);
  let cipher: string;
  try {
    cipher = keyDatabase(db, hex);
  } catch (error) {
    db.closeSync();
    if (error instanceof DatabaseEncryptionUnavailableError) throw error;
    // The key does not open this file: nobody can read it. Start a new encrypted database.
    driver.deleteDatabaseSync(name);
    onReset?.('key_mismatch');
    db = driver.openDatabaseSync(name);
    cipher = keyDatabase(db, hex);
  }
  const migratedTables = legacyName ? migrateLegacy(db, driver, legacyName) : [];
  return { db, cipher, migratedTables };
}
