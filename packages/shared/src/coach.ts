import { z } from 'zod';
import { IsoDateTimeSchema, LocaleSchema, UuidSchema } from './common.js';
import { ReasonCodeSchema } from './assessment.js';
import { defineConfig } from './config.js';
import { JointSchema, SlugSchema } from './exercise.js';
import { JurisdictionSchema } from './privacy.js';
import { IsoDateSchema, ProgramRecordSchema, ReflowRecordSchema } from './program.js';
import { PainPhaseSchema } from './recovery.js';
import { ExecutionLogSchema, GenerateSessionInputSchema, PlannedExerciseSchema, RedFlagSymptomSchema, SessionPlanSchema } from './session.js';

/**
 * M11 AI coach contracts (docs/specs/M11-ai-coach.md, ADR-031).
 *
 * S6: the model can only act through the tools below. Their inputs carry no
 * load, no set, no effort and no protocol: a tool names WHAT the user wants
 * changed (an exercise to swap, the minutes available, a pain report, a
 * session to move), and the engine decides the prescription. Every tool
 * schema is strict: an extra field (a load, a target RIR) makes the call
 * invalid, and a tool name outside this list is refused.
 */
export const COACH_TOOL_NAMES = ['swapExercise', 'adjustSessionTime', 'requestDeload', 'explainPrescription', 'logPain', 'reschedule', 'reportRedFlag'] as const;
export const CoachToolNameSchema = z.enum(COACH_TOOL_NAMES);
export type CoachToolName = z.infer<typeof CoachToolNameSchema>;

/** Tools that change the plan or the user's records (a refusal of one blocks the others for the rest of the turn). */
export const PLAN_CHANGING_TOOLS: readonly CoachToolName[] = Object.freeze(['swapExercise', 'adjustSessionTime', 'requestDeload', 'logPain', 'reschedule']);

/**
 * Bounds of what a user may ask the coach for (not prescriptions: the engine
 * decides the session inside them). Engineering defaults (CLAUDE.md rule 4).
 */
const BOUNDS_SOURCE = 'docs/adr/ADR-031-ai-coach.md (engineering default: bounds of a request, not a training value)';
export const COACH_TOOL_BOUNDS = defineConfig({
  /** Shortest session a user can ask for (the engine may still answer that there is not enough time). */
  minutesMin: { value: 10, unit: 'min', source: BOUNDS_SOURCE, validated: false },
  /** Longest session a user can ask for through the coach. */
  minutesMax: { value: 180, unit: 'min', source: BOUNDS_SOURCE, validated: false },
});
/** A plan holds at most 20 exercises (the execution-log schemas' exercise index bound). */
const EXERCISE_INDEX_MAX = 19;

export const CoachToolInputSchemas = {
  swapExercise: z.strictObject({
    exerciseIndex: z.number().int().min(0).max(EXERCISE_INDEX_MAX),
    reason: z.enum(['user', 'pain', 'equipment']),
    /** An exercise the user asked for by name; used only if the engine offers it as a valid replacement. */
    preferredExerciseId: SlugSchema.optional(),
  }),
  adjustSessionTime: z.strictObject({ minutes: z.number().int().min(COACH_TOOL_BOUNDS.minutesMin.value).max(COACH_TOOL_BOUNDS.minutesMax.value) }),
  requestDeload: z.strictObject({}),
  explainPrescription: z.strictObject({ exerciseIndex: z.number().int().min(0).max(EXERCISE_INDEX_MAX).optional() }),
  logPain: z.strictObject({ joint: JointSchema, score: z.number().int().min(0).max(10), phase: PainPhaseSchema.optional() }),
  reschedule: z.strictObject({ sessionId: z.string().regex(/^w\d{2}\.s\d$/).optional() }),
  reportRedFlag: z.strictObject({ symptom: RedFlagSymptomSchema }),
} as const satisfies Record<CoachToolName, z.ZodType>;

export type CoachToolInput<T extends CoachToolName> = z.infer<(typeof CoachToolInputSchemas)[T]>;

/**
 * The minimal context the coach may see (spec: profile summary, SafetyProfile,
 * current program and recent logs), as the device holds it. The server
 * replaces its safety-relevant parts with what it stores (the SafetyProfile of
 * the latest stored screening, the S3 lock and S2 flags of the stored logs,
 * the stored program and reflows) before any tool runs.
 */
export const CoachTodaySchema = z.strictObject({
  /** The engine input for today's session (M02 todayInput on the device). */
  input: GenerateSessionInputSchema,
  /** The plan the engine made from it (null: not generated yet). */
  plan: SessionPlanSchema.nullable(),
  /** The session is running (swaps apply to it; time and deload changes only before it starts). */
  started: z.boolean(),
  /** Generation facts of the plan (the engine is deterministic for a clock and a seed). */
  generatedAt: IsoDateTimeSchema,
  seed: z.number().int(),
});
export type CoachToday = z.infer<typeof CoachTodaySchema>;

export const CoachProgramContextSchema = z.strictObject({
  record: ProgramRecordSchema,
  reflows: z.array(ReflowRecordSchema).max(200),
  /** The user's local calendar date. */
  today: IsoDateSchema,
});
export type CoachProgramContext = z.infer<typeof CoachProgramContextSchema>;

export const CoachContextSchema = z.strictObject({
  locale: LocaleSchema,
  jurisdiction: JurisdictionSchema,
  today: CoachTodaySchema.nullable(),
  program: CoachProgramContextSchema.nullable(),
});
export type CoachContext = z.infer<typeof CoachContextSchema>;

/** A reference to reviewed content the answer is grounded on (coach knowledge registry or M06 exercise wording). */
export const CoachContentIdSchema = z.string().regex(/^(kb|exercise)\.[a-z][a-z0-9_]{1,63}$/);
export type CoachContentId = z.infer<typeof CoachContentIdSchema>;

/** Safety classification of a user message (deterministic pre-screen, FR/EN). */
export const COACH_SAFETY_CATEGORIES = [
  'ok',
  'red_flag',
  'crisis',
  'diagnosis_request',
  'medication_request',
  'extreme_diet',
  'minor',
  'pregnancy',
  'impersonation_request',
  'jailbreak',
  'bypass_request',
  'human_check',
] as const;
export const CoachSafetyCategorySchema = z.enum(COACH_SAFETY_CATEGORIES);
export type CoachSafetyCategory = z.infer<typeof CoachSafetyCategorySchema>;

/** Values of a template reply (ICU parameters): a number, a short string, or another message key the client renders first (an exercise or joint name). */
export const CoachTemplateValueSchema = z.union([z.number().finite(), z.string().max(400), z.strictObject({ key: z.string().regex(/^[a-z][a-zA-Z0-9_.]{2,160}$/) })]);
export const CoachTemplateValuesSchema = z.record(z.string().regex(/^[a-z][a-zA-Z]{0,30}$/), CoachTemplateValueSchema);

/**
 * One part of a coach reply. The API never returns app wording (rule 5):
 * app copy travels as an i18n key the client renders in FR or EN; only a
 * model's own words travel as text (after the output guard).
 */
export const CoachReplyPartSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('template'), key: z.string().regex(/^[a-z][a-zA-Z0-9_.]{2,160}$/), values: CoachTemplateValuesSchema }),
  z.strictObject({ kind: z.literal('model'), text: z.string().min(1).max(4000), locale: LocaleSchema }),
]);
export type CoachReplyPart = z.infer<typeof CoachReplyPartSchema>;

export const CoachReplySchema = z.strictObject({
  parts: z.array(CoachReplyPartSchema).min(1).max(40),
  references: z.array(CoachContentIdSchema).max(10),
  category: CoachSafetyCategorySchema,
  /** How the reply was produced: a deterministic safety or offline path, or a model (after the output guard). */
  source: z.enum(['deterministic', 'model', 'guard_fallback', 'offline', 'cache']),
});
export type CoachReply = z.infer<typeof CoachReplySchema>;

/** What a tool did. Only the engine's own outputs appear here; the device applies session proposals through its stores. */
export const CoachActionSchema = z.discriminatedUnion('type', [
  /** A new plan for today from generateSession with the change applied (time, lighter day, a new red joint): the device starts it from `input`. */
  z.strictObject({ type: z.literal('session_proposal'), change: z.enum(['time', 'deload', 'pain']), input: GenerateSessionInputSchema, plan: SessionPlanSchema, reasonCodes: z.array(ReasonCodeSchema).max(50) }),
  /** A replacement the engine prescribed for an exercise (M02 replacementsFor), as an in-session swap. */
  z.strictObject({ type: z.literal('swap_proposal'), planId: UuidSchema, exerciseIndex: z.number().int().min(0).max(19), fromExerciseId: SlugSchema, replacement: PlannedExerciseSchema }),
  /** An explanation of the plan from its reason codes (explainPrescription). */
  z.strictObject({ type: z.literal('explanation'), planId: UuidSchema, exerciseIndex: z.number().int().min(0).max(19).nullable(), reasonCodes: z.array(ReasonCodeSchema).max(80) }),
  /** A record the coach wrote for the user through the sync validators (M05 pain report, M08 reflow, S3 red flag). */
  z.strictObject({ type: z.literal('record'), collection: z.enum(['execution_logs', 'program_reflows']), recordId: UuidSchema, data: z.record(z.string(), z.unknown()) }),
  /** S3: the M05 stop flow: end the session, show seek-care guidance, lock intensity until a medical review is attested. */
  z.strictObject({ type: z.literal('red_flag_stop'), symptom: RedFlagSymptomSchema, log: ExecutionLogSchema }),
]);
export type CoachAction = z.infer<typeof CoachActionSchema>;

export const TOOL_CALL_STATUSES = ['applied', 'proposed', 'refused', 'invalid'] as const;
export const ToolCallStatusSchema = z.enum(TOOL_CALL_STATUSES);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

/** ToolCallAudit: every tool call the model made, valid or not (stored with the conversation; an event without its input goes to the defensibility log). */
export const ToolCallAuditSchema = z.strictObject({
  id: UuidSchema,
  tool: z.string().min(1).max(64),
  /** The input as the model sent it, when it parsed as JSON (health data: stored with the conversation only). */
  input: z.unknown(),
  status: ToolCallStatusSchema,
  /** Why it was refused or invalid, or what the engine did. */
  reasonCode: ReasonCodeSchema,
  reasonCodes: z.array(ReasonCodeSchema).max(80),
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  at: IsoDateTimeSchema,
});
export type ToolCallAudit = z.infer<typeof ToolCallAuditSchema>;

export const CoachTurnResultSchema = z.strictObject({
  reply: CoachReplySchema,
  actions: z.array(CoachActionSchema).max(10),
  toolCalls: z.array(ToolCallAuditSchema).max(20),
});
export type CoachTurnResult = z.infer<typeof CoachTurnResultSchema>;

// ------------------------------------------------------------------ API

/** L5: the AI disclosure that opens every conversation (the M20 `ai_coach` notice, rendered by the client) and the persistent label key. */
export const CoachDisclosureSchema = z.strictObject({
  noticeId: z.literal('ai_coach'),
  version: z.number().int().positive(),
  titleKey: z.string(),
  bodyKey: z.string(),
  labelKey: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CoachDisclosure = z.infer<typeof CoachDisclosureSchema>;

export const StartConversationRequestSchema = z.strictObject({ locale: LocaleSchema, jurisdiction: JurisdictionSchema });
export type StartConversationRequest = z.infer<typeof StartConversationRequestSchema>;
export const StartConversationResponseSchema = z.strictObject({ conversationId: UuidSchema, disclosure: CoachDisclosureSchema, startedAt: IsoDateTimeSchema });
export type StartConversationResponse = z.infer<typeof StartConversationResponseSchema>;

export const COACH_MESSAGE_MAX_CHARS = 2000;
export const CoachMessageRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(COACH_MESSAGE_MAX_CHARS),
  context: CoachContextSchema,
});
export type CoachMessageRequest = z.infer<typeof CoachMessageRequestSchema>;
export const CoachMessageResponseSchema = CoachTurnResultSchema.extend({ messageId: UuidSchema, conversationId: UuidSchema });
export type CoachMessageResponse = z.infer<typeof CoachMessageResponseSchema>;

export const CoachStoredMessageSchema = z.strictObject({
  id: UuidSchema,
  role: z.enum(['disclosure', 'user', 'coach']),
  /** user: the text typed; coach: the reply; disclosure: the notice reference. */
  content: z.unknown(),
  at: IsoDateTimeSchema,
});
export type CoachStoredMessage = z.infer<typeof CoachStoredMessageSchema>;

export const CoachConversationSchema = z.strictObject({
  conversationId: UuidSchema,
  locale: LocaleSchema,
  jurisdiction: JurisdictionSchema,
  startedAt: IsoDateTimeSchema,
  messages: z.array(CoachStoredMessageSchema),
  toolCalls: z.array(ToolCallAuditSchema),
});
export type CoachConversation = z.infer<typeof CoachConversationSchema>;
