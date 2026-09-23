/**
 * `pnpm legal:demo-seed` — development only. Creates one FICTIONAL user with
 * acceptances, a health consent, notices, a safety event and a prescription,
 * so `pnpm legal:export --user <id>` can be demonstrated. Refuses production.
 */
import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { DEFAULT_REGISTRY, notice, renderDocument, renderNotice, versionInForce } from '@fitadapt/legal';
import { loadEnv } from '../config/env.js';
import { createDatabase, runMigrations } from '../db/client.js';
import { users } from '../db/schema.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import { NoBackupsCatalog } from '../privacy/backup-catalog.js';
import { PrivacyService } from '../privacy/service.js';
import { loadLocalEnv } from './cli.js';
import { LegalService } from './service.js';

loadLocalEnv();
const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('legal:demo-seed is for development databases only');
const database = createDatabase(env.DATABASE_URL);
try {
  await runMigrations(database.db);
  const now = () => new Date();
  const legal = new LegalService({ db: database.db, pepper: env.AUTH_TOKEN_PEPPER, now });
  const privacy = new PrivacyService({
    db: database.db,
    // recordConsent does not rate-limit; the demo seed needs no Redis.
    rateLimiter: undefined as unknown as RateLimiter,
    backups: new NoBackupsCatalog(),
    pepper: env.AUTH_TOKEN_PEPPER,
    now,
    onConsentRecorded: (tx, userId, record, at) => legal.logConsent(tx, userId, record, at),
  });
  const userId = randomUUID();
  await database.db.insert(users).values({ id: userId, email: `demo-${userId.slice(0, 8)}@example.test`, locale: 'fr' });
  for (const id of ['terms', 'privacy', 'exercise_risk'] as const) {
    const doc = DEFAULT_REGISTRY.get(id)!;
    const version = versionInForce(doc, now());
    await legal.recordAcceptance(userId, { documentId: id, version: version.version, locale: 'fr', jurisdiction: 'SN', source: 'mobile', contentHash: renderDocument(doc, version, 'fr', 'SN').contentHash });
  }
  await privacy.recordConsent(userId, { dataType: 'health', decision: 'granted', version: 1, locale: 'fr', jurisdiction: 'SN', source: 'mobile' });
  const first = notice('first_workout');
  const hash = renderNotice(first, 'fr', 'SN').contentHash;
  await legal.recordNotice(userId, { noticeId: first.id, version: first.version, kind: 'shown', locale: 'fr', jurisdiction: 'SN', contentHash: hash });
  await legal.recordNotice(userId, { noticeId: first.id, version: first.version, kind: 'acknowledged', locale: 'fr', jurisdiction: 'SN', contentHash: hash });
  await legal.recordPrescription(userId, { prescriptionId: randomUUID(), engineVersion: ENGINE_VERSION, reasonCodes: ['demo.first_session'] });
  await legal.recordSafetyEvent(userId, { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_reported', action: 'session_ended', engineVersion: ENGINE_VERSION });
  console.log(`Fictional demo user created: ${userId}\nNext: pnpm legal:export --user ${userId}`);
} finally {
  await database.close();
}
