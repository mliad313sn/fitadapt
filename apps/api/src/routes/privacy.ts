import {
  AccountDeletionRequestSchema,
  AccountDeletionResponseSchema,
  ConsentStateSchema,
  ConsentStatesResponseSchema,
  ConsentUpdateRequestSchema,
  DataExportSchema,
  ErrorResponseSchema,
  ProfileCorrectionSchema,
  UserSchema,
} from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';
import type { PrivacyService } from '../privacy/service.js';

/** Consent management and data-subject rights (M17, ADR-004, ADR-005). */
export const privacyRoutes =
  (auth: AuthService, privacy: PrivacyService): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema };
    const security = [{ bearerAuth: [] }];
    const preHandler = authenticate(auth);

    app.get(
      '/v1/privacy/consents',
      {
        preHandler,
        schema: {
          tags: ['privacy'],
          summary: 'Current consent per data type (health, photos, wearables, AI coach, analytics).',
          security,
          response: { 200: ConsentStatesResponseSchema, ...errors },
        },
      },
      async (request) => ({ consents: await privacy.consents(requireAuth(request).userId) }),
    );

    app.post(
      '/v1/privacy/consents',
      {
        preHandler,
        schema: {
          tags: ['privacy'],
          summary: 'Record a consent decision (append-only). Grants must be for the current text version.',
          security,
          body: ConsentUpdateRequestSchema,
          response: { 201: z.object({ consent: ConsentStateSchema }), 409: ErrorResponseSchema, ...errors },
        },
      },
      async (request, reply) => {
        const consent = await privacy.recordConsent(requireAuth(request).userId, request.body);
        return reply.code(201).send({ consent });
      },
    );

    app.get(
      '/v1/privacy/export',
      {
        preHandler,
        schema: {
          tags: ['privacy'],
          summary: 'Download all data held about the signed-in user, as JSON.',
          security,
          response: { 200: DataExportSchema, ...errors },
        },
      },
      async (request, reply) => {
        const document = await privacy.exportData(requireAuth(request).userId);
        return reply.header('content-disposition', 'attachment; filename="account-data-export.json"').send(document);
      },
    );

    app.patch(
      '/v1/me',
      {
        preHandler,
        schema: {
          tags: ['privacy'],
          summary: 'Correct profile fields (language, units).',
          security,
          body: ProfileCorrectionSchema,
          response: { 200: z.object({ user: UserSchema }), ...errors },
        },
      },
      async (request) => ({ user: await privacy.correctProfile(requireAuth(request).userId, request.body) }),
    );

    app.post(
      '/v1/privacy/deletion',
      {
        preHandler,
        schema: {
          tags: ['privacy'],
          summary: 'Delete the account and all its data now; backups are purged on their rotation schedule.',
          security,
          body: AccountDeletionRequestSchema,
          response: { 202: AccountDeletionResponseSchema, ...errors },
        },
      },
      async (request, reply) => {
        const { emailHash: _emailHash, ...result } = await privacy.deleteAccount(requireAuth(request).userId);
        return reply.code(202).send(result);
      },
    );
  };
