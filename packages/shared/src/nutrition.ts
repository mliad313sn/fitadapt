import { z } from 'zod';
import { ReasonCodeSchema } from './assessment.js';
import { IsoDateTimeSchema, SupersedesSchema, UuidSchema } from './common.js';
import { defineConfig } from './config.js';
import { SafetyProfileSchema, SlugSchema } from './exercise.js';
import { CalendarDateSchema } from './profile.js';
import { IsoDateSchema } from './program.js';

/**
 * M10 — Nutrition & energy balance contracts
 * (docs/specs/M10-nutrition-energy-balance.md, ADR-022).
 *
 * Entities: EnergyModel (BMR × activity factor, then an adaptive expenditure
 * from the weight trend and logged intake), NutritionTarget (what the engine
 * prescribes: an energy and protein target, or supportive habits without
 * numbers), FoodItem and Portion (the original, unvalidated seed of generic
 * foods and regional dishes), IntakeLog (append-only; hand portions or a
 * food from the seed), HabitCheck.
 *
 * General guidance only (RSK-03): no medical nutrition therapy, no
 * condition-specific diet. The S4 floors are enforced in packages/safety and
 * are never configuration. Everything is metric; display follows the user.
 */

/** Plausibility bounds of nutrition inputs (catch typing errors; not health thresholds). */
export const NUTRITION_INPUT_BOUNDS = defineConfig({
  goalWeightKgMin: { value: 25, unit: 'kg', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS reused by M10), no external source', validated: false },
  goalWeightKgMax: { value: 350, unit: 'kg', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS reused by M10), no external source', validated: false },
  portionCountMax: { value: 10, unit: 'portions per entry', source: 'engineering default: input plausibility bound (M10), no external source', validated: false },
  entryEnergyKcalMax: { value: 5000, unit: 'kcal per entry', source: 'engineering default: input plausibility bound (M10), no external source', validated: false },
});
const bound = (key: keyof typeof NUTRITION_INPUT_BOUNDS) => NUTRITION_INPUT_BOUNDS[key].value;

// ------------------------------------------------------------------ goals

/** fat_loss is a deficit feature (S4); maintain and muscle_gain are not. */
export const NUTRITION_GOALS = ['fat_loss', 'maintain', 'muscle_gain'] as const;
export const NutritionGoalSchema = z.enum(NUTRITION_GOALS);
export type NutritionGoal = z.infer<typeof NutritionGoalSchema>;

/** Activity levels of the Mifflin-St Jeor × activity factor estimate (factors in the engine config). */
export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'very_active', 'extra_active'] as const;
export const ActivityLevelSchema = z.enum(ACTIVITY_LEVELS);
export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;

/**
 * The equation uses a sex term. The user chooses which estimate to use;
 * "unspecified" uses the midpoint of the two terms (engine config).
 */
export const ESTIMATE_SEXES = ['female', 'male', 'unspecified'] as const;
export const EstimateSexSchema = z.enum(ESTIMATE_SEXES);
export type EstimateSex = z.infer<typeof EstimateSexSchema>;

/** "numbers": energy and protein targets; "habits": the user chose tracking without numbers (always allowed). */
export const TRACKING_STYLES = ['numbers', 'habits'] as const;
export const TrackingStyleSchema = z.enum(TRACKING_STYLES);
export type TrackingStyle = z.infer<typeof TrackingStyleSchema>;

/** Planned-loss choices offered for a fat-loss goal (% body weight per week; S4 caps at 1 whatever is asked). */
export const PLANNED_LOSS_OPTIONS = [0.25, 0.5, 0.75, 1] as const;

/** Simple habits (spec Scope): shown in every mode, the only content in the supportive mode. */
export const NUTRITION_HABITS = ['protein_each_meal', 'vegetables', 'hydration'] as const;
export const NutritionHabitSchema = z.enum(NUTRITION_HABITS);
export type NutritionHabit = z.infer<typeof NutritionHabitSchema>;

// ---------------------------------------------------------- engine input

/**
 * The adaptive expenditure observation of a window (engine
 * `adaptiveObservation`): the mean logged intake of the days with a log and
 * the change of the M04 weight trend over the window.
 */
export const AdaptiveObservationSchema = z.strictObject({
  from: IsoDateSchema,
  to: IsoDateSchema,
  windowDays: z.number().int().positive(),
  loggedDays: z.number().int().min(0),
  meanIntakeKcal: z.number().min(0).max(20_000),
  trendChangeKg: z.number().min(-50).max(50),
});
export type AdaptiveObservation = z.infer<typeof AdaptiveObservationSchema>;

/** Everything the target is derived from, so the server can re-derive it (ADR-022). */
export const NutritionInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goal: NutritionGoalSchema,
  trackingStyle: TrackingStyleSchema,
  activityLevel: ActivityLevelSchema,
  sexForEstimate: EstimateSexSchema,
  /** Latest body weight in force (M04 trend or M01 profile); null = not given. */
  weightKg: z.number().min(25).max(350).nullable(),
  heightCm: z.number().min(100).max(250).nullable(),
  birthDate: CalendarDateSchema,
  today: IsoDateSchema,
  /** Requested pace for fat loss (% body weight per week); the engine and S4 cap it. */
  plannedLossPercentPerWeek: z.number().min(0).max(5).nullable(),
  goalWeightKg: z.number().min(bound('goalWeightKgMin')).max(bound('goalWeightKgMax')).nullable(),
  safetyProfile: SafetyProfileSchema,
  /** M04 sustained-loss hand-offs received (detection dates, oldest first). */
  guardrailEvents: z.array(IsoDateSchema).max(200),
  /** The adaptive observation of the last window (null until enough days are logged). */
  adaptive: AdaptiveObservationSchema.nullable(),
  /** Expenditure of the previous target (the adaptive update starts from it); null for the first. */
  previousExpenditureKcal: z.number().positive().max(10_000).nullable(),
});
export type NutritionInput = z.infer<typeof NutritionInputSchema>;

// --------------------------------------------------------------- outputs

export const EnergyModelSchema = z.strictObject({
  /** Mifflin-St Jeor estimate (kcal/day). */
  bmrKcal: z.number().positive(),
  activityFactor: z.number().positive(),
  /** BMR × activity factor. */
  formulaExpenditureKcal: z.number().positive(),
  /** Expenditure the target uses: the formula, or the adaptive update. */
  expenditureKcal: z.number().positive(),
  method: z.enum(['formula', 'adaptive']),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type EnergyModel = z.infer<typeof EnergyModelSchema>;

export const TARGET_MODES = ['numeric', 'supportive', 'needs_measurements'] as const;
export const TargetModeSchema = z.enum(TARGET_MODES);
export type TargetMode = z.infer<typeof TargetModeSchema>;

/**
 * The engine's nutrition prescription. `numeric` carries the energy and
 * protein numbers; `supportive` (deficit features disabled, or the user chose
 * habits) and `needs_measurements` carry none: the app shows habits and
 * supportive resources, never a calorie number.
 */
export const NutritionTargetSchema = z
  .strictObject({
    targetId: UuidSchema,
    engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    rulesVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    computedOn: IsoDateSchema,
    mode: TargetModeSchema,
    goal: NutritionGoalSchema,
    energyModel: EnergyModelSchema.nullable(),
    energy: z
      .strictObject({
        targetKcal: z.number().int().positive(),
        /** S4: the estimated BMR; the target is never below it. */
        floorKcal: z.number().int().positive(),
        deficitKcal: z.number().int().min(0),
        surplusKcal: z.number().int().min(0),
      })
      .nullable(),
    protein: z.strictObject({ minG: z.number().int().positive(), maxG: z.number().int().positive() }).nullable(),
    /** The pace the target plans (0 unless a deficit is planned; S4: ≤ 1). */
    plannedLossPercentPerWeek: z.number().min(0).max(1),
    /** Kept only when at or above the S4 floor (BMI 18.5 for the height). */
    goalWeightKg: z.number().positive().nullable(),
    /** Deficit features were allowed for this input (S4). */
    deficitAllowed: z.boolean(),
    habits: z.array(NutritionHabitSchema).min(1),
    reasonCodes: z.array(ReasonCodeSchema).min(1),
  })
  .refine((t) => (t.mode === 'numeric') === (t.energy !== null && t.protein !== null && t.energyModel !== null), { message: 'numbers exist only in the numeric mode' })
  .refine((t) => t.energy === null || t.energy.targetKcal >= t.energy.floorKcal, { message: 'S4: the target is never below the estimated BMR' })
  .refine((t) => t.deficitAllowed || (t.plannedLossPercentPerWeek === 0 && (t.energy === null || t.energy.deficitKcal === 0)), { message: 'S4: no deficit when deficit features are disabled' });
export type NutritionTarget = z.infer<typeof NutritionTargetSchema>;

/** Synced record (append-only): the input and the target the engine derived from it; the latest counts. */
export const NutritionPlanRecordSchema = z.strictObject({
  input: NutritionInputSchema,
  target: NutritionTargetSchema,
  /** Why it was computed: set-up, the weekly update, an M04 guardrail hand-off, a style change. */
  reason: z.enum(['setup', 'weekly_update', 'guardrail', 'settings_changed']),
  createdAt: IsoDateTimeSchema,
  /**
   * The target(s) this plan replaces (null for the first). ADR-023: the chain, never the clock, orders plans;
   * a list when the writer knew several heads (two devices), so the new plan replaces all of them.
   */
  supersedes: z.union([UuidSchema, SupersedesSchema.min(2)]).nullable(),
});
export type NutritionPlanRecord = z.infer<typeof NutritionPlanRecordSchema>;

// ------------------------------------------------------------------ foods

export const FOOD_CATEGORIES = ['grains', 'legumes', 'vegetables', 'fruit', 'dairy', 'eggs', 'meat', 'fish', 'nuts_seeds', 'oils_fats', 'drinks', 'sweets', 'dishes', 'snacks', 'bread_bakery', 'sauces'] as const;
export const FoodCategorySchema = z.enum(FOOD_CATEGORIES);
export type FoodCategory = z.infer<typeof FoodCategorySchema>;

/** Regions whose typical dishes the seed carries (vision: local food intelligence). */
export const FOOD_REGIONS = ['generic', 'west_africa', 'senegal', 'france', 'north_africa', 'central_africa'] as const;
export const FoodRegionSchema = z.enum(FOOD_REGIONS);

/** Portion names (FR/EN wording in packages/i18n `food.portion.<id>`). */
export const PORTION_IDS = ['g100', 'plate', 'bowl', 'small_bowl', 'piece', 'slice', 'cup', 'glass', 'tablespoon', 'teaspoon', 'handful', 'ladle', 'sandwich', 'can', 'pot'] as const;
export const PortionIdSchema = z.enum(PORTION_IDS);
export type PortionId = z.infer<typeof PortionIdSchema>;

export const PortionSchema = z.strictObject({
  id: PortionIdSchema,
  /** Typical grams (or millilitres for drinks) of this portion. */
  grams: z.number().positive().max(2000),
});
export type Portion = z.infer<typeof PortionSchema>;

/** Licences the food seed may carry: only commercial-compatible, non-share-alike ones (L6; ODbL is refused). */
export const FOOD_DATA_LICENCES = ['Owned', 'CC0-1.0', 'CC-BY-4.0'] as const;

/**
 * Where a food's values come from. The M10 seed is original: every value is
 * an engineer's estimate (`estimate`), to be verified against a licensed
 * composition table by seat A4 before it is validated. `public` must cite a
 * public source; none is used yet.
 */
export const FoodSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('estimate'), note: z.string().min(20) }),
  z.strictObject({ kind: z.literal('public'), citation: z.string().min(10), url: z.url().optional() }),
]);

export const FoodItemSchema = z
  .strictObject({
    id: SlugSchema,
    category: FoodCategorySchema,
    regions: z.array(FoodRegionSchema).min(1),
    /** Names are i18n messages `food.<id>.name` (FR/EN); a local name, when known, is `food.<id>.local`. */
    hasLocalName: z.boolean(),
    energyKcalPer100g: z.number().min(0).max(900),
    proteinGPer100g: z.number().min(0).max(100),
    portions: z.array(PortionSchema).min(1),
    /** The portion shown first (the typical one). */
    defaultPortion: PortionIdSchema,
    source: FoodSourceSchema,
    licence: z.enum(FOOD_DATA_LICENCES),
    validated: z.boolean(),
    validatedBy: z.string().min(1).optional(),
    signOff: z.string().min(1).optional(),
  })
  .refine((f) => f.portions.some((p) => p.id === f.defaultPortion), { message: 'the default portion must be one of the portions' })
  .refine((f) => new Set(f.portions.map((p) => p.id)).size === f.portions.length, { message: 'duplicate portion' })
  .refine((f) => !f.validated || (f.validatedBy !== undefined && f.signOff !== undefined), { message: 'validated:true requires validatedBy and signOff' });
export type FoodItem = z.infer<typeof FoodItemSchema>;

// ------------------------------------------------------------ intake logs

/** Hand portions (quick log): palm of protein, fist of vegetables, cupped hand of carbohydrates, thumb of oils and fats. */
export const HAND_PORTIONS = ['protein_palm', 'vegetables_fist', 'carbs_cupped_hand', 'fats_thumb'] as const;
export const HandPortionSchema = z.enum(HAND_PORTIONS);
export type HandPortion = z.infer<typeof HandPortionSchema>;

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const MealSchema = z.enum(MEALS);
export type Meal = z.infer<typeof MealSchema>;

export const IntakeEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hand_portion'), portion: HandPortionSchema, count: z.number().int().min(1).max(bound('portionCountMax')) }),
  z.strictObject({ kind: z.literal('food'), foodId: SlugSchema, portionId: PortionIdSchema, count: z.number().min(0.25).max(bound('portionCountMax')) }),
]);
export type IntakeEntry = z.infer<typeof IntakeEntrySchema>;

/**
 * One logged intake (append-only). The estimate is computed by the engine
 * when logged and stored with it; a correction is a new entry naming the one
 * it corrects (`removed: true` takes it out).
 */
export const IntakeLogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  loggedOn: IsoDateSchema,
  at: IsoDateTimeSchema,
  meal: MealSchema.nullable(),
  entry: IntakeEntrySchema,
  estimate: z.strictObject({ energyKcal: z.number().min(0).max(bound('entryEnergyKcalMax')), proteinG: z.number().min(0).max(500) }),
  correctionOf: UuidSchema.nullable(),
  removed: z.boolean(),
});
export type IntakeLog = z.infer<typeof IntakeLogSchema>;

/** A habit ticked for a day (append-only; the latest of a day and habit counts). */
export const HabitCheckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  habit: NutritionHabitSchema,
  checkedOn: IsoDateSchema,
  done: z.boolean(),
  at: IsoDateTimeSchema,
});
export type HabitCheck = z.infer<typeof HabitCheckSchema>;

/** Sync collections of M10 (packages/sync registers them append-only; health data on the server). */
export const NUTRITION_COLLECTIONS = { plans: 'nutrition_plans', intakeLogs: 'intake_logs', habitChecks: 'habit_checks' } as const;
