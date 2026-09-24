import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { AuthResponse } from '@fitadapt/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { buildApp, type AppDeps } from '../../src/app.js';
import { MemoryMailer } from '../../src/auth/mailer.js';
import { createDatabase, type DatabaseHandle } from '../../src/db/client.js';
import type { MemoryAnalyticsSink } from '../../src/privacy/analytics-sink.js';
import type { MemoryBackupCatalog } from '../../src/privacy/backup-catalog.js';
import { integrationEnv } from './env.js';

export const JWT_SECRET = 'integration-test-secret-integration-test-secret';
export const PEPPER = 'integration-test-pepper-integration-test-pepper';

/** Controllable clock so expiry can be tested without waiting. */
export class TestClock {
  private t = Date.now();
  now = () => new Date(this.t);
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
}

export interface Harness {
  app: FastifyInstance;
  mailer: MemoryMailer;
  clock: TestClock;
  logs: string[];
  database: DatabaseHandle;
  redis: Redis;
  redisPrefix: string;
  close(): Promise<void>;
}

export interface HarnessOptions {
  backupCatalog?: MemoryBackupCatalog;
  analyticsSink?: MemoryAnalyticsSink;
  consentPolicies?: AppDeps['consentPolicies'];
  withdrawalHandlers?: AppDeps['withdrawalHandlers'];
  legalRegistry?: AppDeps['legalRegistry'];
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const { databaseUrl, redisUrl } = integrationEnv();
  const database = createDatabase(databaseUrl);
  const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
  const mailer = new MemoryMailer();
  const clock = new TestClock();
  const logs: string[] = [];
  const redisPrefix = `test:${randomUUID()}:`;
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const app = await buildApp({
    db: database.db,
    redis,
    mailer,
    jwtSecret: JWT_SECRET,
    pepper: PEPPER,
    logLevel: 'trace',
    logStream,
    now: clock.now,
    redisPrefix,
    ...options,
  });
  await app.ready();
  return {
    app,
    mailer,
    clock,
    logs,
    database,
    redis,
    redisPrefix,
    async close() {
      await clearRedis(redis, redisPrefix);
      await app.close();
      redis.disconnect();
      await database.close();
    },
  };
}

async function clearRedis(redis: Redis, prefix: string) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

/** Resets the database tables and this harness's Redis namespace (rate-limit counters). */
export async function truncateAll(h: Harness) {
  await clearRedis(h.redis, h.redisPrefix);
  // The defensibility tables refuse TRUNCATE (PKG-01, ADR-024). Between tests only, the schema owner
  // lifts their triggers inside one transaction, so they are back on even if the TRUNCATE fails.
  await h.database.db.transaction(async (tx) => {
    await tx.execute(sql`ALTER TABLE defensibility_events DISABLE TRIGGER USER`);
    await tx.execute(sql`ALTER TABLE defensibility_heads DISABLE TRIGGER USER`);
    await tx.execute(
      sql`TRUNCATE users, devices, otp_codes, auth_sessions, refresh_tokens, sync_heads, sync_changes, sync_mutations, consent_records, data_requests, audit_entries, legal_acceptances, notice_impressions, defensibility_events, defensibility_heads, photo_backup_keys, photo_backups, pair_sessions, pair_participants, pair_events CASCADE`,
    );
    await tx.execute(sql`ALTER TABLE defensibility_events ENABLE TRIGGER USER`);
    await tx.execute(sql`ALTER TABLE defensibility_heads ENABLE TRIGGER USER`);
  });
}

export const uniqueEmail = () => `user-${randomUUID().slice(0, 8)}@example.test`;

export function device(platform: 'ios' | 'android' = 'ios') {
  return { id: randomUUID(), platform };
}

export async function requestCode(h: Harness, email: string, locale: 'fr' | 'en' = 'fr') {
  return h.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { email, locale } });
}

export async function verify(h: Harness, email: string, code: string, dev = device()) {
  return h.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { email, code, device: dev } });
}

/** Full one-time-code flow; the code is captured from the injected mailer, never from logs. */
export async function signIn(h: Harness, email: string, dev = device()): Promise<AuthResponse & { deviceId: string }> {
  const req = await requestCode(h, email);
  if (req.statusCode !== 202) throw new Error(`otp request failed: ${req.statusCode}`);
  const code = h.mailer.lastCodeFor(email);
  if (!code) throw new Error('no code captured');
  const res = await verify(h, email, code, dev);
  if (res.statusCode !== 200) throw new Error(`verify failed: ${res.statusCode} ${res.body}`);
  return { ...(res.json() as AuthResponse), deviceId: dev.id };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
