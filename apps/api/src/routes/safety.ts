import { ErrorResponseSchema, IsoDateTimeSchema, UuidSchema } from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import type { Database } from '../db/client.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';
import { retainedIntensityLock } from '../profile/intensity-lock.js';

const IntensityLockResponseSchema = z.object({
  locked: z.boolean(),
  since: IsoDateTimeSchema.nullable(),
  /** The red flags (ids) an attestation must name to lift the lock (ADR-023). */
  flagIds: z.array(UuidSchema),
});

/**
 * MOB-08 (ADR-024): the S3 intensity lock the server retains apart from the
 * erasable execution logs, so a device that no longer holds the red flag
 * (health consent withdrawn and granted again, a new phone, a reinstall)
 * still applies the lock and can ask for the medical-review attestation that
 * lifts it. Read-only: the lock is set and lifted only through synced
 * execution logs.
 */
export const safetyRoutes =
  (auth: AuthService, db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('onRequest', authenticate(auth));
    app.get(
      '/v1/safety/intensity-lock',
      {
        schema: {
          tags: ['safety'],
          summary: 'The S3 intensity lock the server holds for the signed-in user (it outlives a health-consent withdrawal).',
          security: [{ bearerAuth: [] }],
          response: { 200: IntensityLockResponseSchema, 401: ErrorResponseSchema },
        },
      },
      async (request) => retainedIntensityLock(db, requireAuth(request).userId),
    );
  };
