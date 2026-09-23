import {
  AssessmentResultSchema,
  CAPACITY_SLOTS,
  CapacityModelSchema,
  type AssessmentResult,
  type AssessmentTestResult,
  type CapacityModel,
  type CapacitySlot,
  type CapacitySlotId,
  type SlotTarget,
} from '@fitadapt/shared';
import { ENGINE_VERSION } from '../version.js';
import { assessmentValue } from './config.js';
import { epleyE1RM, loadForReps, roundDownToIncrement } from './e1rm.js';
import { ASSESSMENT_PROTOCOLS, type AssessmentTestDefinition } from './protocols.js';

/** A progression ladder as packages/exercise-library defines it (steps of equal-rank exercises, easiest first). */
export interface AssessmentLadder {
  readonly id: string;
  readonly steps: readonly (readonly string[])[];
}

export interface CapacityLibrary {
  readonly ladders: readonly AssessmentLadder[];
  /** True for isometric exercises, whose target is a hold time instead of reps. */
  readonly isHold: (exerciseId: string) => boolean;
}

/** Ladder of each slot when the protocol does not test it: the slot starts at that ladder's lowest rung. */
export const DEFAULT_SLOT_LADDERS: Readonly<Record<CapacitySlotId, string>> = Object.freeze({
  squat: 'squat',
  horizontal_push: 'push',
  vertical_pull: 'pull',
  horizontal_pull: 'row_bodyweight',
  hinge: 'hinge',
  core: 'plank',
});

export class AssessmentInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AssessmentInputError';
  }
}

const DAY_MS = 86_400_000;
const v = assessmentValue;
const round1 = (x: number) => Math.round(x * 10) / 10;

interface Placement {
  readonly slot: CapacitySlot;
  /** Whether the test reached its stayMin (for gates). */
  readonly reachedStayMin: boolean;
}

function findLadder(library: CapacityLibrary, id: string): AssessmentLadder {
  const ladder = library.ladders.find((l) => l.id === id);
  if (!ladder || ladder.steps.length === 0) throw new AssessmentInputError(`assessment.ladder_missing.${id}`);
  return ladder;
}

function defaultTarget(library: CapacityLibrary, exerciseId: string): SlotTarget {
  return library.isHold(exerciseId) ? { kind: 'hold', seconds: v('defaultHoldSeconds') } : { kind: 'reps', min: v('defaultRepsMin'), max: v('defaultRepsMax') };
}

/** Working target derived from what the user did on the rung they stay on. */
function workingTarget(library: CapacityLibrary, exerciseId: string, kind: AssessmentTestDefinition['kind'], measure: number): SlotTarget {
  if (kind === 'hold') {
    if (!library.isHold(exerciseId)) return defaultTarget(library, exerciseId);
    return { kind: 'hold', seconds: Math.max(v('workingHoldFloorSeconds'), Math.round(measure * v('workingHoldFraction'))) };
  }
  if (library.isHold(exerciseId)) return defaultTarget(library, exerciseId);
  const min = Math.max(v('workingRepsFloor'), Math.floor(measure * v('workingRepsLowFraction')));
  return { kind: 'reps', min, max: Math.max(min + 1, Math.floor(measure * v('workingRepsHighFraction'))) };
}

function lowest(slot: CapacitySlotId, ladder: AssessmentLadder, library: CapacityLibrary, testId: string | null, reason: string): CapacitySlot {
  const exerciseId = ladder.steps[0]![0]!;
  return { slot, ladderId: ladder.id, exerciseId, stepIndex: 0, testId, e1rmKg: null, loadKg: null, target: defaultTarget(library, exerciseId), reasonCodes: [reason] };
}

function measureOf(def: AssessmentTestDefinition, r: Extract<AssessmentTestResult, { status: 'done' }>): number {
  const raw = def.kind === 'hold' ? r.seconds : r.reps;
  if (raw === null) throw new AssessmentInputError(`assessment.result.missing_measure.${def.id}`);
  // A result above the cap counts as the cap. Loaded tests are not clamped: above 12 reps Epley is not used at all.
  const cap = def.kind === 'hold' ? def.capSeconds : def.kind === 'load_reps' ? null : def.capReps;
  return cap ? Math.min(raw, v(cap)) : raw;
}

/** Maps one test result to a rung (and a starting load for loaded tests). */
export function mapTestResult(def: AssessmentTestDefinition, result: AssessmentTestResult, library: CapacityLibrary, stopRir: number): Placement {
  const ladder = findLadder(library, def.ladderId);
  if (result.status === 'skipped') return { slot: lowest(def.slot, ladder, library, def.id, `assessment.mapping.skipped_${result.reason}`), reachedStayMin: false };
  if (!def.options.includes(result.exerciseId)) throw new AssessmentInputError(`assessment.result.unknown_variant.${def.id}`);
  const tested = ladder.steps.findIndex((step) => step.includes(result.exerciseId));
  if (tested < 0) throw new AssessmentInputError(`assessment.result.variant_not_on_ladder.${def.id}`);
  const measure = measureOf(def, result);
  const zero = measure === 0 || (def.kind === 'load_reps' && !(result.loadKg !== null && result.loadKg > 0));
  // Spec rule: a result of zero maps to the lowest rung of the ladder, with encouraging copy.
  if (zero) return { slot: lowest(def.slot, ladder, library, def.id, 'assessment.mapping.zero_lowest_rung'), reachedStayMin: false };

  const at = (step: number) => (step === tested ? result.exerciseId : ladder.steps[step]![0]!);
  if (def.kind === 'load_reps') {
    const load = result.loadKg as number;
    const e1rm = epleyE1RM(load, measure, result.rir ?? stopRir);
    const base = e1rm === null ? load : loadForReps(e1rm, v('firstSessionTargetReps'), stopRir);
    const loadKg = roundDownToIncrement(base * v('firstSessionLoadFactor'));
    return {
      slot: {
        slot: def.slot,
        ladderId: ladder.id,
        exerciseId: result.exerciseId,
        stepIndex: tested,
        testId: def.id,
        e1rmKg: e1rm === null ? null : round1(e1rm),
        loadKg,
        target: { kind: 'reps', min: v('firstSessionRepRangeMin'), max: v('firstSessionRepRangeMax') },
        reasonCodes: [e1rm === null ? 'assessment.e1rm.out_of_range' : 'assessment.e1rm.epley_rir', 'assessment.load.first_session_factor'],
      },
      reachedStayMin: true,
    };
  }

  const mapping = def.mapping as NonNullable<AssessmentTestDefinition['mapping']>;
  const last = ladder.steps.length - 1;
  let step = tested;
  let reason = 'assessment.mapping.in_range';
  if (measure < v(mapping.stayMin)) {
    step = Math.max(0, tested - 1);
    reason = 'assessment.mapping.step_down';
  } else if (measure >= v(mapping.promoteAt)) {
    step = Math.min(last, tested + 1);
    reason = 'assessment.mapping.step_up';
  }
  const exerciseId = at(step);
  const target = step === tested ? workingTarget(library, exerciseId, def.kind, measure) : defaultTarget(library, exerciseId);
  return {
    slot: { slot: def.slot, ladderId: ladder.id, exerciseId, stepIndex: step, testId: def.id, e1rmKg: null, loadKg: null, target, reasonCodes: [reason] },
    reachedStayMin: measure >= v(mapping.stayMin),
  };
}

/**
 * The CapacityModel of a completed assessment: for each movement slot, the
 * starting rung (ladder step) and, for loaded tests, the RIR-adjusted Epley
 * e1RM and a starting load. Several tests on one slot: the highest rung wins,
 * but a gated test counts only if its gate test reached stayMin (rows raise
 * the pull rung only with a tolerable dead hang). Slots the protocol does not
 * test start at the lowest rung of their default ladder. Pure and
 * deterministic; re-computed on the server to check a synced record.
 */
export function buildCapacityModel(input: AssessmentResult, library: CapacityLibrary): CapacityModel {
  const result = AssessmentResultSchema.parse(input);
  const protocol = ASSESSMENT_PROTOCOLS[result.protocolId];
  if (protocol.version !== result.protocolVersion) throw new AssessmentInputError('assessment.result.protocol_version');
  const placements = new Map<string, Placement>();
  for (const def of protocol.tests) {
    const r = result.tests.find((t) => t.testId === def.id);
    if (!r) throw new AssessmentInputError(`assessment.result.incomplete.${def.id}`);
    placements.set(def.id, mapTestResult(def, r, library, result.stopRir));
  }
  if (result.tests.some((t) => !placements.has(t.testId))) throw new AssessmentInputError('assessment.result.unknown_test');

  const slots: CapacitySlot[] = [];
  for (const slot of CAPACITY_SLOTS) {
    const defs = protocol.tests.filter((d) => d.slot === slot);
    if (defs.length === 0) {
      slots.push(lowest(slot, findLadder(library, DEFAULT_SLOT_LADDERS[slot]), library, null, 'assessment.mapping.not_tested_lowest_rung'));
      continue;
    }
    let best: CapacitySlot | null = null;
    for (const def of defs) {
      const placed = placements.get(def.id)!;
      const counts = !def.gate || placements.get(def.gate.testId)?.reachedStayMin === true;
      if (!counts) continue;
      if (!best || placed.slot.stepIndex > best.stepIndex) best = placed.slot;
    }
    // The first test of a slot is never gated, so `best` is set.
    slots.push(best as CapacitySlot);
  }

  return CapacityModelSchema.parse({
    schemaVersion: 1,
    protocolId: result.protocolId,
    protocolVersion: result.protocolVersion,
    engineVersion: ENGINE_VERSION,
    assessedAt: result.completedAt,
    reassessDueAt: new Date(Date.parse(result.completedAt) + v('defaultMesocycleWeeks') * 7 * DAY_MS).toISOString(),
    slots,
  });
}
