import { screeningGateCheck } from '@fitadapt/safety';
import {
  CapacityModelSchema,
  SafetyProfileSchema,
  SessionPlanSchema,
  type CapacityModel,
  type CapacitySlot,
  type EquipmentId,
  type JointFlags,
  type LoadType,
  type PlannedExercise,
  type PlannedSet,
  type SafetyProfile,
  type SessionPlan,
  type SlotTarget,
} from '@fitadapt/shared';
import { assessmentValue, firstSessionValue } from '../assessment/config.js';
import type { CapacityLibrary } from '../assessment/capacity.js';
import { loadForReps, roundDownToIncrement } from '../assessment/e1rm.js';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { blockingReasons, substitute, substitutionSafetyEvent, type ExerciseGraph } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';

/**
 * S5 load ceiling (docs/specs/00-product-vision.md): a prescribed load never
 * rises more than 10 % within 7 days. Invariant constants, not configuration.
 */
export const S5_MAX_INCREASE_FRACTION = 0.1 as const;
export const S5_WINDOW_DAYS = 7 as const;
const DAY_MS = 86_400_000;
const MAX_TARGET_RIR = 5;

export interface SessionLibrary extends CapacityLibrary {
  readonly graph: ExerciseGraph;
  readonly loadType: (exerciseId: string) => LoadType | undefined;
}

export interface RecentLoad {
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly prescribedAt: string;
}

export interface GenerateSessionInput {
  readonly capacity: CapacityModel;
  readonly safetyProfile: SafetyProfile;
  /** Equipment of the active equipment profile. */
  readonly equipment: readonly EquipmentId[];
  readonly minutesAvailable: number;
  readonly jointFlags?: JointFlags;
  /** Loads prescribed recently (S5). */
  readonly recentLoads?: readonly RecentLoad[];
  readonly loadIncrementKg?: number;
}

export interface SessionSafetyEvent {
  readonly invariant: 'S2' | 'S5';
  readonly reasonCode: string;
  readonly action: 'substituted' | 'capped';
  readonly engineVersion: string;
}

export type GenerateSessionResult =
  | { readonly status: 'ok'; readonly plan: SessionPlan; readonly safetyEvents: readonly SessionSafetyEvent[] }
  | { readonly status: 'unavailable'; readonly reasonCodes: readonly string[] };

/** First-session reserve: the configured RIR, raised until S1 (screeningGateCheck) accepts the matching RPE. */
export function firstSessionRir(profile: SafetyProfile): number | null {
  for (let rir = firstSessionValue('targetRir'); rir <= MAX_TARGET_RIR; rir++) {
    if (screeningGateCheck({ profile, request: { rpe: assessmentValue('rpeAtZeroRir') - rir, hiit: false, maximalTest: false } }) === null) return rir;
  }
  return null;
}

interface Choice {
  readonly exerciseId: string;
  readonly reasonCode: string;
  readonly fromCapacity: boolean;
  readonly event: SessionSafetyEvent | null;
}

/** The capacity rung if allowed; else an allowed exercise lower on the same ladder; else the best graph substitute. */
function chooseExercise(slot: CapacitySlot, input: GenerateSessionInput, library: SessionLibrary): Choice | null {
  const allowed = (id: string) => {
    const exercise = library.graph.exercises.get(id);
    return exercise !== undefined && blockingReasons(exercise, input.equipment, input.jointFlags ?? {}, input.safetyProfile).length === 0;
  };
  if (allowed(slot.exerciseId)) return { exerciseId: slot.exerciseId, reasonCode: 'session.exercise.from_assessment', fromCapacity: true, event: null };
  const ladder = library.ladders.find((l) => l.id === slot.ladderId);
  for (let step = Math.min(slot.stepIndex, (ladder?.steps.length ?? 0) - 1); ladder && step >= 0; step--) {
    const found = ladder.steps[step]!.find(allowed);
    if (found) return { exerciseId: found, reasonCode: 'session.exercise.stepped_down', fromCapacity: false, event: null };
  }
  if (!library.graph.exercises.has(slot.exerciseId)) return null;
  const sub = substitute(library.graph, slot.exerciseId, input.equipment, input.jointFlags ?? {}, input.safetyProfile);
  if (!sub) return null;
  const s2 = substitutionSafetyEvent(sub);
  return { exerciseId: sub.exerciseId, reasonCode: 'session.exercise.substituted', fromCapacity: false, event: s2 ? { ...s2, engineVersion: ENGINE_VERSION } : null };
}

function targetFor(choice: Choice, slot: CapacitySlot, library: SessionLibrary): SlotTarget {
  if (choice.fromCapacity) return slot.target;
  return library.isHold(choice.exerciseId)
    ? { kind: 'hold', seconds: assessmentValue('defaultHoldSeconds') }
    : { kind: 'reps', min: assessmentValue('defaultRepsMin'), max: assessmentValue('defaultRepsMax') };
}

const isLoaded = (t: LoadType | undefined) => t === 'external' || t === 'machine';

function setSeconds(target: SlotTarget, restSeconds: number): number {
  const work = target.kind === 'hold' ? target.seconds : target.max * firstSessionValue('secondsPerRep');
  return work + restSeconds;
}

function minutesOf(exercises: readonly PlannedExercise[]): number {
  const seconds = exercises.reduce((sum, e) => sum + e.sets.reduce((s, set) => s + setSeconds(set.target, set.restSeconds), 0), 0);
  return Math.round((firstSessionValue('warmUpMinutes') + seconds / 60) * 10) / 10;
}

/**
 * First session from the assessment (M07 → M02): one exercise per capacity
 * slot at the assessed rung and starting load, within the SafetyProfile and
 * the active equipment, fitted to the minutes available. Pure and
 * deterministic (injected clock and seed); every set carries reason codes.
 *
 * Safety: S1 via screeningGateCheck (target RIR raised until the RPE is
 * allowed; no HIIT, no maximal efforts), S2 and the SafetyProfile filters via
 * the M06 substitution rules, S5 via the load ceiling against recent loads,
 * S7 (no automatic programming) → no plan. M02 extends this generator
 * (progression, full slot model, time-boxing by supersets); it must keep
 * these guarantees.
 */
export function generateSession(rawInput: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext): GenerateSessionResult {
  const input: GenerateSessionInput = { ...rawInput, capacity: CapacityModelSchema.parse(rawInput.capacity), safetyProfile: SafetyProfileSchema.parse(rawInput.safetyProfile) };
  const profile = input.safetyProfile;
  if (profile.screeningOutcome === 'blocked') return { status: 'unavailable', reasonCodes: ['session.unavailable.blocked'] };
  if (profile.screeningOutcome === 'not_screened') return { status: 'unavailable', reasonCodes: ['session.unavailable.not_screened'] };
  if (!profile.automaticProgrammingAllowed || profile.lowIntensityLibraryOnly) return { status: 'unavailable', reasonCodes: ['session.unavailable.professional_guidance'] };
  const targetRir = firstSessionRir(profile);
  if (targetRir === null) return { status: 'unavailable', reasonCodes: ['session.unavailable.effort_cap'] };
  const rirReason = targetRir > firstSessionValue('targetRir') ? 'session.rir.s1_capped' : 'session.rir.first_session';

  const now = ctx.clock.now();
  const safetyEvents: SessionSafetyEvent[] = [];
  const planReasons: string[] = ['session.first.from_assessment'];
  const exercises: PlannedExercise[] = [];

  for (const slot of input.capacity.slots) {
    const choice = chooseExercise(slot, input, library);
    if (!choice) {
      planReasons.push(`session.slot_dropped.${slot.slot}`);
      continue;
    }
    if (choice.event) safetyEvents.push(choice.event);
    const target = targetFor(choice, slot, library);
    const loadReasons: string[] = [];
    let loadKg: number | null = null;
    const increment = input.loadIncrementKg ?? assessmentValue('defaultLoadIncrementKg');
    if (choice.fromCapacity && slot.e1rmKg !== null && target.kind === 'reps') {
      loadKg = roundDownToIncrement(loadForReps(slot.e1rmKg, target.max, targetRir) * assessmentValue('firstSessionLoadFactor'), increment);
      loadReasons.push('session.load.from_e1rm');
    } else if (choice.fromCapacity && slot.loadKg !== null) {
      loadKg = slot.loadKg;
      loadReasons.push('session.load.from_test_load');
    } else if (isLoaded(library.loadType(choice.exerciseId))) {
      loadReasons.push('session.load.self_select_light');
    } else {
      loadReasons.push('session.load.bodyweight_variant');
    }
    if (loadKg !== null) {
      const since = now - S5_WINDOW_DAYS * DAY_MS;
      const recent = (input.recentLoads ?? []).filter((r) => r.exerciseId === choice.exerciseId && Date.parse(r.prescribedAt) >= since && Date.parse(r.prescribedAt) <= now);
      if (recent.length > 0) {
        const ceiling = roundDownToIncrement(Math.min(...recent.map((r) => r.loadKg)) * (1 + S5_MAX_INCREASE_FRACTION), increment);
        if (loadKg > ceiling) {
          loadKg = ceiling;
          loadReasons.push('session.load.s5_capped');
          safetyEvents.push({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling', action: 'capped', engineVersion: ENGINE_VERSION });
        }
      }
    }
    const restSeconds = loadKg !== null ? firstSessionValue('restSecondsLoaded') : firstSessionValue('restSecondsBodyweight');
    const sets: PlannedSet[] = Array.from({ length: firstSessionValue('setsPerExercise') }, (_, i) => ({
      index: i + 1,
      target,
      loadKg,
      targetRir,
      restSeconds,
      reasonCodes: [choice.reasonCode, ...loadReasons, rirReason],
    }));
    exercises.push({ slot: slot.slot, exerciseId: choice.exerciseId, sets, reasonCodes: [choice.reasonCode, ...slot.reasonCodes] });
  }

  // Fit the clock: one set per exercise (from the last slot back), then drop the last slots.
  let trimmed = false;
  for (let i = exercises.length - 1; i >= 0 && minutesOf(exercises) > input.minutesAvailable; i--) {
    if (exercises[i]!.sets.length > 1) {
      exercises[i] = { ...exercises[i]!, sets: exercises[i]!.sets.slice(0, 1) };
      trimmed = true;
    }
  }
  while (exercises.length > 0 && minutesOf(exercises) > input.minutesAvailable) {
    exercises.pop();
    trimmed = true;
  }
  if (trimmed) planReasons.push('session.time.trimmed');
  if (exercises.length === 0) return { status: 'unavailable', reasonCodes: [...planReasons, 'session.unavailable.no_exercise'] };

  const s = stamp(ctx);
  const plan = SessionPlanSchema.parse({
    planId: uuidFrom(ctx.rng),
    kind: 'first_session',
    engineVersion: s.engineVersion,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    capacityAssessedAt: input.capacity.assessedAt,
    targetRir,
    estimatedMinutes: minutesOf(exercises),
    exercises,
    reasonCodes: planReasons,
  });
  return { status: 'ok', plan, safetyEvents };
}
