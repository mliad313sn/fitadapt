import { REDACTED, scrubLogRecord, scrubText, valueCategories } from '@fitadapt/privacy';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { symbols, type Logger } from 'pino';

/**
 * Structured logging with no personal or health data (CLAUDE.md rule 7).
 * Request logs carry method, route template, status and timing only: no IP,
 * no query string, no headers, no bodies. The redaction list is a second line
 * of defence for anything logged explicitly, and every record then passes
 * through the M17 scrubber (@fitadapt/privacy): personal data recognised by key
 * or by value (emails, names, weights, pain reports, free text, tokens, IPs)
 * is replaced by "[redacted]" and errors keep only their type and code.
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

/** Re-serialises a child logger's bindings (pino keeps them as a JSON fragment) after scrubbing. */
export function scrubChildBindings(child: Logger): void {
  const holder = child as unknown as Record<symbol, unknown>;
  const fragment = holder[symbols.chindingsSym];
  if (typeof fragment !== 'string' || fragment.length === 0) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(`{${fragment.replace(/^,/, '')}}`) as Record<string, unknown>;
  } catch {
    holder[symbols.chindingsSym] = '';
    return;
  }
  const scrubbed = JSON.stringify(scrubLogRecord(parsed));
  holder[symbols.chindingsSym] = scrubbed === '{}' ? '' : `,${scrubbed.slice(1, -1)}`;
}

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
    formatters: {
      // `req` and `res` are made safe by the serializers below, which pino applies after this hook.
      log: (record: Record<string, unknown>) => scrubLogRecord(record, { passThroughKeys: ['req', 'res'] }),
      bindings: (bindings: Record<string, unknown>) => scrubLogRecord(bindings),
    },
    // pino applies the bindings formatter to the root logger only; child bindings
    // (e.g. `log.child({ ... })`, Fastify's per-request child) are scrubbed here.
    onChild: scrubChildBindings,
    hooks: {
      // The message is developer text (only embedded data is redacted); printf-style
      // arguments after it are values and get the strict check.
      logMethod(input: unknown[], method: (...a: unknown[]) => void) {
        // `log.error(err)` would make the error message the log message: keep the type only.
        const args = input[0] instanceof Error ? [{ err: input[0] }, typeof input[1] === 'string' ? input[1] : input[0].name, ...input.slice(2)] : input;
        const messageIndex = typeof args[0] === 'string' ? 0 : 1;
        method.apply(
          this,
          args.map((a, i) => {
            if (typeof a !== 'string') return i > messageIndex && a !== null && typeof a === 'object' ? scrubLogRecord({ value: a }).value : a;
            if (i === messageIndex) return scrubText(a);
            return valueCategories(a).length > 0 ? REDACTED : scrubText(a);
          }),
        );
      },
    },
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
