import { z } from 'zod';
import { ReasonCodeSchema } from './assessment.js';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { JurisdictionSchema } from './privacy.js';
import { EquipmentIdSchema, MovementPatternSchema, SlugSchema } from './exercise.js';
import { PerformedSetSchema } from './session.js';

/**
 * M09 — Fair Pair: partner training contracts
 * (docs/specs/M09-fair-pair-partner-training.md, ADR-021).
 *
 * Entities: PairSession, Participant, SharedTimeline, FairScore.
 *
 * - Each partner's plan is an ordinary M02 SessionPlan from the one engine,
 *   generated with that partner's own SafetyProfile, joint flags, history and
 *   capacity. The pair planner only orders the two plans into one timeline;
 *   it never changes a prescription and never merges or averages profiles.
 * - Logs stay per person (append-only), so a sync can never mix partners' data.
 * - Nothing about one partner reaches the other without that partner's own
 *   sharing consent (M17 `partner_sharing`) and scopes; body weight is off by
 *   default, and so is the Fair Challenge.
 */

const engineVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

export const PAIR_MODES = ['single_device', 'multi_device'] as const;
export const PairModeSchema = z.enum(PAIR_MODES);
export type PairMode = z.infer<typeof PairModeSchema>;

/** 'a' is the person who starts the pair session (the host), 'b' the partner. */
export const PARTICIPANT_SLOTS = ['a', 'b'] as const;
export const ParticipantSlotSchema = z.enum(PARTICIPANT_SLOTS);
export type ParticipantSlot = z.infer<typeof ParticipantSlotSchema>;

/**
 * What a participant shares with their partner, on top of taking part at all
 * (a display name, whose turn it is and which set they are on), which the
 * M17 `partner_sharing` consent itself covers.
 * - performance: exercise names, targets, reps, loads and reps in reserve;
 * - bodyweight: their body weight (hidden unless they opt in);
 * - challenge: take part in the Fair Challenge and share its score (off by default).
 * Pain reports, red flags, screening answers and the SafetyProfile are never shared.
 */
export const PAIR_SHARING_SCOPES = ['performance', 'bodyweight', 'challenge'] as const;
export const PairSharingScopeSchema = z.enum(PAIR_SHARING_SCOPES);
export type PairSharingScope = z.infer<typeof PairSharingScopeSchema>;

/** A participant's own sharing choice for one pair session (append-only: a change is a new record). */
export const PairSharingSchema = z.strictObject({
  scopes: z.array(PairSharingScopeSchema).max(PAIR_SHARING_SCOPES.length),
  /** Version of the `partner_sharing` consent text the participant granted (M17 ledger). */
  consentVersion: z.number().int().positive(),
  recordedAt: IsoDateTimeSchema,
});
export type PairSharing = z.infer<typeof PairSharingSchema>;

/** A name the participant chose to be called by in the session (not an account name; never logged). */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .refine((s) => !/[@<>{}\\]/.test(s), { message: 'a display name has no email or markup' });

export const PARTICIPANT_KINDS = ['owner', 'guest', 'account'] as const;

export const ParticipantSchema = z.strictObject({
  slot: ParticipantSlotSchema,
  /** Device-local id of a guest on the owner's phone, or the participant id on the server. Never the user id of the other person. */
  participantId: UuidSchema,
  /**
   * owner: the phone's own user; guest: a partner using the owner's phone, with their own ledgers kept under their
   * own id on the device; account: a partner on their own device and account (multi-device).
   */
  kind: z.enum(PARTICIPANT_KINDS),
  displayName: DisplayNameSchema,
  sharing: PairSharingSchema,
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ---------------------------------------------------------- shared timeline

export const TIMELINE_BLOCK_KINDS = ['warm_up', 'shared', 'solo', 'conditioning', 'cool_down'] as const;
export const TimelineBlockKindSchema = z.enum(TIMELINE_BLOCK_KINDS);

/** Two people need the same single implement (one barbell): they take staggered turns and change the load between them. */
export const EquipmentConflictSchema = z.strictObject({
  equipment: EquipmentIdSchema,
  resolution: z.literal('staggered'),
  /** Time added before a turn whose load on that implement differs from the partner's. */
  changeoverSeconds: z.number().int().min(0),
});
export type EquipmentConflict = z.infer<typeof EquipmentConflictSchema>;

export const TimelineBlockSchema = z
  .strictObject({
    index: z.number().int().min(0),
    kind: TimelineBlockKindSchema,
    /** The movement pattern of the block (shared: the same for both partners; null for warm-up, conditioning and cool-down). */
    pattern: MovementPatternSchema.nullable(),
    /** Exercise index in each partner's own plan (null: that partner has no exercise in this block). */
    a: z.number().int().min(0).max(19).nullable(),
    b: z.number().int().min(0).max(19).nullable(),
    /** Each partner's own exercise (their individual variant), for display; loads stay in each plan. */
    exerciseA: SlugSchema.nullable(),
    exerciseB: SlugSchema.nullable(),
    conflict: EquipmentConflictSchema.nullable(),
    reasonCodes: z.array(ReasonCodeSchema).min(1),
  })
  .refine((b) => b.kind !== 'shared' || (b.a !== null && b.b !== null && b.pattern !== null), { message: 'a shared block has an exercise for both partners and one pattern' })
  .refine((b) => b.kind !== 'solo' || (b.a === null) !== (b.b === null), { message: 'a solo block belongs to exactly one partner' });
export type TimelineBlock = z.infer<typeof TimelineBlockSchema>;

export const TIMELINE_STEP_KINDS = ['set', 'together'] as const;

/** One turn: a partner's set ('set'), or something both do at the same time ('together': warm-up, cardio, cool-down). */
export const TimelineStepSchema = z
  .strictObject({
    index: z.number().int().min(0),
    block: z.number().int().min(0),
    kind: z.enum(TIMELINE_STEP_KINDS),
    participant: ParticipantSlotSchema.nullable(),
    exerciseIndex: z.number().int().min(0).max(19).nullable(),
    setIndex: z.number().int().min(0).max(19).nullable(),
    /** Seconds from the start of the pair session (an estimate from the time model; the devices time the real session). */
    startSecond: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    /** The partner's own rest target after this set (from their plan; the timeline never shortens it). */
    restAfterSeconds: z.number().int().min(0),
  })
  .refine((s) => s.kind !== 'set' || (s.participant !== null && s.exerciseIndex !== null && s.setIndex !== null), { message: 'a set step names the partner, exercise and set' });
export type TimelineStep = z.infer<typeof TimelineStepSchema>;

export const SharedTimelineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  engineVersion,
  /** Version of the pair planner rules and coefficients (packages/engine/src/pair). */
  rulesVersion: engineVersion,
  planA: UuidSchema,
  planB: UuidSchema,
  blocks: z.array(TimelineBlockSchema),
  steps: z.array(TimelineStepSchema),
  totalSeconds: z.number().int().min(0),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type SharedTimeline = z.infer<typeof SharedTimelineSchema>;

// -------------------------------------------------------------- fair score

/**
 * scoring: the partner is still in the challenge; complete: they finished their plan;
 * stopped: they stopped early (L4: allowed at any time, never penalised in copy);
 * paused_pain: a pain report — nothing more is counted (the score never rewards training through pain);
 * safety_stop: an S3 red flag ended their session and their intensity (never shown to the partner as such).
 */
export const FAIR_SCORE_STATUSES = ['scoring', 'complete', 'stopped', 'paused_pain', 'safety_stop'] as const;
export const FairScoreStatusSchema = z.enum(FAIR_SCORE_STATUSES);
export type FairScoreStatus = z.infer<typeof FairScoreStatusSchema>;

export const FairScoreSchema = z.strictObject({
  participant: ParticipantSlotSchema,
  planId: UuidSchema,
  /** Completed volume × variant/load coefficient ÷ the person's own expected volume, in % (0–100). */
  points: z.number().min(0).max(100),
  completedUnits: z.number().min(0),
  expectedUnits: z.number().min(0),
  status: FairScoreStatusSchema,
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type FairScore = z.infer<typeof FairScoreSchema>;

/** A set as the score reads it: what the person did, and which exercise they did it on (a swap changes it). */
export const ScoredSetSchema = z.strictObject({
  exerciseIndex: z.number().int().min(0).max(19),
  exerciseId: SlugSchema,
  set: PerformedSetSchema,
  loggedAt: IsoDateTimeSchema,
});
export type ScoredSet = z.infer<typeof ScoredSetSchema>;

// ------------------------------------------------------------- pair session

/** The pair session as the devices keep it: who takes part, the timeline and whether the challenge is on. */
export const PairSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pairSessionId: UuidSchema,
  mode: PairModeSchema,
  createdAt: IsoDateTimeSchema,
  participants: z.tuple([ParticipantSchema, ParticipantSchema]),
  timeline: SharedTimelineSchema,
  /** On only when both participants opted in with the 'challenge' scope (off by default). */
  challenge: z.boolean(),
});
export type PairSession = z.infer<typeof PairSessionSchema>;

// ---------------------------------------------------------- multi-device wire

/** What a partner's device may learn about a set: always the position, the rest only with the 'performance' scope. */
export const SharedPerformanceSchema = z.strictObject({
  exerciseId: SlugSchema,
  reps: z.number().int().min(0).max(100).nullable(),
  seconds: z.number().int().min(0).max(600).nullable(),
  loadKg: z.number().min(0).max(500).nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
});

/** A plan outline one device shares so the other can build the same timeline (exercise and set structure; loads only with 'performance'). */
export const SharedPlanOutlineSchema = z.strictObject({
  planId: UuidSchema,
  exercises: z
    .array(
      z.strictObject({
        slot: MovementPatternSchema,
        exerciseId: SlugSchema.nullable(),
        sets: z.array(z.strictObject({ workSeconds: z.number().int().min(0).max(900), restSeconds: z.number().int().min(0).max(900), loadKg: z.number().min(0).max(500).nullable() })).min(1).max(20),
      }),
    )
    .max(20),
});
export type SharedPlanOutline = z.infer<typeof SharedPlanOutlineSchema>;

export const PairEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plan'), outline: SharedPlanOutlineSchema }),
  z.strictObject({
    type: z.literal('turn'),
    exerciseIndex: z.number().int().min(0).max(19),
    setIndex: z.number().int().min(0).max(19),
    status: z.enum(['done', 'skipped']),
    performance: SharedPerformanceSchema.nullable(),
  }),
  /** The partner left the session. The reason is never sent: a safety stop looks like any other stop to the partner. */
  z.strictObject({ type: z.literal('left') }),
  z.strictObject({ type: z.literal('score'), points: z.number().min(0).max(100), status: z.enum(['scoring', 'complete', 'ended']) }),
  z.strictObject({ type: z.literal('bodyweight'), kg: z.number().min(25).max(350) }),
]);
export type PairEvent = z.infer<typeof PairEventSchema>;
export type PairEventType = PairEvent['type'];

/** Client → server over the WebSocket (ADR-001: WebSocket only for multi-device Fair Pair). The token travels in the first message, never in the URL. */
export const PairClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('hello'), token: z.string().min(1).max(4096), pairSessionId: UuidSchema, lastSeq: z.number().int().min(0) }),
  /** `clientEventId` makes a resend after a reconnect idempotent. */
  z.strictObject({ type: z.literal('event'), clientEventId: UuidSchema, event: PairEventSchema }),
]);
export type PairClientMessage = z.infer<typeof PairClientMessageSchema>;

export const PairServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('welcome'),
    slot: ParticipantSlotSchema,
    seq: z.number().int().min(0),
    participants: z.array(z.strictObject({ slot: ParticipantSlotSchema, displayName: DisplayNameSchema, connected: z.boolean() })),
    challenge: z.boolean(),
  }),
  z.strictObject({ type: z.literal('event'), seq: z.number().int().positive(), from: ParticipantSlotSchema, clientEventId: UuidSchema, event: PairEventSchema }),
  z.strictObject({ type: z.literal('presence'), slot: ParticipantSlotSchema, connected: z.boolean() }),
  z.strictObject({ type: z.literal('error'), code: z.string().regex(/^[a-z0-9_.]{1,80}$/) }),
]);
export type PairServerMessage = z.infer<typeof PairServerMessageSchema>;

/** `jurisdiction`: the variant of the legal texts this person accepted (their own L2 gate is checked in it). */
export const CreatePairSessionRequestSchema = z.strictObject({
  displayName: DisplayNameSchema,
  scopes: z.array(PairSharingScopeSchema).max(PAIR_SHARING_SCOPES.length),
  jurisdiction: JurisdictionSchema,
});
/**
 * Characters of a multi-device join code (API-4: 32^8 ≈ 1.1·10^12 codes, with the join rate limits on
 * the server; six characters could be guessed). Alphabet without 0/O and 1/I, which are easy to confuse.
 */
export const PAIR_JOIN_CODE_LENGTH = 8;
export const PAIR_JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JoinCodeSchema = z.string().regex(new RegExp(`^[${PAIR_JOIN_CODE_ALPHABET}]{${PAIR_JOIN_CODE_LENGTH}}$`));
export const CreatePairSessionResponseSchema = z.strictObject({ pairSessionId: UuidSchema, joinCode: JoinCodeSchema });
export const JoinPairSessionRequestSchema = z.strictObject({
  joinCode: JoinCodeSchema,
  displayName: DisplayNameSchema,
  scopes: z.array(PairSharingScopeSchema).max(PAIR_SHARING_SCOPES.length),
  jurisdiction: JurisdictionSchema,
});
export const JoinPairSessionResponseSchema = z.strictObject({ pairSessionId: UuidSchema, slot: ParticipantSlotSchema, challenge: z.boolean() });
