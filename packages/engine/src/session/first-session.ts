import { S5_MAX_INCREASE_FRACTION, S5_WINDOW_DAYS, s5LoadCeiling, screeningGateCheck } from '@fitadapt/safety';
import {
  SessionPlanSchema,
  type CapacitySlot,
  type LoadType,
  type PlannedExercise,
  type PlannedSet,
  type SafetyProfile,
  type SlotTarget,
} from '@fitadapt/shared';
import { assessmentValue, firstSessionValue } from '../assessment/config.js';
import { loadForReps, roundDownToIncrement } from '../assessment/e1rm.js';
import { SESSION_RULES_VERSION } from '../config/session.js';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { blockingReasons, substitute, substitutionSafetyEvent } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { achievableAtMost, implementFor } from './increments.js';
import type { SessionLibrary } from './library.js';
import { loadReferencesFor } from './program-session.js';
import type { GenerateSessionInput, GenerateSessionResult, SessionSafetyEvent } from './types.js';
import { buildWarmUp } from '../recovery/warmup.js';

export type { SessionLibrary } from './library.js';
export type { GenerateSessionInput, GenerateSessionResult, RecentLoad, SessionSafetyEvent } from './types.js';
// M07 callers import the generator from here; it lives in generate.ts (one generator for every session).
export { generateSession } from './generate.js';

/**
 * S5 load ceiling (docs/specs/00-product-vision.md): a prescribed load never
 * rises more than 10 % within 7 days. Invariant constants, not configuration
 * (defined in packages/safety since M02; re-exported here for M07 callers).
 */
export { S5_MAX_INCREASE_FRACTION, S5_WINDOW_DAYS };
const MAX_TARGET_RIR = 5;

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
 * First session from the assessment (M07, extended by M02): one exercise per
 * capacity slot at the assessed rung and starting load, within the
 * SafetyProfile and the active equipment, fitted to the minutes available.
 * Pure and deterministic (injected clock and seed); every set carries reason
 * codes. Called by generateSession() once the common gates (S1 effort cap,
 * S3, S7) have passed.
 *
 * Safety: S1 via screeningGateCheck (target RIR raised until the RPE is
 * allowed; no HIIT, no maximal efforts), S2 and the SafetyProfile filters via
 * the M06 substitution rules, S5 via the load ceiling against every load of
 * the last 7 days (and any dated later: a clock moved back never escapes it).
 * M02: when the place's loads are known, loads round down to what that
 * equipment can make; when they are not, the user chooses a light load.
 */
export function firstSession(input: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext, targetRir: number): GenerateSessionResult {
  const capacity = input.capacity!;
  const rirReason = targetRir > firstSessionValue('targetRir') ? 'session.rir.s1_capped' : 'session.rir.first_session';
  const now = ctx.clock.now();
  const safetyEvents: SessionSafetyEvent[] = [];
  const planReasons: string[] = ['session.first.from_assessment'];
  const exercises: PlannedExercise[] = [];
  const equipment = new Set(input.equipment);
  const increment = input.loadIncrementKg ?? assessmentValue('defaultLoadIncrementKg');

  for (const slot of capacity.slots) {
    const choice = chooseExercise(slot, input, library);
    if (!choice) {
      planReasons.push(`session.slot_dropped.${slot.slot}`);
      continue;
    }
    if (choice.event) safetyEvents.push(choice.event);
    const target = targetFor(choice, slot, library);
    const loadReasons: string[] = [];
    let loadKg: number | null = null;
    const exercise = library.graph.exercises.get(choice.exerciseId)!;
    const loading = input.equipmentLoads ? implementFor(exercise, library.loadType(choice.exerciseId), equipment, input.equipmentLoads, increment) : null;
    const round = (raw: number): number | null => (input.equipmentLoads ? (loading?.implement ? achievableAtMost(raw, loading.implement) : null) : roundDownToIncrement(raw, increment));
    if (choice.fromCapacity && slot.e1rmKg !== null && target.kind === 'reps') {
      loadKg = round(loadForReps(slot.e1rmKg, target.max, targetRir) * assessmentValue('firstSessionLoadFactor'));
      loadReasons.push(loadKg === null ? 'session.load.self_select_light' : 'session.load.from_e1rm');
    } else if (choice.fromCapacity && slot.loadKg !== null) {
      loadKg = input.equipmentLoads ? round(slot.loadKg) : slot.loadKg;
      loadReasons.push(loadKg === null ? 'session.load.self_select_light' : 'session.load.from_test_load');
    } else if (isLoaded(library.loadType(choice.exerciseId))) {
      loadReasons.push('session.load.self_select_light');
    } else {
      loadReasons.push('session.load.bodyweight_variant');
    }
    if (loadKg !== null) {
      const ceiling = s5LoadCeiling(loadReferencesFor(input.history ?? [], input.recentLoads ?? [], choice.exerciseId), now);
      if (ceiling !== null && loadKg > ceiling) {
        const capped = input.equipmentLoads ? round(ceiling) : roundDownToIncrement(ceiling, increment);
        if (capped === null) {
          // No load this equipment can make is under the S5 ceiling: the slot is not prescribed.
          planReasons.push(`session.slot_dropped.${slot.slot}`);
          continue;
        }
        loadKg = capped;
        loadReasons.push('session.load.s5_capped');
        safetyEvents.push({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling', action: 'capped', engineVersion: ENGINE_VERSION });
      }
    }
    const restSeconds = loadKg !== null ? firstSessionValue('restSecondsLoaded') : firstSessionValue('restSecondsBodyweight');
    const sets: PlannedSet[] = Array.from({ length: firstSessionValue('setsPerExercise') }, (_, i) => ({
      index: i + 1,
      target,
      loadKg,
      targetRir,
      restSeconds,
      tempo: null,
      reasonCodes: [choice.reasonCode, ...loadReasons, rirReason],
      reasonParams: {},
    }));
    const ladderId = library.ladders.find((l) => l.id === slot.ladderId && l.steps.some((s) => s.includes(choice.exerciseId)))?.id ?? null;
    exercises.push({ slot: slot.slot, role: slot.slot === 'core' ? 'accessory' : 'primary', exerciseId: choice.exerciseId, ladderId, supersetGroup: null, sets, reasonCodes: [choice.reasonCode, ...slot.reasonCodes] });
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
    rulesVersion: SESSION_RULES_VERSION,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    capacityAssessedAt: capacity.assessedAt,
    program: null,
    equipmentProfileId: input.equipmentProfileId ?? null,
    targetRir,
    minutesAvailable: input.minutesAvailable,
    estimatedMinutes: minutesOf(exercises),
    warmUp: {
      minutes: firstSessionValue('warmUpMinutes'),
      minimumMinutes: firstSessionValue('warmUpMinutes'),
      // M05: what the warm-up is (general, ramp-up before the first loaded exercise, mobility for today's patterns).
      content: buildWarmUp(
        { library, equipment: new Set(input.equipment), loads: input.equipmentLoads ?? null, legacyStep: input.loadIncrementKg ?? assessmentValue('defaultLoadIncrementKg'), jointFlags: input.jointFlags ?? {}, profile: input.safetyProfile },
        exercises,
        firstSessionValue('warmUpMinutes'),
      ),
    },
    conditioning: null,
    exercises,
    reasonCodes: planReasons,
  });
  return { status: 'ok', plan, safetyEvents };
}
