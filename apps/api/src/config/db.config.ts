import { defineConfig } from '@fitadapt/shared';

/**
 * PostgreSQL pool and session limits (API-1). Engineering defaults without an
 * external source (CLAUDE.md rule 4): they bound how long a request can hold
 * or wait for a connection, so a stuck transaction can never hang the whole
 * API. Await security and operations review (M19, seat B1 for the security
 * part).
 */
const SOURCE = 'docs/status/FIX-api-security.md API-1 (engineering default, no external source)';

export const dbConfig = defineConfig({
  /** Connections per API process. */
  poolMax: { value: 10, unit: 'connections', source: SOURCE, validated: false },
  /** A request that cannot get a connection within this time fails (instead of waiting forever). */
  connectionTimeoutMs: { value: 5_000, unit: 'ms', source: SOURCE, validated: false },
  /** Longest single statement (including a wait for the per-user sync lock). */
  statementTimeoutMs: { value: 15_000, unit: 'ms', source: SOURCE, validated: false },
  /** A transaction left idle this long is ended by PostgreSQL and its connection freed. */
  idleInTransactionTimeoutMs: { value: 30_000, unit: 'ms', source: SOURCE, validated: false },
});

export type DbConfigKey = keyof typeof dbConfig;

export function dbValue(key: DbConfigKey): number {
  return dbConfig[key].value;
}
