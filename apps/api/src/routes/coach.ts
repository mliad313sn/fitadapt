import {
  CoachConversationSchema,
  CoachMessageRequestSchema,
  CoachMessageResponseSchema,
  ErrorResponseSchema,
  StartConversationRequestSchema,
  StartConversationResponseSchema,
} from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CoachService } from '../ai-coach/service.js';
import type { AuthService } from '../auth/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';

/**
 * M11 AI coach (ADR-031). The model is called from here only (server-side
 * proxy: no provider key on any device). Every conversation starts with the
 * AI disclosure (L5); all of it needs the ai_coach consent.
 */
export const coachRoutes =
  (auth: AuthService, coach: CoachService): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 429: ErrorResponseSchema };
    const security = [{ bearerAuth: [] }];
    const preHandler = authenticate(auth);
    const tags = ['coach'];
    const params = z.object({ id: z.uuid() });

    app.post(
      '/v1/coach/conversations',
      { preHandler, schema: { tags, summary: 'Start a conversation with the AI coach; returns the AI disclosure to show first (L5).', security, body: StartConversationRequestSchema, response: { 201: StartConversationResponseSchema, ...errors } } },
      async (request, reply) => reply.code(201).send(await coach.start(requireAuth(request).userId, request.body)),
    );

    app.post(
      '/v1/coach/conversations/:id/messages',
      { preHandler, schema: { tags, summary: 'Send a message; the coach answers from reviewed content or through the engine tools.', security, params, body: CoachMessageRequestSchema, response: { 200: CoachMessageResponseSchema, ...errors } } },
      async (request) => {
        const claims = requireAuth(request);
        return coach.message(claims.userId, claims.deviceId, request.params.id, request.body);
      },
    );

    app.get(
      '/v1/coach/conversations/:id',
      { preHandler, schema: { tags, summary: 'A conversation with its messages and tool calls.', security, params, response: { 200: CoachConversationSchema, ...errors } } },
      async (request) => coach.get(requireAuth(request).userId, request.params.id),
    );

    app.delete(
      '/v1/coach/conversations/:id',
      { preHandler, schema: { tags, summary: 'Delete a conversation (messages and tool calls included).', security, params, response: { 204: z.null(), ...errors } } },
      async (request, reply) => {
        await coach.remove(requireAuth(request).userId, request.params.id);
        return reply.code(204).send(null);
      },
    );
  };
