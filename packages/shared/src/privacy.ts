import { z } from 'zod';
import { IsoDateTimeSchema, LocaleSchema, PlatformSchema, UnitSystemSchema, UuidSchema } from './common.js';
import { UserSchema } from './entities.js';
import { ChangeSchema } from './sync.js';

/**
 * Privacy contracts (M17): consent records, data-subject requests and the
 * account-data export. See docs/adr/ADR-004-consent-model.md and
 * docs/adr/ADR-005-data-subject-rights.md.
 */

/**
 * Data types that need their own, separately recorded consent (M17 scope).
 * M09 adds `partner_sharing`: sharing anything with a training partner (Fair Pair); what exactly is shared is
 * chosen per pair session (PairSharing scopes), and body weight is never shared without its own scope.
 */
export const CONSENT_DATA_TYPES = ['health', 'photos', 'wearables', 'ai_coach', 'analytics', 'partner_sharing'] as const;
export const ConsentDataTypeSchema = z.enum(CONSENT_DATA_TYPES);
export type ConsentDataType = z.infer<typeof ConsentDataTypeSchema>;

export const ConsentDecisionSchema = z.enum(['granted', 'withdrawn']);
export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>;

/** ISO 3166-1 alpha-2 country code; "ZZ" when the jurisdiction is unknown. */
export const JurisdictionSchema = z.string().regex(/^[A-Z]{2}$/);
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;
export const UNKNOWN_JURISDICTION = 'ZZ';

export const ConsentSourceSchema = z.enum(['mobile', 'web', 'api']);

/**
 * One consent decision. Records are append-only: a withdrawal is a new record,
 * never an edit. `version` is the version of the consent text the user saw
 * (the wording itself is owned by M20).
 */
export const ConsentRecordSchema = z.object({
  id: UuidSchema,
  dataType: ConsentDataTypeSchema,
  decision: ConsentDecisionSchema,
  version: z.number().int().positive(),
  locale: LocaleSchema,
  jurisdiction: JurisdictionSchema,
  source: ConsentSourceSchema,
  recordedAt: IsoDateTimeSchema,
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const ConsentUpdateRequestSchema = z.object({
  dataType: ConsentDataTypeSchema,
  decision: ConsentDecisionSchema,
  version: z.number().int().positive(),
  locale: LocaleSchema,
  jurisdiction: JurisdictionSchema,
  source: ConsentSourceSchema.default('api'),
  /** M01: the device's record id, so an upload retried after a lost response is recorded once. */
  id: UuidSchema.optional(),
  /** M01: when the decision was made on the device (offline decisions are uploaded later). */
  recordedAt: IsoDateTimeSchema.optional(),
});
export type ConsentUpdateRequest = z.infer<typeof ConsentUpdateRequestSchema>;

/** The effective consent for one data type, derived from the record history. */
export const ConsentStateSchema = z.object({
  dataType: ConsentDataTypeSchema,
  granted: z.boolean(),
  /** Version of the latest decision, or null if the user never decided. */
  version: z.number().int().positive().nullable(),
  currentVersion: z.number().int().positive(),
  /** True when a grant exists but for a version older than the minimum still accepted. */
  needsRenewal: z.boolean(),
  decidedAt: IsoDateTimeSchema.nullable(),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const ConsentStatesResponseSchema = z.object({ consents: z.array(ConsentStateSchema) });

export const DataRequestKindSchema = z.enum(['export', 'deletion']);
export const DataRequestStatusSchema = z.enum(['completed', 'backup_purge_pending']);
export const DataRequestSchema = z.object({
  id: UuidSchema,
  kind: DataRequestKindSchema,
  status: DataRequestStatusSchema,
  requestedAt: IsoDateTimeSchema,
  primaryCompletedAt: IsoDateTimeSchema,
  backupPurgeDueAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
});
export type DataRequest = z.infer<typeof DataRequestSchema>;

export const AuditActionSchema = z.enum([
  'consent.granted',
  'consent.withdrawn',
  'data.exported',
  'data.corrected',
  'account.deleted',
  'backup.purged',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** Pseudonymous, personal-data-free audit entry (L11). */
export const AuditEntrySchema = z.object({
  id: UuidSchema,
  action: AuditActionSchema,
  dataType: ConsentDataTypeSchema.nullable(),
  version: z.number().int().positive().nullable(),
  occurredAt: IsoDateTimeSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Typing the literal confirms intent; the endpoint also requires a valid session. */
export const ACCOUNT_DELETION_CONFIRMATION = 'delete-my-account';
export const AccountDeletionRequestSchema = z.object({ confirm: z.literal(ACCOUNT_DELETION_CONFIRMATION) });
export const AccountDeletionResponseSchema = z.object({
  requestId: UuidSchema,
  status: z.literal('backup_purge_pending'),
  primaryDeletedAt: IsoDateTimeSchema,
  backupPurgeDueAt: IsoDateTimeSchema,
});
export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponseSchema>;

/** Correction of the profile fields the user can change directly (GDPR Art. 16). */
export const ProfileCorrectionSchema = z
  .object({ locale: LocaleSchema.optional(), unitSystem: UnitSystemSchema.optional() })
  .refine((v) => v.locale !== undefined || v.unitSystem !== undefined, { message: 'nothing to correct' });
export type ProfileCorrection = z.infer<typeof ProfileCorrectionSchema>;

export const DATA_EXPORT_FORMAT = 'account-data-export';
export const DATA_EXPORT_SCHEMA_VERSION = 1;

/** Everything held about the user in primary storage, as returned by the in-app export. */
export const DataExportSchema = z.object({
  format: z.literal(DATA_EXPORT_FORMAT),
  schemaVersion: z.literal(DATA_EXPORT_SCHEMA_VERSION),
  generatedAt: IsoDateTimeSchema,
  user: UserSchema,
  devices: z.array(
    z.object({ id: UuidSchema, platform: PlatformSchema, createdAt: IsoDateTimeSchema, lastSeenAt: IsoDateTimeSchema }),
  ),
  sessions: z.array(
    z.object({
      id: UuidSchema,
      deviceId: UuidSchema,
      createdAt: IsoDateTimeSchema,
      revokedAt: IsoDateTimeSchema.nullable(),
      revokedReason: z.string().nullable(),
    }),
  ),
  consents: z.array(ConsentRecordSchema),
  sync: z.object({
    revision: z.number().int().nonnegative(),
    changes: z.array(ChangeSchema.extend({ recordedAt: IsoDateTimeSchema })),
    mutations: z.array(z.object({ mutationId: UuidSchema, recordedAt: IsoDateTimeSchema })),
  }),
  dataRequests: z.array(DataRequestSchema),
  auditTrail: z.array(AuditEntrySchema),
  /** M20: acceptances of legal texts and point-of-risk notices shown (L2, L3). */
  legal: z.object({
    acceptances: z.array(
      z.object({ id: UuidSchema, documentId: z.string(), version: z.number().int().positive(), locale: LocaleSchema, jurisdiction: z.string(), source: z.enum(['mobile', 'web', 'api']), contentHash: z.string(), acceptedAt: IsoDateTimeSchema }),
    ),
    notices: z.array(
      z.object({ id: UuidSchema, noticeId: z.string(), version: z.number().int().positive(), kind: z.enum(['shown', 'acknowledged']), locale: LocaleSchema, jurisdiction: z.string(), contentHash: z.string(), occurredAt: IsoDateTimeSchema }),
    ),
  })
    // Exports produced before M20 have no legal section.
    .default({ acceptances: [], notices: [] }),
});
export type DataExport = z.infer<typeof DataExportSchema>;
