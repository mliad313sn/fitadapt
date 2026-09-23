/**
 * Optional crash and performance monitoring. Without SENTRY_DSN this is a
 * no-op. The Sentry SDK is deliberately NOT a dependency: @sentry/node 11
 * pulls in a CLI under the FSL-1.1 licence, which is not on the L6 allowlist
 * (ADR-001). Enabling it = licence review, `pnpm add @sentry/node`, set the DSN.
 * Events are scrubbed of request data and user identity before leaving.
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

/** The subset of the Sentry SDK we use. */
export interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown): unknown;
}

const SENTRY_MODULE = '@sentry/node';

async function loadSentry(): Promise<SentryLike> {
  return (await import(/* optional dependency */ SENTRY_MODULE)) as SentryLike;
}

export async function initErrorReporting(
  dsn: string | undefined,
  environment: string,
  load: () => Promise<SentryLike> = loadSentry,
  warn: (message: string) => void = (m) => process.emitWarning(m),
): Promise<ErrorReporter> {
  if (!dsn) return noopReporter;
  let Sentry: SentryLike;
  try {
    Sentry = await load();
  } catch {
    warn('SENTRY_DSN is set but @sentry/node is not installed; error reporting stays off');
    return noopReporter;
  }
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    // Collect no user info, cookies, headers, bodies or query strings (no personal or health data).
    sendDefaultPii: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (event: ScrubbableEvent) => scrubEvent(event),
    beforeSendTransaction: (event: ScrubbableEvent) => scrubEvent(event),
  });
  return { capture: (error) => Sentry.captureException(error) };
}
