/**
 * Crash/error reporting hook. No-op until a reporter is installed (Sentry is
 * wired in a later module once a DSN exists). Only non-personal context is
 * accepted: never pass user data, health data or free text.
 */
export interface ErrorContext {
  area: 'sync' | 'auth' | 'ui';
}

type Reporter = (error: unknown, context: ErrorContext) => void;

let reporter: Reporter | null = null;

export function installErrorReporter(next: Reporter | null): void {
  reporter = next;
}

export function reportError(error: unknown, context: ErrorContext): void {
  reporter?.(error, context);
}
