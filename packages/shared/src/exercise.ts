import { z } from 'zod';
import { ConfigValueSchema } from './config.js';
import { IsoDateTimeSchema } from './common.js';

/**
 * M06 — Exercise library and knowledge graph contracts
 * (docs/specs/M06-exercise-library-knowledge-graph.md, ADR-011).
 *
 * The graph holds exercises, muscles and equipment as nodes and typed edges
 * between them: PROGRESSES_TO, REGRESSES_TO, SUBSTITUTES (stimulus similarity
 * 0–1) and REQUIRES (equipment). Wording (names, cues, common mistakes) lives
 * in packages/i18n (CLAUDE.md rule 5); exercises reference it by key.
 */

export const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'lower-case slug');

// ---------------------------------------------------------------- taxonomies

/** Movement-pattern slots (M02) plus non-strength categories used by M05 and M03. */
export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'core',
  'isolation',
  'balance',
  'mobility',
  'locomotion',
] as const;
export const MovementPatternSchema = z.enum(MOVEMENT_PATTERNS);
export type MovementPattern = z.infer<typeof MovementPatternSchema>;

/** Joints of the joint-load profile, read by the S2 pain gate (M05) and Fair Pair scaling (M09). */
export const JOINTS = ['shoulder', 'elbow', 'wrist', 'lumbar', 'hip', 'knee', 'ankle'] as const;
export const JointSchema = z.enum(JOINTS);
export type Joint = z.infer<typeof JointSchema>;

export const JOINT_LOAD_LEVELS = ['low', 'medium', 'high'] as const;
export const JointLoadLevelSchema = z.enum(JOINT_LOAD_LEVELS);
export type JointLoadLevel = z.infer<typeof JointLoadLevelSchema>;

/** Every joint must be rated: a missing rating would silently pass the S2 pain gate. */
export const JointLoadProfileSchema = z.strictObject({
  shoulder: JointLoadLevelSchema,
  elbow: JointLoadLevelSchema,
  wrist: JointLoadLevelSchema,
  lumbar: JointLoadLevelSchema,
  hip: JointLoadLevelSchema,
  knee: JointLoadLevelSchema,
  ankle: JointLoadLevelSchema,
});
export type JointLoadProfile = z.infer<typeof JointLoadProfileSchema>;

/** Ordered from least to most impact; the order is used by the M01 SafetyProfile impact ceiling. */
export const IMPACT_LEVELS = ['none', 'low', 'moderate', 'high'] as const;
export const ImpactLevelSchema = z.enum(IMPACT_LEVELS);
export type ImpactLevel = z.infer<typeof ImpactLevelSchema>;

/** Ordered from easiest to hardest to learn. */
export const SKILL_LEVELS = ['entry', 'beginner', 'intermediate', 'advanced', 'expert'] as const;
export const SkillLevelSchema = z.enum(SKILL_LEVELS);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const LOAD_TYPES = ['bodyweight', 'external', 'band', 'machine', 'none'] as const;
export const LoadTypeSchema = z.enum(LOAD_TYPES);
export type LoadType = z.infer<typeof LoadTypeSchema>;

/**
 * Contraindication tags: properties of the movement that a SafetyProfile (M01)
 * or a qualified professional may ask to avoid. They describe the exercise,
 * never the user, and imply no diagnosis.
 */
export const CONTRAINDICATION_TAGS = [
  'inversion',
  'breath_hold_bracing',
  'overhead_loading',
  'loaded_spinal_flexion',
  'floor_transfer',
  'prone_position',
  'supine_position',
  'jumping_landing',
  'high_balance_demand',
  'end_range_shoulder',
  'deep_knee_flexion',
  'loaded_wrist_extension',
  'hanging',
] as const;
export const ContraindicationTagSchema = z.enum(CONTRAINDICATION_TAGS);
export type ContraindicationTag = z.infer<typeof ContraindicationTagSchema>;

export const EXERCISE_TAGS = ['low_impact', 'balance', 'mobility', 'warm_up', 'calisthenics_skill', 'supported', 'isometric', 'eccentric_focus', 'conditioning'] as const;
export const ExerciseTagSchema = z.enum(EXERCISE_TAGS);
export type ExerciseTag = z.infer<typeof ExerciseTagSchema>;

// -------------------------------------------------------------------- muscles

export const MUSCLE_IDS = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'upper_back',
  'lats',
  'traps',
  'rotator_cuff',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'deep_core',
  'lower_back',
  'glutes',
  'hip_abductors',
  'hip_adductors',
  'hip_flexors',
  'quads',
  'hamstrings',
  'calves',
  'tibialis',
] as const;
export const MuscleIdSchema = z.enum(MUSCLE_IDS);
export type MuscleId = z.infer<typeof MuscleIdSchema>;

export const MuscleSchema = z.strictObject({
  id: MuscleIdSchema,
  region: z.enum(['upper', 'core', 'lower']),
  /** i18n key of the display name (packages/i18n). */
  nameKey: z.string().regex(/^library\.muscle\.[a-z_]+$/),
});
export type Muscle = z.infer<typeof MuscleSchema>;

// ------------------------------------------------------------------ equipment

/**
 * Equipment taxonomy shared with M01 (equipment profiles per location) and M02
 * (load rounding). Ids are stable: M01 stores them in EquipmentProfile.
 */
export const EQUIPMENT_IDS = [
  'dumbbell',
  'kettlebell',
  'barbell',
  'weight_plate',
  'resistance_band',
  'mini_band',
  'exercise_mat',
  'door_anchor',
  'ab_wheel',
  'jump_rope',
  'parallettes',
  'box',
  'aerobic_step',
  'pull_up_bar',
  'parallel_bars',
  'low_bar',
  'gymnastic_rings',
  'suspension_trainer',
  'flat_bench',
  'adjustable_bench',
  'squat_rack',
  'smith_machine',
  'cable_station',
  'lat_pulldown',
  'assisted_pull_up_machine',
  'leg_press',
  'leg_curl_machine',
  'leg_extension_machine',
  'chest_press_machine',
  'sturdy_chair',
  'stationary_bike',
  'rowing_machine',
  'treadmill',
] as const;
export const EquipmentIdSchema = z.enum(EQUIPMENT_IDS);
export type EquipmentId = z.infer<typeof EquipmentIdSchema>;

export const EQUIPMENT_CATEGORIES = ['free_weight', 'band', 'accessory', 'bar', 'suspension', 'bench_rack', 'machine', 'cable', 'household', 'cardio'] as const;
export const EquipmentCategorySchema = z.enum(EQUIPMENT_CATEGORIES);
export type EquipmentCategory = z.infer<typeof EquipmentCategorySchema>;

export const EQUIPMENT_LOCATIONS = ['home', 'gym', 'park', 'travel'] as const;
export const EquipmentLocationSchema = z.enum(EQUIPMENT_LOCATIONS);
export type EquipmentLocation = z.infer<typeof EquipmentLocationSchema>;

export const EquipmentSchema = z.strictObject({
  id: EquipmentIdSchema,
  category: EquipmentCategorySchema,
  nameKey: z.string().regex(/^library\.equipment\.[a-z_]+$/),
  /** Where this item is typically found; drives the M01 checklist grouping, not availability. */
  locations: z.array(EquipmentLocationSchema).min(1),
  /** True if the load can be chosen (dumbbells, plates, stacks): M02 rounds to the user's increments. */
  loadable: z.boolean(),
  portable: z.boolean(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

/** One requirement group: any one of the listed items satisfies it. All groups of an exercise are required. */
export const EquipmentRequirementSchema = z.strictObject({
  anyOf: z.array(EquipmentIdSchema).min(1),
});
export type EquipmentRequirement = z.infer<typeof EquipmentRequirementSchema>;

// --------------------------------------------------------------------- review

export const REVIEW_STATUSES = ['pending', 'in_review', 'approved', 'rejected'] as const;
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** A council seat's review mark (docs/governance/03 §5): only a sign-off record can set it. */
export const ReviewMarkSchema = z.strictObject({
  seat: z.string().regex(/^[A-Z]\d{1,2}$/),
  signOff: z.string().regex(/^[\w./-]{1,200}$/),
  reviewedAt: IsoDateTimeSchema,
});
export type ReviewMark = z.infer<typeof ReviewMarkSchema>;

export const ContentReviewSchema = z.strictObject({
  /** The physio-review flag (A2). No exercise is published without it. */
  physio: ReviewMarkSchema.nullable(),
  /** Strength & conditioning review (A3). */
  coach: ReviewMarkSchema.nullable(),
});
export type ContentReview = z.infer<typeof ContentReviewSchema>;

// ------------------------------------------------------------------- exercise

const nameKey = z.string().regex(/^exercise\.[a-z][a-z0-9_]*\.name$/);
const cueKey = z.string().regex(/^exercise\.[a-z][a-z0-9_]*\.cue\.\d{1,2}$/);
const mistakeKey = z.string().regex(/^exercise\.[a-z][a-z0-9_]*\.mistake\.\d{1,2}$/);

export const ExerciseSchema = z
  .strictObject({
    id: SlugSchema,
    /** Content version of this exercise (ContentVersion.version). */
    contentVersion: z.number().int().positive(),
    nameKey,
    cueKeys: z.array(cueKey).min(1),
    mistakeKeys: z.array(mistakeKey).min(1),
    pattern: MovementPatternSchema,
    primaryMuscles: z.array(MuscleIdSchema).min(1),
    secondaryMuscles: z.array(MuscleIdSchema),
    equipment: z.array(EquipmentRequirementSchema),
    jointLoad: JointLoadProfileSchema,
    impact: ImpactLevelSchema,
    skill: SkillLevelSchema,
    unilateral: z.boolean(),
    loadType: LoadTypeSchema,
    /** Share of body mass moved, for bodyweight moves (M02 ladders, M09 scaling). A coefficient: carries source and validation. */
    bodyweightLoad: ConfigValueSchema.nullable(),
    contraindications: z.array(ContraindicationTagSchema),
    tags: z.array(ExerciseTagSchema),
    mediaAssetIds: z.array(SlugSchema),
    /** Where the content comes from (original authored text, CMS). */
    source: z.string().min(1),
    validated: z.boolean(),
    validatedBy: z.string().min(1).optional(),
    signOff: z.string().min(1).optional(),
    reviewStatus: ReviewStatusSchema,
    review: ContentReviewSchema,
  })
  .superRefine((e, ctx) => {
    if (e.validated && (e.validatedBy === undefined || e.signOff === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'validated:true requires validatedBy and signOff' });
    }
    if (e.validated && e.review.physio === null) {
      ctx.addIssue({ code: 'custom', message: 'validated:true requires the physio-review flag' });
    }
    if (e.reviewStatus === 'approved' && (e.review.physio === null || e.review.coach === null)) {
      ctx.addIssue({ code: 'custom', message: 'approved content needs both the physio and the coach review' });
    }
    if ((e.loadType === 'bodyweight') !== (e.bodyweightLoad !== null)) {
      ctx.addIssue({ code: 'custom', message: 'bodyweightLoad is required for bodyweight moves and only for them' });
    }
    const prefix = `exercise.${e.id}.`;
    for (const key of [e.nameKey, ...e.cueKeys, ...e.mistakeKeys]) {
      if (!key.startsWith(prefix)) ctx.addIssue({ code: 'custom', message: `${key} does not belong to ${e.id}` });
    }
    const overlap = e.primaryMuscles.filter((m) => e.secondaryMuscles.includes(m));
    if (overlap.length > 0) ctx.addIssue({ code: 'custom', message: `muscles both primary and secondary: ${overlap.join(', ')}` });
  });
export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * A user-defined exercise. The name is the user's own content (not app copy).
 * It is never offered as a substitute: it has no reviewed joint-load profile.
 */
export const CustomExerciseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  pattern: MovementPatternSchema,
  primaryMuscles: z.array(MuscleIdSchema).min(1),
  equipment: z.array(EquipmentRequirementSchema),
  createdAt: IsoDateTimeSchema,
});
export type CustomExercise = z.infer<typeof CustomExerciseSchema>;

// ---------------------------------------------------------------------- edges

export const EDGE_TYPES = ['PROGRESSES_TO', 'REGRESSES_TO', 'SUBSTITUTES', 'REQUIRES'] as const;
export const EdgeTypeSchema = z.enum(EDGE_TYPES);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

const edgeReview = {
  source: z.string().min(1),
  validated: z.boolean(),
  validatedBy: z.string().min(1).optional(),
  signOff: z.string().min(1).optional(),
};

export const ExerciseEdgeSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('PROGRESSES_TO'), from: SlugSchema, to: SlugSchema, ladderId: SlugSchema, ...edgeReview }),
    z.strictObject({ type: z.literal('REGRESSES_TO'), from: SlugSchema, to: SlugSchema, ladderId: SlugSchema, ...edgeReview }),
    z.strictObject({ type: z.literal('SUBSTITUTES'), from: SlugSchema, to: SlugSchema, similarity: z.number().min(0).max(1), ...edgeReview }),
    z.strictObject({ type: z.literal('REQUIRES'), from: SlugSchema, to: EquipmentIdSchema, group: z.number().int().nonnegative(), ...edgeReview }),
  ])
  .superRefine((e, ctx) => {
    if (e.type !== 'REQUIRES' && e.from === e.to) ctx.addIssue({ code: 'custom', message: 'an edge cannot point to itself' });
    if (e.validated && (e.validatedBy === undefined || e.signOff === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'validated:true requires validatedBy and signOff' });
    }
  });
export type ExerciseEdge = z.infer<typeof ExerciseEdgeSchema>;

// ---------------------------------------------------------------------- media

export const MEDIA_KINDS = ['image', 'animation', 'video', 'diagram'] as const;

/**
 * L6: licence, source and rights holder are nullable here so that a draft can
 * be recorded, but a MediaAsset cannot be published without all three
 * (PublishedMediaAssetSchema; packages/exercise-library publishMediaAsset).
 */
export const MediaAssetSchema = z.strictObject({
  id: SlugSchema,
  exerciseId: SlugSchema.nullable(),
  kind: z.enum(MEDIA_KINDS),
  path: z.string().regex(/^[\w./-]{1,200}$/),
  bytes: z.number().int().positive(),
  /** Reduced variant for low-bandwidth mode. */
  lowBandwidth: z.boolean(),
  /** Equipment-profile packs this asset is cached in for offline use. */
  packs: z.array(SlugSchema),
  licence: z.string().min(1).nullable(),
  source: z.string().min(1).nullable(),
  rightsHolder: z.string().min(1).nullable(),
  status: z.enum(['draft', 'published', 'retired']),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const PublishedMediaAssetSchema = MediaAssetSchema.extend({
  licence: z.string().min(1),
  source: z.string().min(1),
  rightsHolder: z.string().min(1),
  status: z.literal('published'),
});
export type PublishedMediaAsset = z.infer<typeof PublishedMediaAssetSchema>;

// ------------------------------------------------------------ content version

export const CONTENT_ENTITY_TYPES = ['exercise', 'edge', 'media'] as const;

export const ContentApprovalSchema = z.strictObject({
  role: z.enum(['physio', 'coach']),
  /** Opaque reviewer reference (never a name in git or logs). */
  reviewerRef: z.string().regex(/^[\w.-]{1,80}$/),
  seat: z.string().regex(/^[A-Z]\d{1,2}$/),
  signOff: z.string().regex(/^[\w./-]{1,200}$/),
  approvedAt: IsoDateTimeSchema,
});
export type ContentApproval = z.infer<typeof ContentApprovalSchema>;

export const ContentVersionSchema = z.strictObject({
  contentId: z.string().regex(/^[a-z0-9_.-]{1,80}$/),
  entityType: z.enum(CONTENT_ENTITY_TYPES),
  version: z.number().int().positive(),
  /** SHA-256 of the canonical JSON of the versioned entity. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: IsoDateTimeSchema,
  status: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']),
  approvals: z.array(ContentApprovalSchema),
});
export type ContentVersion = z.infer<typeof ContentVersionSchema>;

// ------------------------------------------------------------ safety inputs

export const JOINT_FLAGS = ['green', 'amber', 'red'] as const;
export const JointFlagSchema = z.enum(JOINT_FLAGS);
export type JointFlag = z.infer<typeof JointFlagSchema>;

/** Traffic-light pain state per joint from the M05 pain monitor; absent joints count as green. */
export const JointFlagsSchema = z.partialRecord(JointSchema, JointFlagSchema);
export type JointFlags = z.infer<typeof JointFlagsSchema>;

/**
 * SafetyProfile produced by M01 screening (S1). M06 defines the fields the
 * library needs; M01 owns the screening that fills them and may add fields.
 */
export const SafetyProfileSchema = z.strictObject({
  maxRPE: z.number().min(1).max(10),
  allowHIIT: z.boolean(),
  allowMaxTests: z.boolean(),
  impactCeiling: ImpactLevelSchema,
  /** Movement properties to avoid (from screening restrictions or a professional's advice). */
  avoidTags: z.array(ContraindicationTagSchema),
  /** Exercises the user asked to avoid (M01 limitations). */
  excludedExerciseIds: z.array(SlugSchema),
});
export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;

export function impactRank(level: ImpactLevel): number {
  return IMPACT_LEVELS.indexOf(level);
}

export function skillRank(level: SkillLevel): number {
  return SKILL_LEVELS.indexOf(level);
}
