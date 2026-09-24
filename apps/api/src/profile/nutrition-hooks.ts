import { isDeepStrictEqual } from 'node:util';
import { ENGINE_VERSION, NUTRITION_RULES_VERSION, calendarOf, computeNutritionTarget, createEngineContext, fixedClock, type NutritionResult } from '@fitadapt/engine';
import { estimateIntake } from '@fitadapt/food-library';
import { nutritionTargetViolations } from '@fitadapt/safety';
import { HabitCheckSchema, IntakeLogSchema, NUTRITION_COLLECTIONS, NutritionPlanRecordSchema, PROFILE_COLLECTIONS, ProfileSchema, type NutritionPlanRecord, type SafetyProfile } from '@fitadapt/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { syncChanges } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import { clientDateInRange, clientTimeInRange, dateMatchesInstant } from '../lib/client-time.js';
import type { PgServerTx } from '../sync/pg-store.js';
import { screeningsAgreeOnBirthDate } from './screenings.js';

/**
 * M10 on the server (ADR-022). A synced nutrition plan must be exactly what
 * the engine derives from the input it names (same engine and nutrition
 * rules version; only the target id, drawn from the device's seed, is not
 * re-derived), built on the SafetyProfile the server derives from the
 * latest stored screening and on the stored birth date, and it must pass
 * the S4 re-check (packages/safety, never re-implemented). Intake estimates
 * must be the engine's estimate on the seed. The target and its S4 events
 * go to the defensibility log in the sync transaction (ADR-009).
 */

async function storedBirthDate(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ data: syncChanges.data })
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, PROFILE_COLLECTIONS.profile)))
    .orderBy(desc(syncChanges.revision))
    .limit(1);
  const parsed = ProfileSchema.safeParse(row?.data);
  return parsed.success ? parsed.data.birthDate : null;
}

/** The engine's result for the record's input (the target id is the device's; everything else must match). */
function rederive(record: NutritionPlanRecord): NutritionResult {
  return computeNutritionTarget(record.input, createEngineContext({ clock: fixedClock(Date.parse(record.createdAt)), seed: 1 }));
}

export async function validateNutritionPlan(db: DbExecutor, userId: string, data: unknown, latestProfile: SafetyProfile, now: Date): Promise<string | null> {
  const parsed = NutritionPlanRecordSchema.safeParse(data);
  if (!parsed.success) return 'nutrition.invalid';
  const record = parsed.data;
  const { input, target } = record;
  if (target.engineVersion !== ENGINE_VERSION || target.rulesVersion !== NUTRITION_RULES_VERSION) return 'nutrition.engine_version_unsupported';
  // API-5 / SAF-5: the engine clock (createdAt) and "today" (S4's minor rule reads it) are bounded by the
  // server's clock, and "today" is the local date of createdAt somewhere on Earth: a client cannot move
  // either forward to pass an age rule, nor backdate beyond the offline window.
  if (!clientTimeInRange(record.createdAt, now) || !clientDateInRange(input.today, now) || !dateMatchesInstant(input.today, record.createdAt)) return 'nutrition.client_time_out_of_range';
  // S4/S7: the plan must be built on the SafetyProfile the server derives from the latest stored screening, and the stored birth date.
  if (!isDeepStrictEqual(input.safetyProfile, latestProfile)) return 'nutrition.safety_profile_mismatch';
  const birthDate = await storedBirthDate(db, userId);
  if (!birthDate || !isDeepStrictEqual(birthDate, input.birthDate)) return 'nutrition.profile_mismatch';
  // API-5: and the screening the SafetyProfile comes from states the same date of birth.
  if (!(await screeningsAgreeOnBirthDate(db, userId, birthDate))) return 'nutrition.profile_mismatch';
  let expected;
  try {
    expected = rederive(record).target;
  } catch {
    return 'nutrition.invalid';
  }
  if (!isDeepStrictEqual({ ...expected, targetId: target.targetId }, target)) return 'nutrition.target_mismatch';
  // Belt and braces: the S4 re-check of what is stored.
  if (target.energy && target.energyModel && input.weightKg !== null && input.heightCm !== null) {
    const violations = nutritionTargetViolations(
      { targetKcal: target.energy.targetKcal, deficitKcal: target.energy.deficitKcal, plannedLossPercentPerWeek: target.plannedLossPercentPerWeek, goalWeightKg: target.goalWeightKg },
      { safetyProfile: input.safetyProfile, birthDate: input.birthDate, today: calendarOf(input.today), weightKg: input.weightKg, heightCm: input.heightCm, bmrKcal: target.energyModel.bmrKcal, maintenanceKcal: target.energyModel.expenditureKcal - 0.5 },
    );
    if (violations.length > 0) return 'safety.s4.target_unsafe';
  }
  return null;
}

export function validateIntakeLog(data: unknown): string | null {
  const parsed = IntakeLogSchema.safeParse(data);
  if (!parsed.success) return 'intake_log.invalid';
  let expected;
  try {
    expected = estimateIntake(parsed.data.entry);
  } catch {
    return 'intake_log.invalid';
  }
  const { energyKcal, proteinG } = parsed.data.estimate;
  return energyKcal === expected.energyKcal && proteinG === expected.proteinG ? null : 'intake_log.estimate_mismatch';
}

export function validateHabitCheck(data: unknown): string | null {
  return HabitCheckSchema.safeParse(data).success ? null : 'habit_check.invalid';
}

/** In the sync transaction: the nutrition target (versions, mode, codes; no value) and its S4 events commit with the record, or neither does. */
export async function onNutritionApplied(legal: LegalService, userId: string, collection: string, data: unknown, tx: PgServerTx): Promise<void> {
  if (collection !== NUTRITION_COLLECTIONS.plans) return;
  const record = NutritionPlanRecordSchema.parse(data);
  const { target } = record;
  await legal.recordNutritionTarget(userId, { targetId: target.targetId, engineVersion: target.engineVersion, rulesVersion: target.rulesVersion, mode: target.mode, reason: record.reason, deficitAllowed: target.deficitAllowed, reasonCodes: target.reasonCodes }, tx.db);
  for (const e of rederive(record).safetyEvents) await legal.recordSafetyEvent(userId, { invariant: e.invariant, reasonCode: e.reasonCode, action: e.action, engineVersion: target.engineVersion }, tx.db);
}
