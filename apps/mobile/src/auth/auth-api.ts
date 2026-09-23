import {
  AuthResponseSchema,
  OtpRequestResponseSchema,
  RefreshResponseSchema,
  type AuthResponse,
  type DeviceInfo,
  type Locale,
  type TokenPair,
} from '@fitadapt/shared';
import { OfflineError } from '@fitadapt/sync';

/** An API error with its stable code (mapped to `errors.auth.*` copy by the screens). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`API request failed with status ${status}${code ? ` (${code})` : ''}`);
    this.name = 'ApiRequestError';
  }
}

/** The /v1/auth endpoints the app uses (ADR-003). */
export interface AuthApi {
  requestCode(email: string, locale: Locale): Promise<void>;
  verifyCode(email: string, code: string, device: DeviceInfo): Promise<AuthResponse>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string): Promise<void>;
}

export type JsonPost = (path: string, body: unknown, accessToken?: string) => Promise<unknown>;

/**
 * JSON POST against the API. A network failure is an OfflineError (the app
 * keeps working locally); an error response is an ApiRequestError with its code.
 * Request and response bodies are never logged.
 */
export function jsonPost(baseUrl: string, doFetch: typeof fetch = fetch): JsonPost {
  return async (path, body, accessToken) => {
    let res: Response;
    try {
      res = await doFetch(new URL(path, baseUrl).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new OfflineError(cause instanceof Error ? cause.message : 'network error');
    }
    const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
      throw new ApiRequestError(res.status, typeof code === 'string' ? code : undefined);
    }
    return json;
  };
}

export function createAuthApi(post: JsonPost): AuthApi {
  return {
    async requestCode(email, locale) {
      OtpRequestResponseSchema.parse(await post('/v1/auth/otp/request', { email, locale }));
    },
    async verifyCode(email, code, device) {
      return AuthResponseSchema.parse(await post('/v1/auth/otp/verify', { email, code, device }));
    },
    async refresh(refreshToken) {
      return RefreshResponseSchema.parse(await post('/v1/auth/refresh', { refreshToken })).tokens;
    },
    async logout(refreshToken) {
      await post('/v1/auth/logout', { refreshToken });
    },
  };
}
