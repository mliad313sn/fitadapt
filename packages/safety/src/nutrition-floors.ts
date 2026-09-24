import { SafetyProfileSchema, type SafetyProfile } from '@fitadapt/shared';
import { ageInYears, isValidCalendarDate, type CalendarDate } from './age-gate.js';
import type { SafetyCheck, SafetyViolation } from './evaluate.js';
import { NUTRITION_SAFETY_CONFIG } from './nutrition.config.js';
import { S4_DEFICIT_MINIMUM_AGE_YEARS } from './screening.js';

/**
 * S4 — nutrition floors (docs/specs/00-product-vision.md), owned by M10.
 * Invariants in code, never configuration:
 *
 * - the energy target is never below the estimated BMR, and never a number
 *   below an absolute minimum of 1,200 kcal/day: below it the user gets the
 *   supportive mode (habits, no calorie number) instead (A4/A6 pre-review,
 *   PO decision: stricter; NICE NG246 as cited there treats 800–1,200 kcal/day
 *   as a low-energy diet for specialist services only);
 * - the planned loss rate is at most 1 % of body weight per week;
 * - no goal weight below BMI 18.5 for the user's height;
 * - deficit features are disabled under 18 and for a user who reports being
 *   advised against calorie restriction (M01 SafetyProfile
 *   `deficitNutritionAllowed`), and — fail closed — when no valid screening
 *   exists or a special population (S7) applies.
 *
 * Every function here is pure and fails closed: an input it cannot read
 * (NaN, a negative weight, an unreadable profile, an impossible date) never
 * yields a deficit. The engine (packages/engine `nutrition`) builds every
 * target through `enforceNutritionFloors`; the server re-checks stored
 * targets with `nutritionTargetViolations`.
 */
export const S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK = 1 as const;
export const S4_MIN_GOAL_BMI = 18.5 as const;
/**
 * The absolute energy floor (kcal/day): no target number below it, whatever
 * the estimated BMR (docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md,
 * items M10-16 and the S4 section: "the higher of the estimated BMR and an
 * absolute minimum, for example 1,200 kcal/day … below that the app should
 * show supportive mode"). An invariant like the others: a constant, never
 * configuration, and it may only ever be raised. NOT VALIDATED: seats A4 and
 * A1 settle the number (listed in docs/status/M10.md).
 */
export const S4_MIN_ENERGY_KCAL_PER_DAY = 1200 as const;

const energyDensity = () => NUTRITION_SAFETY_CONFIG.energyDensityKcalPerKg.value;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export interface DeficitFeatures {
  readonly allowed: boolean;
  /** Why deficit features are off (safety.s4.*); empty when allowed. */
  readonly reasonCodes: readonly string[];
}

/** Whether deficit features (a fat-loss target, a planned loss) may be offered at all. */
export function deficitFeatures(safetyProfile: SafetyProfile, birthDate: CalendarDate, today: CalendarDate): DeficitFeatures {
  try {
    const parsed = SafetyProfileSchema.safeParse(safetyProfile);
    if (!parsed.success) return { allowed: false, reasonCodes: ['safety.s4.invalid_profile'] };
    const profile = parsed.data;
    const reasons: string[] = [];
    if (!profile.deficitNutritionAllowed) reasons.push('safety.s4.deficit_disabled');
    if (profile.screeningOutcome === 'not_screened' || profile.screeningOutcome === 'blocked') reasons.push('safety.s4.not_screened');
    if (profile.specialPopulation !== 'none') reasons.push('safety.s4.special_population');
    if (!isValidCalendarDate(birthDate) || !isValidCalendarDate(today) || !(ageInYears(birthDate, today) >= S4_DEFICIT_MINIMUM_AGE_YEARS)) reasons.push('safety.s4.minor');
    return { allowed: reasons.length === 0, reasonCodes: reasons };
  } catch {
    return { allowed: false, reasonCodes: ['safety.s4.check_failed'] };
  }
}

/** S4: the lowest goal weight for a height (BMI 18.5), rounded UP to 0.1 kg. NaN for an unreadable height. */
export function minimumGoalWeightKg(heightCm: number): number {
  if (!positive(heightCm)) return Number.NaN;
  const m = heightCm / 100;
  return Math.ceil(S4_MIN_GOAL_BMI * m * m * 10 - 1e-9) / 10;
}

/** The loss rate (% body weight per week) a daily deficit implies for a body weight. */
export function impliedLossPercentPerWeek(deficitKcalPerDay: number, weightKg: number): number {
  if (!positive(weightKg) || !Number.isFinite(deficitKcalPerDay) || deficitKcalPerDay <= 0) return 0;
  return ((deficitKcalPerDay * 7) / energyDensity() / weightKg) * 100;
}

/** The largest daily deficit a loss rate allows for a body weight. */
export function deficitForLossPercent(percentPerWeek: number, weightKg: number): number {
  if (!positive(weightKg) || !Number.isFinite(percentPerWeek) || percentPerWeek <= 0) return 0;
  return ((percentPerWeek / 100) * weightKg * energyDensity()) / 7;
}

export interface S4Context {
  readonly safetyProfile: SafetyProfile;
  readonly birthDate: CalendarDate;
  readonly today: CalendarDate;
  readonly weightKg: number;
  readonly heightCm: number;
  /** The engine's estimated BMR (kcal/day): the floor. */
  readonly bmrKcal: number;
  /** The engine's estimated expenditure (kcal/day): a target below it is a deficit. */
  readonly maintenanceKcal: number;
}

export interface EnergyProposal {
  readonly targetKcal: number;
  readonly plannedLossPercentPerWeek: number;
  readonly goalWeightKg: number | null;
}

export type S4Result =
  | {
      readonly status: 'ok';
      readonly targetKcal: number;
      readonly floorKcal: number;
      readonly deficitKcal: number;
      readonly plannedLossPercentPerWeek: number;
      readonly goalWeightKg: number | null;
      readonly deficitAllowed: boolean;
      /** What S4 changed in the proposal (each one is a safety event for the defensibility log). */
      readonly adjustments: readonly SafetyViolation[];
    }
  /** The S4 target would fall below the absolute energy floor: no number, the supportive mode (habits) instead. */
  | { readonly status: 'supportive'; readonly deficitAllowed: false; readonly adjustments: readonly SafetyViolation[] }
  | { readonly status: 'invalid'; readonly deficitAllowed: false; readonly adjustments: readonly SafetyViolation[] };

const s4 = (reasonCode: string): SafetyViolation => ({ invariant: 'S4', reasonCode });

/**
 * Applies the S4 floors to a proposed target. The result always satisfies
 * S4 for the context, whatever the proposal (property-tested with
 * adversarial proposals and contexts in nutrition-floors.test.ts).
 */
export function enforceNutritionFloors(proposal: EnergyProposal, ctx: S4Context): S4Result {
  try {
    if (!positive(ctx.weightKg) || !positive(ctx.heightCm) || !positive(ctx.bmrKcal) || !positive(ctx.maintenanceKcal)) {
      return { status: 'invalid', deficitAllowed: false, adjustments: [s4('safety.s4.invalid_input')] };
    }
    const adjustments: SafetyViolation[] = [];
    const features = deficitFeatures(ctx.safetyProfile, ctx.birthDate, ctx.today);
    const minGoal = minimumGoalWeightKg(ctx.heightCm);
    let deficitAllowed = features.allowed;
    // At or below the BMI floor there is nothing left to lose.
    if (deficitAllowed && ctx.weightKg <= minGoal) {
      deficitAllowed = false;
      adjustments.push(s4('safety.s4.at_bmi_floor'));
    }

    let goalWeightKg = proposal.goalWeightKg;
    if (goalWeightKg !== null && !(Number.isFinite(goalWeightKg) && goalWeightKg >= minGoal)) {
      goalWeightKg = null;
      adjustments.push(s4('safety.s4.goal_weight_below_floor'));
    }

    const requested = Number.isFinite(proposal.plannedLossPercentPerWeek) ? Math.max(0, proposal.plannedLossPercentPerWeek) : 0;
    let rate = deficitAllowed ? Math.min(requested, S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK) : 0;
    if (deficitAllowed && requested > S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK) adjustments.push(s4('safety.s4.rate_capped'));

    const floorKcal = Math.ceil(ctx.bmrKcal);
    const maintenance = ctx.maintenanceKcal;
    let target = Number.isFinite(proposal.targetKcal) ? proposal.targetKcal : maintenance;
    if (!deficitAllowed) {
      if (target < maintenance) {
        target = maintenance;
        adjustments.push(...features.reasonCodes.map(s4));
      }
    } else {
      const lowest = maintenance - deficitForLossPercent(rate, ctx.weightKg);
      if (target < lowest) {
        target = lowest;
        adjustments.push(s4('safety.s4.rate_capped'));
      }
    }
    if (target < floorKcal) {
      target = floorKcal;
      adjustments.push(s4('safety.s4.bmr_floor'));
    }
    const targetKcal = Math.ceil(target);
    const unique = (list: readonly SafetyViolation[]) => [...new Map(list.map((a) => [a.reasonCode, a])).values()];
    // The absolute floor: a target that would still be below it is never given as a number.
    if (!(targetKcal >= S4_MIN_ENERGY_KCAL_PER_DAY)) return { status: 'supportive', deficitAllowed: false, adjustments: unique([...adjustments, s4('safety.s4.absolute_floor')]) };
    const deficitKcal = Math.max(0, Math.floor(maintenance) - targetKcal);
    rate = deficitAllowed ? Math.min(rate, impliedLossPercentPerWeek(deficitKcal, ctx.weightKg)) : 0;
    return { status: 'ok', targetKcal, floorKcal: Math.max(floorKcal, S4_MIN_ENERGY_KCAL_PER_DAY), deficitKcal, plannedLossPercentPerWeek: Math.round(rate * 1000) / 1000, goalWeightKg, deficitAllowed, adjustments: unique(adjustments) };
  } catch {
    return { status: 'invalid', deficitAllowed: false, adjustments: [s4('safety.s4.check_failed')] };
  }
}

export interface StoredNutritionTarget {
  readonly targetKcal: number | null;
  readonly deficitKcal: number;
  readonly plannedLossPercentPerWeek: number;
  readonly goalWeightKg: number | null;
}

/**
 * Re-checks a target someone else produced (a synced record, a tampered
 * file) against S4 for the context. Empty = safe. Fails closed.
 */
export function nutritionTargetViolations(target: StoredNutritionTarget, ctx: S4Context): SafetyViolation[] {
  try {
    const out: SafetyViolation[] = [];
    const features = deficitFeatures(ctx.safetyProfile, ctx.birthDate, ctx.today);
    const minGoal = minimumGoalWeightKg(ctx.heightCm);
    const deficitAllowed = features.allowed && positive(ctx.weightKg) && ctx.weightKg > minGoal;
    const rate = target.plannedLossPercentPerWeek;
    if (!Number.isFinite(rate) || rate < 0 || rate > S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK) out.push(s4('safety.s4.rate_capped'));
    if (!deficitAllowed && (rate !== 0 || target.deficitKcal !== 0)) out.push(s4('safety.s4.deficit_disabled'));
    if (target.goalWeightKg !== null && !(Number.isFinite(target.goalWeightKg) && target.goalWeightKg >= minGoal)) out.push(s4('safety.s4.goal_weight_below_floor'));
    if (target.targetKcal !== null) {
      if (!positive(ctx.bmrKcal) || !positive(ctx.maintenanceKcal) || !Number.isFinite(target.targetKcal)) return [...out, s4('safety.s4.invalid_input')];
      if (target.targetKcal < Math.ceil(ctx.bmrKcal)) out.push(s4('safety.s4.bmr_floor'));
      if (target.targetKcal < S4_MIN_ENERGY_KCAL_PER_DAY) out.push(s4('safety.s4.absolute_floor'));
      const deficit = Math.max(0, ctx.maintenanceKcal - target.targetKcal);
      if (impliedLossPercentPerWeek(deficit, ctx.weightKg) > S4_MAX_PLANNED_LOSS_PERCENT_PER_WEEK + 1e-9) out.push(s4('safety.s4.rate_capped'));
      if (!deficitAllowed && deficit >= 1) out.push(s4('safety.s4.deficit_disabled'));
    }
    return [...new Map(out.map((v) => [v.reasonCode, v])).values()];
  } catch {
    return [s4('safety.s4.check_failed')];
  }
}

/** S4 as a SafetyCheck for evaluateSafety (first violation, or null). */
export const nutritionFloorCheck: SafetyCheck<{ target: StoredNutritionTarget; ctx: S4Context }> = ({ target, ctx }) => nutritionTargetViolations(target, ctx)[0] ?? null;
