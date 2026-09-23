import {
  PullResponseSchema,
  PushResponseSchema,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@fitadapt/shared';
import { OfflineError } from '../errors.js';
import type { SyncTransport } from './types.js';

export interface HttpTransportOptions {
  baseUrl: string;
  getAccessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
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

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  push(request: PushRequest): Promise<PushResponse> {
    return this.post('/v1/sync/push', request, (json) => PushResponseSchema.parse(json));
  }

  pull(request: PullRequest): Promise<PullResponse> {
    return this.post('/v1/sync/pull', request, (json) => PullResponseSchema.parse(json));
  }

  private async post<T>(path: string, body: unknown, parse: (json: unknown) => T): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await this.options.getAccessToken()}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new OfflineError(cause instanceof Error ? cause.message : 'network error');
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = (json as { error?: { code?: unknown } } | undefined)?.error?.code;
      throw new HttpError(response.status, typeof code === 'string' ? code : undefined);
    }
    return parse(json);
  }
}
