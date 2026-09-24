import { ENGINE_VERSION, adaptiveObservation, bodyMetricSeries, dailyIntake, ewmaTrend, targetDue, trendOn, type NutritionResult } from '@fitadapt/engine';
import type { DefensibilityPayload } from '@fitadapt/legal';
import type { IsoDate, NutritionInput, NutritionPlanRecord, Profile, SafetyProfile } from '@fitadapt/shared';
import { isDeepStrictEqual } from './deep-equal';
import type { StoredBodyMetric } from '../progress/progress-store';
import type { NutritionSettings, StoredIntakeLog } from './nutrition-store';

/**
 * Builds the engine's nutrition input from what the device holds: the
 * user's nutrition settings, the M01 profile (birth date, height), the M04
 * weight trend (or the profile weight), the SafetyProfile selector, the
 * logged intake (adaptive expenditure) and the M04 hand-offs. Pure.
 */
export interface NutritionContext {
  readonly settings: NutritionSettings;
  readonly profile: Profile;
  readonly safetyProfile: SafetyProfile;
  readonly bodyMetrics: readonly StoredBodyMetric[];
  readonly intakeLogs: readonly StoredIntakeLog[];
  readonly guardrailEvents: readonly IsoDate[];
  readonly previous: NutritionPlanRecord | null;
  readonly today: IsoDate;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildNutritionInput(ctx: NutritionContext): NutritionInput {
  const trend = ewmaTrend(bodyMetricSeries(ctx.bodyMetrics, 'weight'));
  const trendWeight = trendOn(trend, ctx.today);
  const weightKg = trendWeight !== null ? round1(trendWeight) : ctx.profile.biometrics.weightKg;
  return {
    schemaVersion: 1,
    goal: ctx.settings.goal,
    trackingStyle: ctx.settings.trackingStyle,
    activityLevel: ctx.settings.activityLevel,
    sexForEstimate: ctx.settings.sexForEstimate,
    weightKg: weightKg === null ? null : Math.min(350, Math.max(25, weightKg)),
    heightCm: ctx.profile.biometrics.heightCm ?? ctx.settings.heightCm,
    birthDate: ctx.profile.birthDate,
    today: ctx.today,
    plannedLossPercentPerWeek: ctx.settings.goal === 'fat_loss' ? ctx.settings.plannedLossPercentPerWeek : null,
    goalWeightKg: ctx.settings.goalWeightKg,
    safetyProfile: ctx.safetyProfile,
    guardrailEvents: [...ctx.guardrailEvents].sort().slice(-200),
    adaptive: adaptiveObservation(dailyIntake(ctx.intakeLogs), trend, ctx.today),
    previousExpenditureKcal: ctx.previous?.target.energyModel?.expenditureKcal ?? null,
  };
}

/**
 * Whether the stored plan must be recomputed now, and why: a new M04
 * hand-off (at once: S4), the weekly update, or a changed SafetyProfile
 * (a re-screen can switch deficit features off). Null = keep it.
 */
export function planUpkeep(latest: NutritionPlanRecord, input: NutritionInput): NutritionPlanRecord['reason'] | null {
  const known = new Set(latest.input.guardrailEvents);
  if (input.guardrailEvents.some((d) => !known.has(d) && d <= input.today)) return 'guardrail';
  if (!isDeepStrictEqual(latest.input.safetyProfile, input.safetyProfile)) return 'settings_changed';
  if (targetDue(latest.target, input.guardrailEvents, input.today)) return 'weekly_update';
  return null;
}

export interface NutritionLogger {
  logNutritionTarget(payload: DefensibilityPayload<'nutrition.target_set'>): void;
  logSafetyEvent(payload: DefensibilityPayload<'safety.event'>): void;
}

/** L11: the target and its S4 events go to the device defensibility buffer (versions and codes only, no value). */
export function logNutritionResult(legal: NutritionLogger, result: NutritionResult, reason: NutritionPlanRecord['reason']): void {
  const { target } = result;
  legal.logNutritionTarget({ targetId: target.targetId, engineVersion: target.engineVersion, rulesVersion: target.rulesVersion, mode: target.mode, reason, deficitAllowed: target.deficitAllowed, reasonCodes: target.reasonCodes });
  for (const e of result.safetyEvents) legal.logSafetyEvent({ invariant: e.invariant, reasonCode: e.reasonCode, action: e.action, engineVersion: ENGINE_VERSION });
}
