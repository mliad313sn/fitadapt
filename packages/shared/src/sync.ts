import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';

export const CollectionNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const MutationOpSchema = z.enum(['insert', 'upsert', 'delete']);
export type MutationOp = z.infer<typeof MutationOpSchema>;

export const RecordDataSchema = z.record(z.string(), z.unknown());
export type RecordData = z.infer<typeof RecordDataSchema>;

/**
 * A client-side change. `mutationId` is the idempotency key: pushing the same
 * mutation twice must have the effect of pushing it once.
 */
export const SyncMutationSchema = z.object({
  mutationId: UuidSchema,
  collection: CollectionNameSchema,
  recordId: UuidSchema,
  op: MutationOpSchema,
  /** Server revision the client based this change on; null for new records. */
  baseRevision: z.number().int().nonnegative().nullable(),
  data: RecordDataSchema.nullable(),
  clientCreatedAt: IsoDateTimeSchema,
});
export type SyncMutation = z.infer<typeof SyncMutationSchema>;

export const MAX_MUTATIONS_PER_PUSH = 500;

export const PushRequestSchema = z.object({
  deviceId: UuidSchema,
  mutations: z.array(SyncMutationSchema).max(MAX_MUTATIONS_PER_PUSH),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushResultStatusSchema = z.enum(['applied', 'duplicate', 'conflict', 'rejected']);
export type PushResultStatus = z.infer<typeof PushResultStatusSchema>;

export const ChangeSchema = z.object({
  revision: z.number().int().positive(),
  collection: CollectionNameSchema,
  recordId: UuidSchema,
  op: z.enum(['upsert', 'delete']),
  data: RecordDataSchema.nullable(),
  originDeviceId: UuidSchema,
});
export type Change = z.infer<typeof ChangeSchema>;

export const PushResultSchema = z.object({
  mutationId: UuidSchema,
  status: PushResultStatusSchema,
  /** Revision assigned to the change (applied/duplicate). */
  revision: z.number().int().positive().optional(),
  /** Current server state of the record when status is 'conflict'. */
  current: ChangeSchema.optional(),
  reason: z.string().optional(),
});
export type PushResult = z.infer<typeof PushResultSchema>;

export const PushResponseSchema = z.object({
  results: z.array(PushResultSchema),
});
export type PushResponse = z.infer<typeof PushResponseSchema>;

export const MAX_CHANGES_PER_PULL = 500;

export const PullRequestSchema = z.object({
  deviceId: UuidSchema,
  since: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(MAX_CHANGES_PER_PULL).default(MAX_CHANGES_PER_PULL),
});
export type PullRequest = z.input<typeof PullRequestSchema>;

export const PullResponseSchema = z.object({
  changes: z.array(ChangeSchema),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

export const SyncCursorSchema = z.object({
  deviceId: UuidSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
});
export type SyncCursor = z.infer<typeof SyncCursorSchema>;

export const OutboxStatusSchema = z.enum(['pending', 'acked', 'rejected']);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const OutboxItemSchema = z.object({
  id: UuidSchema,
  mutation: SyncMutationSchema,
  status: OutboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  lastError: z.string().nullable(),
});
export type OutboxItem = z.infer<typeof OutboxItemSchema>;
