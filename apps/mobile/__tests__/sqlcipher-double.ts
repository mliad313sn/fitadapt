import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test double of expo-sqlite's synchronous API (the subset the app and
 * drizzle-orm/expo-sqlite use) over a real, file-backed SQLCipher-compatible
 * engine: better-sqlite3-multiple-ciphers (SQLite3 Multiple Ciphers, MIT) in
 * its SQLCipher 4 mode (`cipher=sqlcipher`, `legacy=4`). A file written here
 * is byte-compatible with the SQLCipher 4.7 community build that expo-sqlite
 * compiles in with `useSQLCipher` (checked both ways, ADR-020), so the tests
 * exercise the real key handling and inspect the real bytes on disk.
 *
 * `cipher: false` stands for a SQLite library without a cipher (a build
 * without the config plugin): `PRAGMA key` is ignored and `PRAGMA
 * cipher_version` returns nothing, as with plain SQLite.
 */
/** The part of better-sqlite3's API used here (its bundled types are not reachable through its package "exports"). */
export interface BetterStatement {
  readonly reader: boolean;
  raw(on: boolean): BetterStatement;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}
export interface BetterDatabase {
  readonly open: boolean;
  prepare(source: string): BetterStatement;
  exec(source: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): void;
}
export type BetterDatabaseConstructor = new (path: string) => BetterDatabase;

export const Database = jest.requireActual('better-sqlite3-multiple-ciphers') as BetterDatabaseConstructor;

export interface DoubleOptions {
  readonly cipher?: boolean;
}

class StatementDouble {
  constructor(private readonly st: BetterStatement) {}
  executeSync(params: unknown[] = []) {
    if (this.st.reader) {
      const rows = this.st.raw(false).all(...params) as Record<string, unknown>[];
      return { changes: 0, lastInsertRowId: 0, getAllSync: () => rows, getFirstSync: () => rows[0] ?? null };
    }
    const r = this.st.run(...params);
    return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid), getAllSync: () => [], getFirstSync: () => null };
  }
  executeForRawResultSync(params: unknown[] = []) {
    const rows = this.st.reader ? (this.st.raw(true).all(...params) as unknown[][]) : (this.st.run(...params), []);
    return { getAllSync: () => rows, getFirstSync: () => rows[0] ?? null };
  }
  finalizeSync() {}
}

export class DatabaseDouble {
  readonly raw: BetterDatabase;
  constructor(
    readonly path: string,
    private readonly options: DoubleOptions,
  ) {
    this.raw = new Database(path);
    if (options.cipher !== false) {
      this.raw.pragma("cipher = 'sqlcipher'");
      this.raw.pragma('legacy = 4');
    }
  }
  execSync(source: string) {
    if (this.options.cipher === false && /^\s*PRAGMA\s+key\b/i.test(source)) return;
    this.raw.exec(source);
  }
  getFirstSync<T>(source: string, ...params: unknown[]): T | null {
    if (/^\s*PRAGMA\s+cipher_version\s*;?\s*$/i.test(source)) {
      if (this.options.cipher === false) return null;
      const v = this.raw.prepare('SELECT sqlite3mc_version() AS v').get() as { v: string };
      return { cipher_version: `${v.v} (SQLCipher 4 compatible)` } as T;
    }
    const st = this.raw.prepare(source);
    if (!st.reader) {
      st.run(...params);
      return null;
    }
    return (st.get(...params) as T | undefined) ?? null;
  }
  prepareSync(source: string) {
    return new StatementDouble(this.raw.prepare(source));
  }
  closeSync() {
    if (this.raw.open) this.raw.close();
  }
}

export function expoSqliteDouble(directory: string, options: DoubleOptions = {}) {
  const opened: DatabaseDouble[] = [];
  return {
    opened,
    defaultDatabaseDirectory: directory,
    directory,
    openDatabaseSync(name: string) {
      const db = new DatabaseDouble(join(directory, name), options);
      opened.push(db);
      return db;
    },
    deleteDatabaseSync(name: string) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(join(directory, `${name}${suffix}`), { force: true });
    },
    closeAll() {
      for (const db of opened) db.closeSync();
    },
  };
}
