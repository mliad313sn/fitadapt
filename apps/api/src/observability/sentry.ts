/**
 * Optional crash and performance monitoring. Without SENTRY_DSN this is a
 * no-op and @sentry/node is never loaded. With a DSN, events are scrubbed of
 * request data and user identity before they leave the process.
 */
interface ScrubbableEvent {
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
}

/** Drops request data, user identity, breadcrumbs and free-form extras from an event. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const { request: _request, user: _user, breadcrumbs: _breadcrumbs, extra: _extra, ...rest } = event;
  return rest as E;
}

export interface ErrorReporter {
  capture(error: unknown): void;
}

export const noopReporter: ErrorReporter = { capture: () => undefined };

export async function initErrorReporting(dsn: string | undefined, environment: string): Promise<ErrorReporter> {
  if (!dsn) return noopReporter;
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn,
    environment,
    // Collect no user info, cookies, headers, bodies or query strings (no personal or health data).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
  });
  return { capture: (error) => Sentry.captureException(error) };
}
