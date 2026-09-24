import {
  AuthResponseSchema,
  ErrorResponseSchema,
  FederatedSignInSchema,
  LogoutRequestSchema,
  OtpRequestResponseSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
  UserSchema,
} from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';

export const authRoutes =
  (auth: AuthService): FastifyPluginAsyncZod =>
  async (app) => {
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema };

    app.post(
      '/v1/auth/otp/request',
      {
        schema: {
          tags: ['auth'],
          summary: 'Send a one-time sign-in code by email (sign-up and sign-in).',
          body: OtpRequestSchema,
          response: { 202: OtpRequestResponseSchema, ...errors },
        },
      },
      async (request, reply) => {
        const { expiresInSeconds } = await auth.requestCode(request.body.email, request.body.locale, request.ip);
        return reply.code(202).send({ status: 'sent', expiresInSeconds });
      },
    );

    app.post(
      '/v1/auth/otp/verify',
      {
        schema: {
          tags: ['auth'],
          summary: 'Exchange a one-time code for tokens; creates the account on first use.',
          body: OtpVerifySchema,
          response: { 200: AuthResponseSchema, ...errors },
        },
      },
      async (request) => auth.verifyCode(request.body.email, request.body.code, request.body.device),
    );

    app.post(
      '/v1/auth/refresh',
      {
        schema: {
          tags: ['auth'],
          summary: 'Rotate the refresh token. Reusing a rotated token revokes the session.',
          body: RefreshRequestSchema,
          response: { 200: RefreshResponseSchema, ...errors },
        },
      },
      async (request) => ({ tokens: await auth.refresh(request.body.refreshToken) }),
    );

    app.post(
      '/v1/auth/logout',
      {
        schema: {
          tags: ['auth'],
          summary: 'End the session that the refresh token belongs to.',
          body: LogoutRequestSchema,
          response: { 204: z.null(), ...errors },
        },
      },
      async (request, reply) => {
        await auth.logout(request.body.refreshToken);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/v1/auth/federated',
      {
        schema: {
          tags: ['auth'],
          summary: 'Sign in with Apple or Google (not configured yet: answers 501).',
          body: FederatedSignInSchema,
          response: { 200: AuthResponseSchema, 501: ErrorResponseSchema, ...errors },
        },
      },
      async (request) => auth.signInWithProvider(request.body),
    );

    app.get(
      '/v1/me',
      {
        onRequest: authenticate(auth),
        schema: {
          tags: ['auth'],
          summary: 'The signed-in user.',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ user: UserSchema }), 401: ErrorResponseSchema },
        },
      },
      async (request) => ({ user: await auth.getUser(requireAuth(request).userId) }),
    );
  };
