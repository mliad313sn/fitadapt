import swagger from '@fastify/swagger';
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
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
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
    request.log.error({ err: { type: error.name, message: error.message } }, 'unhandled error');
    reporter.capture(error);
    return reply.code(500).send({ error: { code: 'internal_error' } });
  });

  applyLoggingHygiene(app);
  registerTracing(app);

  const auth = new AuthService({
    db: deps.db,
    mailer: deps.mailer,
    rateLimiter: new RateLimiter(deps.redis, deps.redisPrefix ?? 'api:'),
    signer: new AccessTokenSigner(deps.jwtSecret, authValue('accessTokenTtlSeconds'), now),
    identityVerifier: deps.identityVerifier ?? new NotConfiguredIdentityVerifier(),
    pepper: deps.pepper,
    now,
  });
  const sync = new SyncServer({ store: new PgServerStore(deps.db) });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.register(authRoutes(auth));
  await app.register(syncRoutes(auth, sync));
  return app;
}
