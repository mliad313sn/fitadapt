import { z } from 'zod';
import { EmailSchema, LocaleSchema, PlatformSchema, UuidSchema } from './common.js';
import { UserSchema } from './entities.js';

export const OTP_CODE_LENGTH = 6;

export const OtpCodeSchema = z.string().regex(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`));

export const DeviceInfoSchema = z.object({
  id: UuidSchema,
  platform: PlatformSchema,
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const OtpRequestSchema = z.object({
  email: EmailSchema,
  locale: LocaleSchema.default('fr'),
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpRequestResponseSchema = z.object({
  status: z.literal('sent'),
  expiresInSeconds: z.number().int().positive(),
});

export const OtpVerifySchema = z.object({
  email: EmailSchema,
  code: OtpCodeSchema,
  device: DeviceInfoSchema,
});
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

export const TokenPairSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  accessTokenExpiresInSeconds: z.number().int().positive(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresInSeconds: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const AuthResponseSchema = z.object({
  user: UserSchema,
  isNewUser: z.boolean(),
  tokens: TokenPairSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({ tokens: TokenPairSchema });

export const LogoutRequestSchema = RefreshRequestSchema;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/** Federated identity providers. Verification is stubbed until credentials exist (ADR-003). */
export const IdentityProviderSchema = z.enum(['apple', 'google']);
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

export const FederatedSignInSchema = z.object({
  provider: IdentityProviderSchema,
  idToken: z.string().min(1).max(8192),
  device: DeviceInfoSchema,
});
export type FederatedSignIn = z.infer<typeof FederatedSignInSchema>;

/** Stable error codes returned by the auth endpoints; the client maps them to i18n keys. */
export const AuthErrorCode = {
  InvalidCode: 'auth.invalid_code',
  RateLimited: 'auth.rate_limited',
  InvalidRefreshToken: 'auth.invalid_refresh_token',
  RefreshTokenReused: 'auth.refresh_token_reused',
  Unauthorized: 'auth.unauthorized',
  ProviderNotConfigured: 'auth.provider_not_configured',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
