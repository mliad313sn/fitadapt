import { DOCUMENT_VARIANTS, NOTICE_IDS } from '@fitadapt/legal';
import { ErrorResponseSchema, JurisdictionSchema, LocaleSchema } from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import type { LegalService } from '../legal/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const AcceptanceStateSchema = z.object({
  documentId: z.string(),
  status: z.enum(['accepted', 'not_accepted', 'needs_reacceptance']),
  versionInForce: z.number().int(),
  acceptedVersion: z.number().int().nullable(),
  updatedSinceAcceptance: z.boolean(),
  upcomingVersion: z.number().int().nullable(),
});
const StatusSchema = z.object({
  jurisdiction: z.string(),
  documents: z.array(AcceptanceStateSchema),
  firstWorkout: z.object({ allowed: z.boolean(), missing: z.array(z.string()) }),
});
const DocumentSchema = z.object({
  documentId: z.string(),
  version: z.number().int(),
  locale: LocaleSchema,
  variant: z.enum(DOCUMENT_VARIANTS),
  draftBanner: z.string(),
  title: z.string(),
  sections: z.array(z.object({ key: z.string(), text: z.string() })),
  contentHash: hash,
});

/** Legal documents, L2 acceptances and L3 notices (M20, ADR-008). */
export const legalRoutes =
  (auth: AuthService, legal: LegalService): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema };
    const security = [{ bearerAuth: [] }];
    const preHandler = authenticate(auth);

    app.get(
      '/v1/legal/documents/:documentId',
      {
        schema: {
          tags: ['legal'],
          summary: 'The version in force of a legal document, rendered for a locale and jurisdiction, with the hash to send on acceptance. Drafts carry the draft banner.',
          params: z.object({ documentId: z.string().max(64) }),
          querystring: z.object({ locale: LocaleSchema, jurisdiction: JurisdictionSchema }),
          response: { 200: DocumentSchema, 404: ErrorResponseSchema, 400: ErrorResponseSchema },
        },
      },
      async (request) => {
        const doc = legal.document(request.params.documentId, request.query.locale, request.query.jurisdiction);
        return { ...doc, sections: [...doc.sections] };
      },
    );

    app.get(
      '/v1/legal/status',
      {
        preHandler,
        schema: {
          tags: ['legal'],
          summary: 'Acceptance state per document and the first-workout gate (L2) for a jurisdiction.',
          security,
          querystring: z.object({ jurisdiction: JurisdictionSchema }),
          response: { 200: StatusSchema, ...errors },
        },
      },
      async (request) => {
        const status = await legal.status(requireAuth(request).userId, request.query.jurisdiction);
        return { ...status, firstWorkout: { ...status.firstWorkout, missing: [...status.firstWorkout.missing] } };
      },
    );

    app.post(
      '/v1/legal/acceptances',
      {
        preHandler,
        schema: {
          tags: ['legal'],
          summary: 'Record an acceptance (append-only). Version must be in force or upcoming; contentHash must match the text shown.',
          security,
          body: z.object({
            documentId: z.string().max(64),
            version: z.number().int().positive(),
            locale: LocaleSchema,
            jurisdiction: JurisdictionSchema,
            source: z.enum(['mobile', 'web', 'api']).default('api'),
            contentHash: hash,
            id: z.uuid().optional(),
            acceptedAt: z.iso.datetime({ offset: true }).optional(),
          }),
          response: { 201: z.object({ acceptance: AcceptanceStateSchema }), 404: ErrorResponseSchema, 409: ErrorResponseSchema, ...errors },
        },
      },
      async (request, reply) => reply.code(201).send({ acceptance: await legal.recordAcceptance(requireAuth(request).userId, request.body) }),
    );

    app.post(
      '/v1/legal/notices',
      {
        preHandler,
        schema: {
          tags: ['legal'],
          summary: 'Record that a point-of-risk notice was shown or acknowledged (L3).',
          security,
          body: z.object({
            noticeId: z.enum(NOTICE_IDS),
            version: z.number().int().positive(),
            kind: z.enum(['shown', 'acknowledged']),
            locale: LocaleSchema,
            jurisdiction: JurisdictionSchema,
            contentHash: hash,
            id: z.uuid().optional(),
            occurredAt: z.iso.datetime({ offset: true }).optional(),
          }),
          response: { 204: z.null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema, ...errors },
        },
      },
      async (request, reply) => {
        await legal.recordNotice(requireAuth(request).userId, request.body);
        return reply.code(204).send(null);
      },
    );
  };
