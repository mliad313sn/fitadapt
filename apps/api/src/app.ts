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
import { photoRoutes } from './routes/photos.js';
import { privacyRoutes } from './routes/privacy.js';
import { syncRoutes } from './routes/sync.js';
import { healthWithdrawalHandler, profileSyncListener, profileSyncValidator } from './profile/sync-hooks.js';
import { PgServerStore } from './sync/pg-store.js';
import { PhotoBackupService, photosWithdrawalHandler } from './photos/service.js';
import { PairService, pairWithdrawalHandler } from './pair/service.js';
import { attachPairSockets } from './pair/ws.js';
import { pairRoutes } from './routes/pair.js';
import { safetyRoutes } from './routes/safety.js';
import type { CoachModel } from '@fitadapt/coach';
import { AnthropicCoachModel } from './ai-coach/anthropic-model.js';
import { loadCoachSystemPrompt } from './ai-coach/prompts.js';
import { CoachService, type CoachTier } from './ai-coach/service.js';
import { coachWithdrawalHandler } from './ai-coach/store.js';
import { coachRoutes } from './routes/coach.js';

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
  /** API-8: trusted reverse-proxy hops in front of the API (env TRUST_PROXY_HOPS; 0 = none). */
  trustProxyHops?: number;
  /** M11: the model provider key (server-side only). Absent: the coach answers without a model. */
  anthropicApiKey?: string;
  /** M11: a model to use instead of the provider (tests and evals inject deterministic models; null forces no model). */
  coachModel?: CoachModel | null;
  /** M11: subscription tier for the coach rate limits (M16; default free). */
  coachTierOf?: (userId: string) => Promise<CoachTier>;
}

export interface AppServices {
  privacy: PrivacyService;
  legal: LegalService;
  /** M09: the multi-device pair relay. */
  pair: PairService;
  /** M11: the AI coach. */
  coach: CoachService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const reporter = deps.errorReporter ?? noopReporter;
  const trustedHops = deps.trustProxyHops ?? 0;
  const app = Fastify({
    logger: loggerOptions(deps.logLevel ?? 'info', deps.logStream),
    // API-8: trust exactly `trustedHops` proxies (0: none, X-Forwarded-For ignored). Behind the M19 edge, request.ip
    // is then the client, not the proxy, so per-address limits are per client (ADR-028).
    trustProxy: trustedHops > 0 ? (_address: string, hop: number) => hop < trustedHops : false,
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
  const legal = new LegalService({ db: deps.db, pepper: deps.pepper, now, registry: deps.legalRegistry, notices: deps.notices, consentPolicies: deps.consentPolicies, rateLimiter });
  const privacy = new PrivacyService({
    db: deps.db,
    rateLimiter,
    backups: deps.backupCatalog ?? new NoBackupsCatalog(),
    pepper: deps.pepper,
    now,
    policies: deps.consentPolicies,
    // M01: withdrawing health consent erases the synced health collections (profile, screenings).
    // M04: withdrawing the photos consent erases the encrypted photo backup.
    withdrawalHandlers: {
      ...deps.withdrawalHandlers,
      health: [healthWithdrawalHandler(), ...(deps.withdrawalHandlers?.health ?? [])],
      photos: [photosWithdrawalHandler(), ...(deps.withdrawalHandlers?.photos ?? [])],
      // M09: withdrawing partner_sharing stops the pair relay and erases what it holds from that person.
      partner_sharing: [pairWithdrawalHandler(), ...(deps.withdrawalHandlers?.partner_sharing ?? [])],
      // M11: withdrawing the ai_coach consent erases every conversation (health data) in the same transaction.
      ai_coach: [coachWithdrawalHandler(), ...(deps.withdrawalHandlers?.ai_coach ?? [])],
    },
    // L2/L11: every consent decision also goes to the defensibility log, in the same transaction.
    onConsentRecorded: (tx, userId, record, at) => legal.logConsent(tx, userId, record, at),
  });
  // M01: profile, equipment profiles and screenings are validated on the server (schema, health consent,
  // S7 age check, SafetyProfile re-evaluation) and screenings write their safety gates to the defensibility log
  // in the sync transaction (L11: a screening and its safety events commit together or not at all).
  const profileHooks = { privacy, legal, now, db: deps.db };
  // FIX-E × FIX-C (PKG-06): every record is checked against its collection's shared schema before the domain
  // validator (fail closed: `<collection>.invalid`).
  const sync = new SyncServer({ store: new PgServerStore(deps.db), validate: profileSyncValidator(profileHooks), onApplied: profileSyncListener(profileHooks), enforceCollectionSchemas: true });
  const pair = new PairService({ db: deps.db, privacy, legal, pepper: deps.pepper, now, rateLimiter });
  // M11: server-side model proxy (the key never leaves this process); the coach writes records only through the sync validators.
  const coachModel = deps.coachModel !== undefined ? deps.coachModel : deps.anthropicApiKey ? new AnthropicCoachModel({ apiKey: deps.anthropicApiKey }) : null;
  const coach = new CoachService({ db: deps.db, redis: deps.redis, redisPrefix: deps.redisPrefix ?? 'api:', rateLimiter, privacy, legal, sync, pepper: deps.pepper, now, model: coachModel, systemStable: loadCoachSystemPrompt(), tierOf: deps.coachTierOf });
  app.decorate('services', { privacy, legal, pair, coach });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.register(authRoutes(auth));
  await app.register(syncRoutes(auth, sync));
  await app.register(privacyRoutes(auth, privacy));
  await app.register(legalRoutes(auth, legal));
  await app.register(photoRoutes(auth, new PhotoBackupService({ db: deps.db, privacy, now, rateLimiter })));
  await app.register(analyticsRoutes(auth, privacy, deps.analyticsSink ?? new NoopAnalyticsSink()));
  // M09: multi-device Fair Pair (REST to create/join, WebSocket for the session itself; ADR-001, ADR-021).
  await app.register(pairRoutes(auth, pair));
  await app.register(coachRoutes(auth, coach));
  attachPairSockets(app, auth, pair, { trustProxyHops: deps.trustProxyHops ?? 0, now });
  // MOB-08: the S3 intensity lock that outlives a health-consent withdrawal (ADR-027).
  await app.register(safetyRoutes(auth, deps.db));
  return app;
}
