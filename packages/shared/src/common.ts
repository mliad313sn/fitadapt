import { z } from 'zod';

export const UuidSchema = z.uuid();

/**
 * The records a new record replaces in an append-only history where the
 * latest counts: the heads its writer knew (packages/shared record-chain,
 * ADR-023). Optional: records stored before it existed have none.
 */
export const SupersedesSchema = z.array(UuidSchema).max(256);
export type Uuid = z.infer<typeof UuidSchema>;

/** Emails are compared case-insensitively; we store them trimmed and lower-cased. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const LocaleSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const UnitSystemSchema = z.enum(['metric', 'imperial']);
export type UnitSystem = z.infer<typeof UnitSystemSchema>;

export const PlatformSchema = z.enum(['ios', 'android', 'web']);
export type Platform = z.infer<typeof PlatformSchema>;

/** ISO-8601 timestamp with offset, e.g. 2026-09-23T10:00:00.000Z */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Machine-readable API error. `code` is stable and mapped to FR/EN copy by the
 * client through packages/i18n; the API never returns user-facing wording.
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
