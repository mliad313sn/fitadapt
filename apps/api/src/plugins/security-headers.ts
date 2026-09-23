import type { FastifyInstance } from 'fastify';
import { privacyValue } from '../config/privacy.config.js';

/**
 * Response headers for a JSON API (ASVS V14 / V50 HTTP security headers).
 * TLS itself terminates at the edge (M19); HSTS tells clients never to fall
 * back to plain HTTP. API responses are never cached: they carry personal data.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  const hsts = `max-age=${privacyValue('hstsMaxAgeSeconds')}; includeSubDomains`;
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('strict-transport-security', hsts);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('cache-control', 'no-store');
    return payload;
  });
}
