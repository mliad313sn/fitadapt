import { z } from 'zod';
import {
  EmailSchema,
  IsoDateTimeSchema,
  LocaleSchema,
  PlatformSchema,
  UnitSystemSchema,
  UuidSchema,
} from './common.js';

export const UserSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  locale: LocaleSchema,
  unitSystem: UnitSystemSchema,
  createdAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

export const DeviceSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  platform: PlatformSchema,
  createdAt: IsoDateTimeSchema,
});
export type Device = z.infer<typeof DeviceSchema>;

/** A server-side authentication session (one refresh-token family per device sign-in). */
export const AuthSessionSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  deviceId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
