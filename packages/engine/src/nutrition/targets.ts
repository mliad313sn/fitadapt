import { deficitFeatures, deficitForLossPercent, enforceNutritionFloors, impliedLossPercentPerWeek } from '@fitadapt/safety';
import { NUTRITION_HABITS, NutritionInputSchema, NutritionTargetSchema, type IsoDate, type NutritionInput, type NutritionTarget } from '@fitadapt/shared';
import type { EngineContext } from '../context.js';
import { addDays, daysBetween } from '../program/dates.js';
import { uuidFrom } from '../random.js';
import { ENGINE_VERSION } from '../version.js';
import { adaptiveExpenditure } from './adaptive.js';
import { NUTRITION_RULES_VERSION, nutritionValue } from './config.js';
import { activityFactor, ageOnIsoDate, calendarOf, mifflinStJeorBmr } from './energy.js';

/**
 * The M10 nutrition prescription: `computeNutritionTarget(input, ctx)`.
 * Deterministic (injected seed for the target id), pure, and every target
 * goes through packages/safety `enforceNutritionFloors` (S4), so no path
 * can produce a target below the estimated BMR, a planned loss above 1 %
 * body weight a week, a goal weight below BMI 18.5, or a deficit for a
 * user under 18 / advised against calorie restriction / not screened / in
 * a special population. Those users — and anyone who chose habits — get the
 * supportive mode: habits, no calorie number.
 */

export interface NutritionSafetyEvent {
  readonly invariant: 'S4';
  readonly reasonCode: string;
  readonly action: 'blocked' | 'capped' | 'deficit_reduced';
}

export interface NutritionResult {
  readonly target: NutritionTarget;
  /** S4 actions for the defensibility log (L11); no body value in them. */
  readonly safetyEvents: readonly NutritionSafetyEvent[];
}

export type GuardrailStatus = { readonly kind: 'none' } | { readonly kind: 'paused'; readonly until: IsoDate } | { readonly kind: 'reduced'; readonly maxPercentPerWeek: number };

/** What the M04 sustained-loss hand-offs mean today: no deficit during the pause, then a capped pace. */
export function guardrailStatus(events: readonly IsoDate[], today: IsoDate): GuardrailStatus {
  const past = events.filter((d) => d <= today).sort();
  const latest = past[past.length - 1];
  if (latest === undefined) return { kind: 'none' };
  const age = daysBetween(latest, today);
  if (age < nutritionValue('guardrail.pauseDays')) {
    return { kind: 'paused', until: addDays(latest, nutritionValue('guardrail.pauseDays')) };
  }
  if (age < nutritionValue('guardrail.reducedRateDays')) return { kind: 'reduced', maxPercentPerWeek: nutritionValue('guardrail.reducedRateMaxPercent') };
  return { kind: 'none' };
}

/** A new target is due weekly, or at once when the pace set by a guardrail pause changes. */
export function targetDue(latest: NutritionTarget | null, guardrailEvents: readonly IsoDate[], today: IsoDate): boolean {
  if (!latest) return true;
  if (daysBetween(latest.computedOn, today) >= nutritionValue('update.intervalDays')) return true;
  return guardrailStatus(guardrailEvents, latest.computedOn).kind !== guardrailStatus(guardrailEvents, today).kind;
}

const SUPPORTIVE_REASON: Record<string, string> = {
  'safety.s4.minor': 'nutrition.supportive.minor',
  'safety.s4.deficit_disabled': 'nutrition.supportive.advised_against',
  'safety.s4.not_screened': 'nutrition.supportive.not_screened',
  'safety.s4.invalid_profile': 'nutrition.supportive.not_screened',
  'safety.s4.check_failed': 'nutrition.supportive.not_screened',
  'safety.s4.special_population': 'nutrition.supportive.special_population',
};

const S4_REASON: Record<string, string> = {
  'safety.s4.bmr_floor': 'nutrition.s4.bmr_floor',
  'safety.s4.rate_capped': 'nutrition.s4.rate_capped',
  'safety.s4.goal_weight_below_floor': 'nutrition.s4.goal_weight_below_floor',
  'safety.s4.at_bmi_floor': 'nutrition.s4.at_bmi_floor',
};

const unique = <T>(list: readonly T[]) => [...new Set(list)];
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function computeNutritionTarget(rawInput: NutritionInput, ctx: EngineContext): NutritionResult {
  const input = NutritionInputSchema.parse(rawInput);
  const base = {
    targetId: uuidFrom(ctx.rng),
    engineVersion: ENGINE_VERSION,
    rulesVersion: NUTRITION_RULES_VERSION,
    computedOn: input.today,
    goal: input.goal,
    habits: [...NUTRITION_HABITS],
  };
  const noNumbers = (mode: 'supportive' | 'needs_measurements', reasonCodes: string[], deficitAllowed: boolean, safetyEvents: NutritionSafetyEvent[] = []): NutritionResult => ({
    target: NutritionTargetSchema.parse({ ...base, mode, energyModel: null, energy: null, protein: null, plannedLossPercentPerWeek: 0, goalWeightKg: null, deficitAllowed, reasonCodes: unique(reasonCodes) }),
    safetyEvents,
  });

  const today = calendarOf(input.today);
  const features = deficitFeatures(input.safetyProfile, input.birthDate, today);
  // S4: deficit features disabled → the supportive mode, whatever the goal (no calorie number for these users).
  if (!features.allowed) {
    const reasons = features.reasonCodes.map((c) => SUPPORTIVE_REASON[c] ?? 'nutrition.supportive.not_screened');
    const events = input.goal === 'fat_loss' ? features.reasonCodes.map((reasonCode) => ({ invariant: 'S4' as const, reasonCode, action: 'blocked' as const })) : [];
    return noNumbers('supportive', reasons, false, events);
  }
  if (input.trackingStyle === 'habits') return noNumbers('supportive', ['nutrition.supportive.chosen'], true);
  if (input.weightKg === null || input.heightCm === null) return noNumbers('needs_measurements', ['nutrition.needs_measurements'], true);

  const weightKg = input.weightKg;
  const heightCm = input.heightCm;
  const bmr = mifflinStJeorBmr({ weightKg, heightCm, ageYears: ageOnIsoDate(input.birthDate, input.today), sex: input.sexForEstimate });
  if (!Number.isFinite(bmr)) return noNumbers('needs_measurements', ['nutrition.energy.unavailable'], true);
  const factor = activityFactor(input.activityLevel);
  const formula = bmr * factor;
  const expenditure = adaptiveExpenditure(formula, input.previousExpenditureKcal, input.adaptive);
  const maintenance = expenditure.expenditureKcal;

  const reasons: string[] = ['nutrition.energy.bmr_mifflin', 'nutrition.energy.activity_factor', ...expenditure.reasonCodes];
  const safetyEvents: NutritionSafetyEvent[] = [];
  let proposed = maintenance;
  let rate = 0;
  if (input.goal === 'fat_loss') {
    reasons.push('nutrition.goal.fat_loss');
    rate = input.plannedLossPercentPerWeek ?? nutritionValue('loss.defaultPercentPerWeek');
    const guard = guardrailStatus(input.guardrailEvents, input.today);
    if (guard.kind === 'paused') {
      if (rate > 0) safetyEvents.push({ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_pause', action: 'deficit_reduced' });
      rate = 0;
      reasons.push('nutrition.guardrail.paused');
    } else if (guard.kind === 'reduced' && rate > guard.maxPercentPerWeek) {
      rate = guard.maxPercentPerWeek;
      reasons.push('nutrition.guardrail.rate_reduced');
      safetyEvents.push({ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_reduced', action: 'deficit_reduced' });
    }
    if (input.goalWeightKg !== null && weightKg <= input.goalWeightKg) {
      rate = 0;
      reasons.push('nutrition.goal.goal_weight_reached');
    }
    proposed = maintenance - deficitForLossPercent(rate, weightKg);
  } else if (input.goal === 'muscle_gain') {
    reasons.push('nutrition.goal.muscle_gain');
    proposed = maintenance + Math.min(maintenance * nutritionValue('gain.surplusFraction'), nutritionValue('gain.maxSurplusKcal'));
  } else {
    reasons.push('nutrition.goal.maintain');
  }

  const s4 = enforceNutritionFloors({ targetKcal: proposed, plannedLossPercentPerWeek: rate, goalWeightKg: input.goalWeightKg }, { safetyProfile: input.safetyProfile, birthDate: input.birthDate, today, weightKg, heightCm, bmrKcal: bmr, maintenanceKcal: maintenance });
  if (s4.status !== 'ok') return noNumbers('needs_measurements', ['nutrition.energy.unavailable'], false);
  // "At the BMI floor" only concerns a planned loss.
  for (const a of s4.adjustments.filter((x) => input.goal === 'fat_loss' || x.reasonCode !== 'safety.s4.at_bmi_floor')) {
    reasons.push(S4_REASON[a.reasonCode] ?? 'nutrition.s4.rate_capped');
    safetyEvents.push({ invariant: 'S4', reasonCode: a.reasonCode, action: 'capped' });
  }

  // Rounding the energy target is always up: it can only make a deficit smaller (never breaks S4).
  const step = nutritionValue('rounding.kcal');
  const targetKcal = Math.ceil(s4.targetKcal / step) * step;
  if (targetKcal !== s4.targetKcal) reasons.push('nutrition.rounding.up');
  const deficitKcal = Math.max(0, Math.floor(maintenance) - targetKcal);
  const surplusKcal = Math.max(0, targetKcal - Math.ceil(maintenance));
  const plannedLoss = s4.deficitAllowed ? Math.round(Math.min(s4.plannedLossPercentPerWeek, impliedLossPercentPerWeek(deficitKcal, weightKg)) * 1000) / 1000 : 0;

  const referenceWeight = Math.min(weightKg, nutritionValue('protein.referenceBmi') * (heightCm / 100) ** 2);
  if (referenceWeight < weightKg) reasons.push('nutrition.protein.reference_weight');
  reasons.push('nutrition.protein.range');
  const gStep = nutritionValue('rounding.proteinG');
  const protein = { minG: Math.max(gStep, roundTo(nutritionValue('protein.minGPerKg') * referenceWeight, gStep)), maxG: Math.max(gStep, roundTo(nutritionValue('protein.maxGPerKg') * referenceWeight, gStep)) };

  const target = NutritionTargetSchema.parse({
    ...base,
    mode: 'numeric',
    energyModel: {
      bmrKcal: Math.round(bmr * 10) / 10,
      activityFactor: factor,
      formulaExpenditureKcal: Math.round(formula),
      expenditureKcal: Math.round(maintenance),
      method: expenditure.method,
      reasonCodes: unique(['nutrition.energy.bmr_mifflin', 'nutrition.energy.activity_factor', ...expenditure.reasonCodes]),
    },
    energy: { targetKcal, floorKcal: s4.floorKcal, deficitKcal, surplusKcal },
    protein,
    plannedLossPercentPerWeek: plannedLoss,
    goalWeightKg: s4.goalWeightKg,
    deficitAllowed: s4.deficitAllowed,
    reasonCodes: unique(reasons),
  });
  return { target, safetyEvents: [...new Map(safetyEvents.map((e) => [e.reasonCode, e])).values()] };
}
