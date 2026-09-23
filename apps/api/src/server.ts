import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { MemoryMailer } from './auth/mailer.js';
import { loadEnv } from './config/env.js';
import { privacyValue } from './config/privacy.config.js';
import { createDatabase, runMigrations } from './db/client.js';
import { initErrorReporting } from './observability/sentry.js';

const env = loadEnv();
const reporter = await initErrorReporting(env.SENTRY_DSN, env.NODE_ENV);
if (env.NODE_ENV === 'production') {
  // No production mail provider is chosen yet (see docs/status/M00.md). Refuse to start
  // rather than silently dropping sign-in codes.
  throw new Error('No mail provider configured for production');
}
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
const redis = new Redis(env.REDIS_URL);
// Development only: codes stay in memory and are never logged.
const mailer = new MemoryMailer();
const app = await buildApp({
  db: database.db,
  redis,
  mailer,
  jwtSecret: env.AUTH_JWT_SECRET,
  pepper: env.AUTH_TOKEN_PEPPER,
  logLevel: env.LOG_LEVEL,
  errorReporter: reporter,
});

// Retention schedule: backup-purge completion and expiry of old records (M17).
const retention = setInterval(() => {
  app.services.privacy
    .runRetention()
    .then((result) => {
      if (result && result.backupPurgesOverdue.length > 0) {
        app.log.error({ overdue: result.backupPurgesOverdue.length }, 'backup purge overdue: see docs/compliance/breach-runbook.md');
      }
    })
    .catch((error: unknown) => app.log.error({ err: error }, 'retention job failed'));
}, privacyValue('retentionJobIntervalSeconds') * 1000);
retention.unref();

const shutdown = async () => {
  clearInterval(retention);
  await app.close();
  redis.disconnect();
  await database.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ port: env.API_PORT, host: env.API_HOST });
