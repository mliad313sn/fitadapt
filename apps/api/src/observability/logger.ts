import type { FastifyInstance, FastifyServerOptions } from 'fastify';

/**
 * Structured logging with no personal or health data (CLAUDE.md rule 7).
 * Request logs carry method, route template, status and timing only: no IP,
 * no query string, no headers, no bodies. The redaction list is a second line
 * of defence for anything logged explicitly.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'email',
  'code',
  'otp',
  'accessToken',
  'refreshToken',
  'idToken',
  'password',
  'data',
  'body',
  '*.email',
  '*.code',
  '*.otp',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.password',
  '*.data',
  '*.body',
  '*.ip',
  '*.remoteAddress',
];

interface RequestLike {
  method?: string;
  id?: string;
  routeOptions?: { url?: string };
  url?: string;
}

export function loggerOptions(level: string, stream?: NodeJS.WritableStream): FastifyServerOptions['logger'] {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: RequestLike) {
        // Route template (e.g. /v1/auth/otp/verify), never the raw URL with a query string.
        return { id: req.id, method: req.method, route: req.routeOptions?.url ?? req.url?.split('?')[0] };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
    ...(stream ? { stream } : {}),
  };
}

/**
 * Fastify's default 404 handler logs the raw URL, query string included.
 * Replace it with one that logs nothing identifying and answers a stable code.
 */
export function applyLoggingHygiene(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'not_found' } }));
}
