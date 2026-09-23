import { AuthErrorCode } from '@fitadapt/shared';

/** An error with a stable machine code; the client maps codes to FR/EN copy. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const authErrors = {
  invalidCode: () => new ApiError(400, AuthErrorCode.InvalidCode),
  rateLimited: () => new ApiError(429, AuthErrorCode.RateLimited),
  invalidRefreshToken: () => new ApiError(401, AuthErrorCode.InvalidRefreshToken),
  refreshTokenReused: () => new ApiError(401, AuthErrorCode.RefreshTokenReused),
  unauthorized: () => new ApiError(401, AuthErrorCode.Unauthorized),
  providerNotConfigured: () => new ApiError(501, AuthErrorCode.ProviderNotConfigured),
};
