import { ErrorResponseSchema, PhotoBackupEntrySchema, UuidSchema, WrappedPhotoKeySchema } from '@fitadapt/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { photosValue } from '../config/photos.config.js';
import { authenticate, requireAuth } from '../plugins/authenticate.js';
import type { PhotoBackupService } from '../photos/service.js';

/**
 * M04 end-to-end-encrypted progress-photo backup (ADR-020): bearer auth,
 * `photos` consent, opaque binary bodies (application/octet-stream) up to
 * `maxEnvelopeBytes`. The service never sees a key it could use.
 */
export const photoRoutes =
  (auth: AuthService, photos: PhotoBackupService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: photosValue('maxEnvelopeBytes') + 1 }, (_request, body, done) => done(null, body));
    const errors = { 400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema, 413: ErrorResponseSchema };
    const security = [{ bearerAuth: [] }];
    const preHandler = authenticate(auth);
    const tags = ['photos'];
    const params = z.object({ photoId: UuidSchema });

    app.put(
      '/v1/photos/backup/key',
      { preHandler, schema: { tags, summary: 'Store the photo key wrapped by the recovery-code key (the service cannot unwrap it).', security, body: WrappedPhotoKeySchema, response: { 204: z.null(), ...errors } } },
      async (request, reply) => {
        await photos.putKey(requireAuth(request).userId, request.body);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/v1/photos/backup/key',
      { preHandler, schema: { tags, summary: 'The wrapped photo key, if a backup exists.', security, response: { 200: z.object({ key: WrappedPhotoKeySchema.nullable() }), ...errors } } },
      async (request) => ({ key: await photos.getKey(requireAuth(request).userId) }),
    );

    app.put(
      '/v1/photos/backup/photos/:photoId',
      { preHandler, schema: { tags, summary: 'Store one encrypted photo envelope (AES-256-GCM, opaque bytes).', security, params, response: { 201: PhotoBackupEntrySchema, ...errors } } },
      async (request, reply) => {
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const entry = await photos.putPhoto(requireAuth(request).userId, request.params.photoId, body);
        return reply.code(201).send(entry);
      },
    );

    app.get(
      '/v1/photos/backup/photos',
      { preHandler, schema: { tags, summary: 'The backed-up photos (ids, sizes, times).', security, response: { 200: z.object({ photos: z.array(PhotoBackupEntrySchema) }), ...errors } } },
      async (request) => ({ photos: await photos.listPhotos(requireAuth(request).userId) }),
    );

    app.get(
      '/v1/photos/backup/photos/:photoId',
      { preHandler, schema: { tags, summary: 'One encrypted photo envelope (application/octet-stream).', security, params, response: { 200: z.unknown().describe('application/octet-stream: the envelope bytes'), ...errors } } },
      async (request, reply) => {
        const envelope = await photos.getPhoto(requireAuth(request).userId, request.params.photoId);
        return reply.type('application/octet-stream').header('cache-control', 'no-store').send(envelope);
      },
    );

    app.delete(
      '/v1/photos/backup',
      { preHandler, schema: { tags, summary: 'Turn the backup off: delete every uploaded photo and the wrapped key.', security, response: { 204: z.null(), ...errors } } },
      async (request, reply) => {
        await photos.removeAll(requireAuth(request).userId);
        return reply.code(204).send(null);
      },
    );
  };
