import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_CODE_LENGTH } from '@fitadapt/shared';

/** Uniformly random numeric one-time code, e.g. "042917". */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, '0');
}

/** Opaque, URL-safe refresh token (256 bits of entropy). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed hash (HMAC-SHA-256) so stored codes, tokens and emails are useless without the pepper. */
export function keyedHash(pepper: string, ...parts: string[]): string {
  const h = createHmac('sha256', pepper);
  for (const part of parts) h.update(part).update('\u0000');
  return h.digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
