import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';

/**
 * OpenTelemetry spans for every request, via @opentelemetry/api. Without a
 * registered SDK (none by default; Sentry registers one when a DSN is set)
 * the API is a no-op. Span attributes hold the route template and status only.
 */
const spans = new WeakMap<object, Span>();

export function registerTracing(app: FastifyInstance): void {
  const tracer = trace.getTracer('api');
  app.addHook('onRequest', async (request) => {
    const route = request.routeOptions.url ?? 'unknown';
    spans.set(request, tracer.startSpan(`${request.method} ${route}`, { attributes: { 'http.method': request.method, 'http.route': route } }));
  });
  app.addHook('onResponse', async (request, reply) => {
    const span = spans.get(request);
    if (!span) return;
    span.setAttribute('http.status_code', reply.statusCode);
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    spans.delete(request);
  });
}
