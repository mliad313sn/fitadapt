import {
  AssessmentRecordSchema,
  BodyMetricSchema,
  EquipmentProfileSchema,
  ExecutionLogSchema,
  HabitCheckSchema,
  IntakeLogSchema,
  MeasurementSchema,
  NutritionPlanRecordSchema,
  PreferencesRecordSchema,
  ProfileSchema,
  ProgramRecordSchema,
  ReadinessCheckSchema,
  ReflowRecordSchema,
  ScreeningRecordSchema,
  SetLogSchema,
  WorkoutSessionRecordSchema,
} from '@fitadapt/shared';
import type { z } from 'zod';

/**
 * Sync policy per collection. Append-only collections (workout set logs) only
 * accept inserts of new record ids, so two devices can never conflict on them.
 *
 * PKG-06: every policy carries the zod schema of its records' `data` — a
 * policy without one does not type-check, so a new collection cannot be
 * accepted unvalidated. `SyncServer` applies it before the domain validator
 * when `enforceCollectionSchemas` is on; `recordDataIssue` exposes the same
 * check to callers.
 */
export interface CollectionPolicy {
  readonly appendOnly: boolean;
  readonly schema: z.ZodType;
}

export type CollectionRegistry = Readonly<Record<string, CollectionPolicy>>;

const policy = (appendOnly: boolean, schema: z.ZodType): CollectionPolicy => Object.freeze({ appendOnly, schema });

export const SYNC_COLLECTIONS: CollectionRegistry = Object.freeze({
  /** Workout set logs: append-only (CLAUDE.md conventions). Corrections are new entries. */
  set_logs: policy(true, SetLogSchema),
  /**
   * Per-user settings (locale, units, gym mode, Fair Pair display name): mutable, revision-checked.
   * FIX-C's strict PreferencesRecordSchema (API-12): one schema on device, sync server and API.
   */
  preferences: policy(false, PreferencesRecordSchema),
  /** M01 profile (one record per user, PROFILE_RECORD_ID): mutable, revision-checked, server wins. */
  profile: policy(false, ProfileSchema),
  /** M01 equipment profiles (one per location): mutable, revision-checked. */
  equipment_profiles: policy(false, EquipmentProfileSchema),
  /** M01 screenings: append-only history; a re-screen is a new record and the latest counts. */
  screenings: policy(true, ScreeningRecordSchema),
  /** M07 assessments (result + CapacityModel): append-only history; a re-assessment is a new record and the latest counts. */
  assessments: policy(true, AssessmentRecordSchema),
  /** M08 programs (inputs + generated program): append-only; a new program is a new record and the latest counts. */
  programs: policy(true, ProgramRecordSchema),
  /** M08 reflows (a session the user could not do and what the engine decided): append-only, replayed in order. */
  program_reflows: policy(true, ReflowRecordSchema),
  /** M02 started sessions (the executed prescription with its inputs): append-only. */
  workout_sessions: policy(true, WorkoutSessionRecordSchema),
  /** M02 execution events (swaps, skips, pain flags, stops, S3 red flags and attestations): append-only. */
  execution_logs: policy(true, ExecutionLogSchema),
  /** M05 readiness checks (sleep, soreness, stress, energy, optional wearable readings): append-only; the latest of a day counts. */
  readiness_checks: policy(true, ReadinessCheckSchema),
  /** M04 body weight and body-fat entries: append-only; a correction is a new entry naming the one it corrects. */
  body_metrics: policy(true, BodyMetricSchema),
  /** M04 circumferences: append-only, corrections as for body metrics. Progress photos are never synced (ADR-020). */
  measurements: policy(true, MeasurementSchema),
  /** M10 nutrition plans (the engine's input and target): append-only; the latest counts. */
  nutrition_plans: policy(true, NutritionPlanRecordSchema),
  /** M10 intake logs (hand portions or a seed food, with the engine's estimate): append-only; corrections are new entries. */
  intake_logs: policy(true, IntakeLogSchema),
  /** M10 habit ticks (protein at each meal, vegetables, hydration): append-only; the latest of a day counts. */
  habit_checks: policy(true, HabitCheckSchema),
});

export function policyFor(registry: CollectionRegistry, collection: string): CollectionPolicy | undefined {
  return Object.prototype.hasOwnProperty.call(registry, collection) ? registry[collection] : undefined;
}

/** `<collection>.invalid` when `data` does not match the collection's schema, else null (PKG-06). */
export function recordDataIssue(registry: CollectionRegistry, collection: string, data: unknown): string | null {
  const p = policyFor(registry, collection);
  if (!p) return 'unknown_collection';
  return p.schema.safeParse(data).success ? null : `${collection}.invalid`;
}
