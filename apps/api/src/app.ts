import swagger from '@fastify/swagger';
import type { LegalRegistry, NoticeDefinition } from '@fitadapt/legal';
import type { ConsentPolicySet } from '@fitadapt/privacy';
import { SyncServer } from '@fitadapt/sync';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { ApiError } from './auth/errors.js';
import { NotConfiguredIdentityVerifier, type IdentityProviderVerifier } from './auth/identity-providers.js';
import type { Mailer } from './auth/mailer.js';
import { RateLimiter } from './auth/rate-limit.js';
import { AuthService } from './auth/service.js';
import { AccessTokenSigner } from './auth/tokens.js';
import { authValue } from './config/auth.config.js';
import type { Database } from './db/client.js';
import { applyLoggingHygiene, loggerOptions } from './observability/logger.js';
import { noopReporter, type ErrorReporter } from './observability/sentry.js';
import { registerTracing } from './observability/tracing.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { NoopAnalyticsSink, type AnalyticsSink } from './privacy/analytics-sink.js';
import { NoBackupsCatalog, type BackupCatalog } from './privacy/backup-catalog.js';
import { PrivacyService, type PrivacyServiceDeps } from './privacy/service.js';
import { analyticsRoutes } from './routes/analytics.js';
import { authRoutes } from './routes/auth.js';
import { LegalService } from './legal/service.js';
import { legalRoutes } from './routes/legal.js';
import { privacyRoutes } from './routes/privacy.js';
import { syncRoutes } from './routes/sync.js';
import { healthWithdrawalHandler, profileSyncListener, profileSyncValidator } from './profile/sync-hooks.js';
import { PgServerStore } from './sync/pg-store.js';

export interface AppDeps {
  db: Database;
  redis: Redis;
  mailer: Mailer;
  jwtSecret: string;
  pepper: string;
  logLevel?: string;
  logStream?: NodeJS.WritableStream;
  now?: () => Date;
  identityVerifier?: IdentityProviderVerifier;
  errorReporter?: ErrorReporter;
  /** Namespace for Redis keys (isolates test runs). */
  redisPrefix?: string;
  /** Backup system view used to complete deletions (M19 provides the production one). */
  backupCatalog?: BackupCatalog;
  analyticsSink?: AnalyticsSink;
  consentPolicies?: ConsentPolicySet;
  withdrawalHandlers?: PrivacyServiceDeps['withdrawalHandlers'];
  /** Legal document registry and notices (tests inject versions with material changes). */
  legalRegistry?: LegalRegistry;
  notices?: readonly NoticeDefinition[];
}

export interface AppServices {
  privacy: PrivacyService;
  legal: LegalService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const reporter = deps.errorReporter ?? noopReporter;
  const app = Fastify({
    logger: loggerOptions(deps.logLevel ?? 'info', deps.logStream),
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'API', version: '0.1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: { code: error.code } });
    }
    if (error.validation) {
      // Never echo input values back: they may contain an email or a code.
      return reply.code(400).send({ error: { code: 'validation_error' } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: 'bad_request' } });
    }
    // Type and machine code only: error messages can quote user input (M17 log hygiene).
    request.log.error({ err: { type: error.name, errorCode: typeof error.code === 'string' ? error.code : undefined } }, 'unhandled error');
    reporter.capture(error);
    return reply.code(500).send({ error: { code: 'internal_error' } });
  });

  applyLoggingHygiene(app);
  registerSecurityHeaders(app);
  registerTracing(app);

  const rateLimiter = new RateLimiter(deps.redis, deps.redisPrefix ?? 'api:');

  const auth = new AuthService({
    db: deps.db,
    mailer: deps.mailer,
    rateLimiter,
    signer: new AccessTokenSigner(deps.jwtSecret, authValue('accessTokenTtlSeconds'), now),
    identityVerifier: deps.identityVerifier ?? new NotConfiguredIdentityVerifier(),
    pepper: deps.pepper,
    now,
  });
  const legal = new LegalService({ db: deps.db, pepper: deps.pepper, now, registry: deps.legalRegistry, notices: deps.notices, consentPolicies: deps.consentPolicies });
  const privacy = new PrivacyService({
    db: deps.db,
    rateLimiter,
    backups: deps.backupCatalog ?? new NoBackupsCatalog(),
    pepper: deps.pepper,
    now,
    policies: deps.consentPolicies,
    // M01: withdrawing health consent erases the synced health collections (profile, screenings).
    withdrawalHandlers: { ...deps.withdrawalHandlers, health: [healthWithdrawalHandler(), ...(deps.withdrawalHandlers?.health ?? [])] },
    // L2/L11: every consent decision also goes to the defensibility log, in the same transaction.
    onConsentRecorded: (tx, userId, record, at) => legal.logConsent(tx, userId, record, at),
  });
  // M01: profile, equipment profiles and screenings are validated on the server (schema, health consent,
  // S7 age check, SafetyProfile re-evaluation) and screenings write their safety gates to the defensibility log
  // in the sync transaction (L11: a screening and its safety events commit together or not at all).
  const profileHooks = { privacy, legal, now, db: deps.db };
  const sync = new SyncServer({ store: new PgServerStore(deps.db), validate: profileSyncValidator(profileHooks), onApplied: profileSyncListener(profileHooks) });
  app.decorate('services', { privacy, legal });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.register(authRoutes(auth));
  await app.register(syncRoutes(auth, sync));
  await app.register(privacyRoutes(auth, privacy));
  await app.register(legalRoutes(auth, legal));
  await app.register(analyticsRoutes(auth, privacy, deps.analyticsSink ?? new NoopAnalyticsSink()));
  return app;
}
