import { AnalyticsBatchSchema, validateAnalyticsEvent, type AnalyticsEvent } from '@fitadapt/privacy';
import { ErrorResponseSchema } from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';
import type { AnalyticsSink } from '../privacy/analytics-sink.js';
import type { PrivacyService } from '../privacy/service.js';

/**
 * Product analytics intake. Needs the `analytics` consent (feature
 * `analytics.product`); events are checked against the allowlist and for
 * personal data, then forwarded without the user id (ADR-007).
 */
export const analyticsRoutes =
  (auth: AuthService, privacy: PrivacyService, sink: AnalyticsSink): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/v1/analytics/events',
      {
        preHandler: authenticate(auth),
        schema: {
          tags: ['analytics'],
          summary: 'Submit allowlisted analytics events (requires analytics consent).',
          security: [{ bearerAuth: [] }],
          body: AnalyticsBatchSchema,
          response: {
            202: z.object({ accepted: z.number().int().nonnegative() }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            429: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { userId } = requireAuth(request);
        await privacy.requireConsent(userId, 'analytics');
        await privacy.checkAnalyticsQuota(userId);
        const accepted: AnalyticsEvent[] = [];
        for (const input of request.body.events) {
          const result = validateAnalyticsEvent(input);
          // The whole batch is refused: a client sending personal data has a bug to fix.
          if (!result.ok) throw new ApiError(400, `analytics.${result.reason}`);
          accepted.push(result.event);
        }
        await sink.accept(accepted);
        return reply.code(202).send({ accepted: accepted.length });
      },
    );
  };
