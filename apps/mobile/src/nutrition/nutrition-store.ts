import { computeNutritionTarget, createEngineContext, type NutritionResult } from '@fitadapt/engine';
import { estimateIntake } from '@fitadapt/food-library';
import {
  ActivityLevelSchema,
  EstimateSexSchema,
  HabitCheckSchema,
  IntakeLogSchema,
  IsoDateSchema,
  NUTRITION_COLLECTIONS,
  NutritionGoalSchema,
  NutritionPlanRecordSchema,
  TrackingStyleSchema,
  type GuardrailEvent,
  type HabitCheck,
  type IntakeEntry,
  type IntakeLog,
  type IsoDate,
  type Meal,
  type NutritionHabit,
  type NutritionInput,
  type NutritionPlanRecord,
} from '@fitadapt/shared';
import type { SyncClient } from '@fitadapt/sync';
import { z } from 'zod';
import { createStore } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';

/**
 * M10 on the device (local-first, ADR-002, ADR-022). Nutrition plans (the
 * engine's input and target), intake logs and habit ticks are append-only
 * sync records in the encrypted database (health data: synced only with the
 * health consent and erased on the server when it is withdrawn). The user's
 * nutrition settings and the M04 sustained-loss hand-offs received are kept
 * on the device (`kv`, also in the encrypted database). Every target comes
 * from the engine (`computeNutritionTarget`), which applies S4 through
 * packages/safety; this store never computes a number itself.
 */

/** What the user chose in the set-up. `heightCm` is used when the M01 profile has none. */
export const NutritionSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goal: NutritionGoalSchema,
  trackingStyle: TrackingStyleSchema,
  activityLevel: ActivityLevelSchema,
  sexForEstimate: EstimateSexSchema,
  plannedLossPercentPerWeek: z.number().min(0).max(1).nullable(),
  goalWeightKg: z.number().min(25).max(350).nullable(),
  heightCm: z.number().min(100).max(250).nullable(),
});
export type NutritionSettings = z.infer<typeof NutritionSettingsSchema>;

export interface StoredIntakeLog {
  readonly id: string;
  readonly data: IntakeLog;
}
export interface StoredPlan {
  readonly id: string;
  readonly data: NutritionPlanRecord;
}
export interface StoredHabitCheck {
  readonly id: string;
  readonly data: HabitCheck;
}

const SETTINGS_KEY = 'nutrition_settings';
const GUARDRAIL_KEY = 'nutrition_guardrail_events';
const NOTICE_KEY = 'nutrition_guardrail_notices';

export interface NutritionStoreDeps {
  readonly sync: SyncClient;
  readonly kv: KeyValueStore;
  readonly now: () => Date;
  /** A fresh 32-bit seed for the engine (the target id); injected so tests are deterministic. */
  readonly newSeed: () => number;
  readonly onWrite?: () => void;
}

export interface NutritionState {
  settings: NutritionSettings | null;
  plans: StoredPlan[];
  intakeLogs: StoredIntakeLog[];
  habitChecks: StoredHabitCheck[];
  /** M04 sustained-loss hand-offs received (detection dates, oldest first). */
  guardrailEvents: IsoDate[];
  /** Hand-offs whose supportive notice the user has not acknowledged on the nutrition screen yet. */
  pendingNotices: IsoDate[];
  reload(): void;
  saveSettings(settings: NutritionSettings): void;
  /** Runs the engine on an input and stores the plan (input + target). */
  recordPlan(input: NutritionInput, reason: NutritionPlanRecord['reason']): NutritionResult;
  logIntake(entry: IntakeEntry, loggedOn: IsoDate, meal?: Meal | null): IntakeLog;
  /** A correction or a removal: a new entry naming the one it corrects (append-only). */
  removeIntake(id: string): IntakeLog;
  checkHabit(habit: NutritionHabit, checkedOn: IsoDate, done: boolean): HabitCheck;
  /** The real M10 handler of the M04 hand-off: remembered for the engine's guardrail pause. */
  receiveGuardrail(event: GuardrailEvent): void;
  acknowledgeGuardrailNotices(): void;
  /** Health consent withdrawn: the device forgets the settings and hand-offs (the records are ignored without consent). */
  forget(): void;
}

function parseList<T>(schema: z.ZodType<T>, rows: readonly { id: string; data: unknown }[]) {
  return rows.flatMap((r) => {
    const p = schema.safeParse(r.data);
    return p.success ? [{ id: r.id, data: p.data }] : [];
  });
}

/** Oldest first: by time, then by the `supersedes` chain (plans made in the same millisecond), then by id. */
export function orderPlans(plans: StoredPlan[]): StoredPlan[] {
  const byTarget = new Map(plans.map((p) => [p.data.target.targetId, p]));
  const depth = (p: StoredPlan, seen = new Set<string>()): number => {
    const prev = p.data.supersedes === null ? undefined : byTarget.get(p.data.supersedes);
    if (!prev || seen.has(p.data.target.targetId)) return 0;
    seen.add(p.data.target.targetId);
    return 1 + depth(prev, seen);
  };
  return plans
    .map((p) => ({ p, d: depth(p) }))
    .sort((a, b) => a.p.data.createdAt.localeCompare(b.p.data.createdAt) || a.d - b.d || a.p.id.localeCompare(b.p.id))
    .map((x) => x.p);
}

export function createNutritionStore({ sync, kv, now, newSeed, onWrite }: NutritionStoreDeps) {
  const loadSettings = (): NutritionSettings | null => {
    try {
      const raw = kv.get(SETTINGS_KEY);
      return raw ? NutritionSettingsSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };
  const loadDates = (key: string): IsoDate[] => {
    try {
      return z.array(IsoDateSchema).parse(JSON.parse(kv.get(key) ?? '[]'));
    } catch {
      return [];
    }
  };
  const loadGuardrails = () => loadDates(GUARDRAIL_KEY);
  const read = () => ({
    plans: orderPlans(parseList(NutritionPlanRecordSchema, sync.list(NUTRITION_COLLECTIONS.plans))),
    intakeLogs: parseList(IntakeLogSchema, sync.list(NUTRITION_COLLECTIONS.intakeLogs)).sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
    habitChecks: parseList(HabitCheckSchema, sync.list(NUTRITION_COLLECTIONS.habitChecks)).sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
  });

  return createStore<NutritionState>((set, get) => {
    const written = () => {
      set(read());
      onWrite?.();
    };
    return {
      ...read(),
      settings: loadSettings(),
      guardrailEvents: loadGuardrails(),
      pendingNotices: loadDates(NOTICE_KEY),
      reload: () => set({ ...read(), settings: loadSettings(), guardrailEvents: loadGuardrails(), pendingNotices: loadDates(NOTICE_KEY) }),
      saveSettings(settings) {
        const parsed = NutritionSettingsSchema.parse(settings);
        kv.set(SETTINGS_KEY, JSON.stringify(parsed));
        set({ settings: parsed });
      },
      recordPlan(input, reason) {
        const result = computeNutritionTarget(input, createEngineContext({ clock: { now: () => now().getTime() }, seed: newSeed() }));
        const latest = get().plans[get().plans.length - 1];
        const record = NutritionPlanRecordSchema.parse({ input, target: result.target, reason, createdAt: now().toISOString(), supersedes: latest?.data.target.targetId ?? null });
        sync.insert(NUTRITION_COLLECTIONS.plans, record);
        written();
        return result;
      },
      logIntake(entry, loggedOn, meal = null) {
        const estimate = estimateIntake(entry);
        const data = IntakeLogSchema.parse({ schemaVersion: 1, loggedOn, at: now().toISOString(), meal, entry, estimate: { energyKcal: estimate.energyKcal, proteinG: estimate.proteinG }, correctionOf: null, removed: false });
        sync.insert(NUTRITION_COLLECTIONS.intakeLogs, data);
        written();
        return data;
      },
      removeIntake(id) {
        const original = get().intakeLogs.find((l) => l.id === id);
        if (!original) throw new Error('unknown intake log');
        const data = IntakeLogSchema.parse({ ...original.data, at: now().toISOString(), correctionOf: id, removed: true });
        sync.insert(NUTRITION_COLLECTIONS.intakeLogs, data);
        written();
        return data;
      },
      checkHabit(habit, checkedOn, done) {
        const data = HabitCheckSchema.parse({ schemaVersion: 1, habit, checkedOn, done, at: now().toISOString() });
        sync.insert(NUTRITION_COLLECTIONS.habitChecks, data);
        written();
        return data;
      },
      receiveGuardrail(event) {
        const events = [...new Set([...loadGuardrails(), event.detectedOn])].sort();
        const notices = [...new Set([...loadDates(NOTICE_KEY), event.detectedOn])].sort();
        kv.set(GUARDRAIL_KEY, JSON.stringify(events));
        kv.set(NOTICE_KEY, JSON.stringify(notices));
        set({ guardrailEvents: events, pendingNotices: notices });
      },
      acknowledgeGuardrailNotices() {
        kv.remove(NOTICE_KEY);
        set({ pendingNotices: [] });
      },
      forget() {
        kv.remove(SETTINGS_KEY);
        kv.remove(GUARDRAIL_KEY);
        kv.remove(NOTICE_KEY);
        set({ settings: null, guardrailEvents: [], pendingNotices: [] });
      },
    };
  });
}

export type NutritionStore = ReturnType<typeof createNutritionStore>;
