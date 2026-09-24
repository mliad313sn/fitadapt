import { CreatePairSessionRequestSchema, CreatePairSessionResponseSchema, ErrorResponseSchema, JoinPairSessionRequestSchema, JoinPairSessionResponseSchema } from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthService } from '../auth/service.js';
import type { PairService } from '../pair/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';

/**
 * M09 multi-device Fair Pair (ADR-021): create a pair session (a six-character
 * join code to tell the partner) and join one. Both need the caller's own L2
 * gate and partner_sharing consent. The session itself runs over the
 * WebSocket at /v1/pair/ws.
 */
export const pairRoutes =
  (auth: AuthService, pair: PairService): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema, 410: ErrorResponseSchema };
    const security = [{ bearerAuth: [] }];
    const preHandler = authenticate(auth);
    const tags = ['pair'];

    app.post(
      '/v1/pair/sessions',
      { preHandler, schema: { tags, summary: 'Start a multi-device pair session; returns the join code for the partner.', security, body: CreatePairSessionRequestSchema, response: { 201: CreatePairSessionResponseSchema, ...errors } } },
      async (request, reply) => reply.code(201).send(await pair.create(requireAuth(request).userId, request.body)),
    );

    app.post(
      '/v1/pair/sessions/join',
      { preHandler, schema: { tags, summary: 'Join a pair session with its code (each partner with their own account and consents).', security, body: JoinPairSessionRequestSchema, response: { 200: JoinPairSessionResponseSchema, ...errors } } },
      async (request) => pair.join(requireAuth(request).userId, request.body),
    );
  };
