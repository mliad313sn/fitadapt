import { normaliseSearchText, seedLibrary, type ExerciseLibrary } from '@fitadapt/exercise-library';
import { createTranslator, type Locale } from '@fitadapt/i18n';
import { CustomExerciseSchema, type CustomExercise, type EquipmentId, type Exercise, type MovementPattern, type MuscleId } from '@fitadapt/shared';
import type { SyncSqliteDatabase } from '@fitadapt/sync';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Offline copy of the M06 exercise library in the on-device SQLite database.
 * Installed on first launch and reinstalled when the bundled library's content
 * hash changes; search and filters run in SQLite, so the library works in
 * airplane mode. Favourites and custom exercises are device-local user data.
 */
export interface LibraryQuery {
  readonly locale: Locale;
  readonly text?: string;
  readonly pattern?: MovementPattern;
  /** Primary or secondary muscle. */
  readonly muscle?: MuscleId;
  /** Only exercises doable with this equipment. Undefined = no equipment filter. */
  readonly equipment?: readonly EquipmentId[];
  readonly favouritesOnly?: boolean;
}

export interface LibraryRow {
  readonly id: string;
  readonly name: string;
  readonly pattern: MovementPattern;
  readonly favourite: boolean;
}

const LOCALES: readonly Locale[] = ['en', 'fr'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS library_exercise (id TEXT PRIMARY KEY, pattern TEXT NOT NULL, skill TEXT NOT NULL, impact TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS library_exercise_muscle (exercise_id TEXT NOT NULL, muscle_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (exercise_id, muscle_id))`,
  `CREATE TABLE IF NOT EXISTS library_requirement (exercise_id TEXT NOT NULL, group_idx INTEGER NOT NULL, equipment_id TEXT NOT NULL, PRIMARY KEY (exercise_id, group_idx, equipment_id))`,
  `CREATE TABLE IF NOT EXISTS library_edge (type TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, similarity REAL, ladder_id TEXT, PRIMARY KEY (type, from_id, to_id))`,
  `CREATE TABLE IF NOT EXISTS library_search (exercise_id TEXT NOT NULL, locale TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (exercise_id, locale))`,
  `CREATE TABLE IF NOT EXISTS library_favourite (exercise_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS library_custom_exercise (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS library_exercise_pattern ON library_exercise (pattern)`,
  `CREATE INDEX IF NOT EXISTS library_muscle_by_muscle ON library_exercise_muscle (muscle_id)`,
];

/** Tables rebuilt from the bundled library; favourites and custom exercises are kept. */
const CONTENT_TABLES = ['library_exercise', 'library_exercise_muscle', 'library_requirement', 'library_edge', 'library_search'];

export class LibraryStore {
  constructor(
    private readonly db: SyncSqliteDatabase,
    readonly library: ExerciseLibrary = seedLibrary(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    for (const statement of SCHEMA) db.run(sql.raw(statement));
  }

  installedHash(): string | undefined {
    return this.db.get<{ value: string }>(sql`SELECT value FROM library_meta WHERE key = 'content_hash'`)?.value;
  }

  /** Installs or refreshes the offline copy. Returns true if it (re)installed. */
  install(): boolean {
    if (this.installedHash() === this.library.contentHash) return false;
    const translators = LOCALES.map((l) => [l, createTranslator(l)] as const);
    this.db.transaction((tx) => {
      for (const table of CONTENT_TABLES) tx.run(sql.raw(`DELETE FROM ${table}`));
      for (const e of this.library.exercises) {
        tx.run(sql`INSERT INTO library_exercise (id, pattern, skill, impact, data) VALUES (${e.id}, ${e.pattern}, ${e.skill}, ${e.impact}, ${JSON.stringify(e)})`);
        for (const m of e.primaryMuscles) tx.run(sql`INSERT INTO library_exercise_muscle (exercise_id, muscle_id, role) VALUES (${e.id}, ${m}, 'primary')`);
        for (const m of e.secondaryMuscles) tx.run(sql`INSERT INTO library_exercise_muscle (exercise_id, muscle_id, role) VALUES (${e.id}, ${m}, 'secondary')`);
        for (const [locale, tr] of translators) {
          const name = tr.t(e.nameKey as Parameters<typeof tr.t>[0]);
          tx.run(sql`INSERT INTO library_search (exercise_id, locale, name, text) VALUES (${e.id}, ${locale}, ${name}, ${normaliseSearchText(name)})`);
        }
      }
      for (const edge of this.library.edges) {
        if (edge.type === 'REQUIRES') {
          tx.run(sql`INSERT INTO library_requirement (exercise_id, group_idx, equipment_id) VALUES (${edge.from}, ${edge.group}, ${edge.to})`);
        } else {
          const similarity = edge.type === 'SUBSTITUTES' ? edge.similarity : null;
          const ladder = edge.type === 'SUBSTITUTES' ? null : edge.ladderId;
          tx.run(sql`INSERT OR IGNORE INTO library_edge (type, from_id, to_id, similarity, ladder_id) VALUES (${edge.type}, ${edge.from}, ${edge.to}, ${similarity}, ${ladder})`);
        }
      }
      tx.run(sql`INSERT INTO library_meta (key, value) VALUES ('content_hash', ${this.library.contentHash}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    });
    return true;
  }

  count(): number {
    return this.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM library_exercise`)?.n ?? 0;
  }

  search(query: LibraryQuery): LibraryRow[] {
    const where: SQL[] = [sql`s.locale = ${query.locale}`];
    if (query.pattern) where.push(sql`e.pattern = ${query.pattern}`);
    if (query.muscle) where.push(sql`EXISTS (SELECT 1 FROM library_exercise_muscle m WHERE m.exercise_id = e.id AND m.muscle_id = ${query.muscle})`);
    if (query.equipment) {
      const have = query.equipment.length > 0 ? sql`r.equipment_id IN (${sql.join(query.equipment.map((id) => sql`${id}`), sql`, `)})` : sql`0`;
      where.push(sql`NOT EXISTS (SELECT r.group_idx FROM library_requirement r WHERE r.exercise_id = e.id GROUP BY r.group_idx HAVING SUM(CASE WHEN ${have} THEN 1 ELSE 0 END) = 0)`);
    }
    if (query.favouritesOnly) where.push(sql`f.exercise_id IS NOT NULL`);
    for (const word of normaliseSearchText(query.text ?? '').split(' ').filter(Boolean)) where.push(sql`s.text LIKE ${`%${word}%`}`);
    const rows = this.db.all<{ id: string; name: string; pattern: MovementPattern; fav: string | null }>(
      sql`SELECT e.id AS id, s.name AS name, e.pattern AS pattern, f.exercise_id AS fav
          FROM library_exercise e
          JOIN library_search s ON s.exercise_id = e.id
          LEFT JOIN library_favourite f ON f.exercise_id = e.id
          WHERE ${sql.join(where, sql` AND `)}`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, pattern: r.pattern, favourite: r.fav !== null })).sort((a, b) => a.name.localeCompare(b.name, query.locale) || (a.id < b.id ? -1 : 1));
  }

  getExercise(id: string): Exercise | undefined {
    const row = this.db.get<{ data: string }>(sql`SELECT data FROM library_exercise WHERE id = ${id}`);
    // sql.js returns an empty row object when nothing matches.
    return row?.data ? (JSON.parse(row.data) as Exercise) : undefined;
  }

  setFavourite(id: string, favourite: boolean): void {
    if (favourite) this.db.run(sql`INSERT OR IGNORE INTO library_favourite (exercise_id, created_at) VALUES (${id}, ${this.now()})`);
    else this.db.run(sql`DELETE FROM library_favourite WHERE exercise_id = ${id}`);
  }

  favourites(): string[] {
    return this.db.all<{ id: string }>(sql`SELECT exercise_id AS id FROM library_favourite ORDER BY created_at, exercise_id`).map((r) => r.id);
  }

  /** User-defined exercises: user content, stored on the device, never offered as substitutes. */
  addCustomExercise(exercise: CustomExercise): void {
    const parsed = CustomExerciseSchema.parse(exercise);
    this.db.run(sql`INSERT INTO library_custom_exercise (id, data) VALUES (${parsed.id}, ${JSON.stringify(parsed)})`);
  }

  customExercises(): CustomExercise[] {
    return this.db.all<{ data: string }>(sql`SELECT data FROM library_custom_exercise ORDER BY id`).map((r) => CustomExerciseSchema.parse(JSON.parse(r.data)));
  }

  /** Account wipe (ADR-005): user data goes; the bundled content stays. */
  wipeUserData(): void {
    this.db.run(sql`DELETE FROM library_favourite`);
    this.db.run(sql`DELETE FROM library_custom_exercise`);
  }
}
