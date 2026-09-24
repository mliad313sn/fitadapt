import {
  PullResponseSchema,
  PushResponseSchema,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@fitadapt/shared';
import { syncValue } from '../config.js';
import { OfflineError } from '../errors.js';
import type { SyncTransport } from './types.js';

export interface HttpTransportOptions {
  baseUrl: string;
  getAccessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  /** Time allowed for one request, headers and body (PKG-07); defaults to syncConfig.requestTimeoutMs. */
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`HTTP ${status}${code ? ` ${code}` : ''}`);
    this.name = 'HttpError';
  }
}

/** Talks to apps/api /v1/sync/*. Responses are validated with zod. */
export class HttpTransport implements SyncTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? syncValue('requestTimeoutMs');
  }

  push(request: PushRequest): Promise<PushResponse> {
    return this.post('/v1/sync/push', request, (json) => PushResponseSchema.parse(json));
  }

  pull(request: PullRequest): Promise<PullResponse> {
    return this.post('/v1/sync/pull', request, (json) => PullResponseSchema.parse(json));
  }

  /**
   * PKG-07: the request (headers and body) is aborted after `timeoutMs` and
   * reported as OfflineError, so a captive portal or a half-open connection
   * cannot hold the shared sync run for ever. A timer and an AbortController
   * rather than AbortSignal.timeout, which older Hermes builds lack.
   */
  private async post<T>(path: string, body: unknown, parse: (json: unknown) => T): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OfflineError('timeout'));
      }, this.timeoutMs);
    });
    try {
      let response: Response;
      try {
        const request = async () =>
          this.fetchImpl(new URL(path, this.options.baseUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.options.getAccessToken()}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        response = await Promise.race([request(), deadline]);
      } catch (cause) {
        if (timedOut || cause instanceof OfflineError) throw new OfflineError('timeout');
        throw new OfflineError(cause instanceof Error ? cause.message : 'network error');
      }
      const json: unknown = await Promise.race([response.json().catch(() => undefined), deadline]).catch((cause: unknown) => {
        if (cause instanceof OfflineError) throw cause;
        return undefined;
      });
      if (!response.ok) {
        const code = (json as { error?: { code?: unknown } } | undefined)?.error?.code;
        throw new HttpError(response.status, typeof code === 'string' ? code : undefined);
      }
      return parse(json);
    } finally {
      clearTimeout(timer);
      // Settle the deadline so it never rejects unobserved.
      deadline.catch(() => undefined);
    }
  }
}
