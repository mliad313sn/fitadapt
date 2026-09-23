import { ErrorResponseSchema, PullRequestSchema, PullResponseSchema, PushRequestSchema, PushResponseSchema } from '@fitadapt/shared';
import type { SyncServer } from '@fitadapt/sync';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ApiError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';

export const syncRoutes =
  (auth: AuthService, sync: SyncServer): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema };
    const sameDevice = (tokenDevice: string, bodyDevice: string) => {
      if (tokenDevice !== bodyDevice) throw new ApiError(403, 'sync.device_mismatch');
    };

    app.post(
      '/v1/sync/push',
      {
        preHandler: authenticate(auth),
        schema: {
          tags: ['sync'],
          summary: 'Apply outbox mutations; each mutationId is applied at most once.',
          security: [{ bearerAuth: [] }],
          body: PushRequestSchema,
          response: { 200: PushResponseSchema, ...errors },
        },
      },
      async (request) => {
        const claims = requireAuth(request);
        sameDevice(claims.deviceId, request.body.deviceId);
        return sync.push(claims.userId, request.body);
      },
    );

    app.post(
      '/v1/sync/pull',
      {
        preHandler: authenticate(auth),
        schema: {
          tags: ['sync'],
          summary: 'Changes after a revision cursor, in revision order.',
          security: [{ bearerAuth: [] }],
          body: PullRequestSchema,
          response: { 200: PullResponseSchema, ...errors },
        },
      },
      async (request) => {
        const claims = requireAuth(request);
        sameDevice(claims.deviceId, request.body.deviceId);
        return sync.pull(claims.userId, request.body);
      },
    );
  };
