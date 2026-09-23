import { s5LoadCeiling, screeningGateCheck, type LoadReference } from '@fitadapt/safety';
import {
  JOINTS,
  ProgramSessionContextSchema,
  SessionPlanSchema,
  type ProgramSessionContext,
  skillRank,
  type CapacitySlot,
  type Conditioning,
  type EquipmentId,
  type EquipmentLoads,
  type HistoryExercise,
  type JointFlags,
  type LoadImplement,
  type MovementPattern,
  type PlannedExercise,
  type PlannedSet,
  type ProgramSlot,
  type ProgressionDecision,
  type SafetyProfile,
  type SessionHistoryEntry,
  type SessionPlan,
  type SlotIntent,
  type SlotRole,
  type SlotTarget,
} from '@fitadapt/shared';
import { assessmentValue } from '../assessment/config.js';
import { loadForReps } from '../assessment/e1rm.js';
import { sessionValue, type SessionConfigKey } from '../config/session.js';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { blockingReasons, rankSubstitutes, redJointsLoaded, substitute, type GraphExercise } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import type { ProgramDay } from '../program/queries.js';
import type { EffectiveSession } from '../program/reflow.js';
import { SESSION_RULES_VERSION } from '../config/session.js';
import { achievableAtMost, implementFor, stepAbove } from './increments.js';
import { ladderOf, tagsOf, type SessionLibrary } from './library.js';
import { evaluateProgression } from './progression.js';
import { fitToTime, planSeconds, type WorkExercise } from './timebox.js';
import type { GenerateSessionInput, GenerateSessionResult, SessionSafetyEvent } from './types.js';

/**
 * M02 program session (ADR-015 "the API M02 builds on", ADR-016): each slot
 * of the M08 session of the day is filled with an exercise of its movement
 * pattern from the M06 graph, for the equipment of the place the user trains
 * at today, the SafetyProfile and the joint flags; it gets exactly the
 * program's hard sets, a rep range from the slot intent, a reserve within the
 * session's target RPE (S1 re-checked), a load from double progression (or
 * the assessment, or the user's choice) rounded to the equipment, the S5
 * ceiling, rest and tempo — each with reason codes — and the whole session
 * is fitted to the minutes available.
 */

const DAY_MS = 86_400_000;
const MAX_TARGET_RIR = 10;

type Origin = 'continued' | 'next_variant' | 'easier_variant' | 'from_assessment' | 'from_program' | 'switcher' | 's2' | 'substituted';

interface Candidate {
  readonly exerciseId: string;
  readonly ladderId: string | null;
  readonly origin: Origin;
  /** The origin reason of the exercise (set and exercise level). */
  readonly reasonCode: string;
  readonly capacity: CapacitySlot | null;
  /** Progression already decided for the exercise this candidate came from (variant moves). */
  readonly note: readonly string[];
  readonly params: Readonly<Record<string, number>>;
}

interface Ctx {
  readonly input: GenerateSessionInput;
  readonly library: SessionLibrary;
  readonly equipment: ReadonlySet<EquipmentId>;
  readonly loads: EquipmentLoads | null;
  readonly legacyStep: number;
  readonly jointFlags: JointFlags;
  readonly profile: SafetyProfile;
  readonly nowMs: number;
  readonly history: readonly SessionHistoryEntry[];
  readonly targetRir: number;
  readonly rirReason: string;
  readonly allowProgression: boolean;
  readonly maxSkill: number;
  readonly used: Set<string>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const isLoadedType = (t: string | undefined) => t === 'external' || t === 'machine';

/** Session reserve from the program's target RPE, raised until S1 (screeningGateCheck) accepts it; null when no reserve up to rir.max is allowed. */
export function sessionRir(profile: SafetyProfile, targetRpe: number | null, extra: number): { rir: number; s1Capped: boolean } | null {
  const fromRpe = targetRpe === null ? sessionValue('rir.default') : Math.ceil(assessmentValue('rpeAtZeroRir') - targetRpe - 1e-9);
  const start = Math.min(MAX_TARGET_RIR, Math.max(0, fromRpe) + extra);
  for (let rir = start; rir <= sessionValue('rir.max'); rir++) {
    if (screeningGateCheck({ profile, request: { rpe: assessmentValue('rpeAtZeroRir') - rir, hiit: false, maximalTest: false } }) === null) return { rir, s1Capped: rir > start };
  }
  return null;
}

function repRange(intent: SlotIntent, role: SlotRole): { min: number; max: number; code: string } {
  switch (intent) {
    case 'strength':
      return { min: sessionValue('repRange.strength.min'), max: sessionValue('repRange.strength.max'), code: 'session.rep_range.strength' };
    case 'hypertrophy':
      return role === 'primary'
        ? { min: sessionValue('repRange.hypertrophyPrimary.min'), max: sessionValue('repRange.hypertrophyPrimary.max'), code: 'session.rep_range.hypertrophy_primary' }
        : { min: sessionValue('repRange.hypertrophy.min'), max: sessionValue('repRange.hypertrophy.max'), code: 'session.rep_range.hypertrophy' };
    case 'skill':
      return { min: sessionValue('repRange.skill.min'), max: sessionValue('repRange.skill.max'), code: 'session.rep_range.skill' };
    case 'mobility':
      return { min: sessionValue('repRange.mobility.min'), max: sessionValue('repRange.mobility.max'), code: 'session.rep_range.mobility' };
    default:
      return { min: sessionValue('repRange.general.min'), max: sessionValue('repRange.general.max'), code: 'session.rep_range.general' };
  }
}

function restFor(intent: SlotIntent, loaded: boolean): number {
  switch (intent) {
    case 'strength':
      return sessionValue(loaded ? 'rest.strengthLoaded' : 'rest.strength');
    case 'hypertrophy':
      return sessionValue('rest.hypertrophy');
    case 'skill':
      return sessionValue('rest.skill');
    case 'balance':
      return sessionValue('rest.balance');
    case 'mobility':
      return sessionValue('rest.mobility');
    default:
      return sessionValue('rest.general');
  }
}

/** The most recent past exercise for this slot (same pattern and role) that the user actually did. */
function previousFor(history: readonly SessionHistoryEntry[], pattern: MovementPattern, role: SlotRole): HistoryExercise | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const found = [...history[i]!.exercises].reverse().find((e) => e.slot === pattern && e.role === role && e.performed.some((p) => p.status === 'done'));
    if (found) return found;
  }
  return null;
}

/**
 * Exercises of this pattern done in another role within the last 7 days (or dated later): a new choice
 * avoids them when it can, so a heavy and a light day of one exercise do not cap each other through S5.
 */
function recentInOtherRole(ctx: Ctx, pattern: MovementPattern, role: SlotRole): Set<string> {
  const since = ctx.nowMs - 7 * DAY_MS;
  const out = new Set<string>();
  for (const h of ctx.input.history ?? []) {
    if (Date.parse(h.startedAt) < since) continue;
    // Only loaded exercises: S5 applies to loads; a bodyweight variant can serve two roles.
    for (const e of h.exercises) if (e.slot === pattern && e.role !== role && isLoadedType(ctx.library.loadType(e.exerciseId))) out.add(e.exerciseId);
  }
  return out;
}

function progressionSessions(ctx: Ctx, exerciseId: string) {
  return ctx.history
    .filter((h) => h.countsForProgression)
    .flatMap((h) => h.exercises.filter((e) => e.exerciseId === exerciseId).map((e) => ({ at: h.startedAt, target: e.target, targetRir: e.targetRir, prescribedLoadKg: e.prescribedLoadKg, performed: e.performed })));
}

/** S5 references for an exercise: every load prescribed or lifted for it in the whole history given (deload weeks included, never trimmed), plus M07 recent loads. */
export function loadReferencesFor(history: readonly SessionHistoryEntry[], recent: readonly { exerciseId: string; loadKg: number; prescribedAt: string }[], exerciseId: string): LoadReference[] {
  const refs: LoadReference[] = [];
  for (const h of history) {
    for (const e of h.exercises) {
      if (e.exerciseId !== exerciseId) continue;
      if (e.prescribedLoadKg !== null) refs.push({ loadKg: e.prescribedLoadKg, at: h.prescribedAt });
      for (const p of e.performed) if (p.status === 'done' && p.loadKg !== null) refs.push({ loadKg: p.loadKg, at: h.startedAt });
    }
  }
  for (const r of recent) if (r.exerciseId === exerciseId) refs.push({ loadKg: r.loadKg, at: r.prescribedAt });
  return refs;
}

function allowed(ctx: Ctx, id: string): GraphExercise | null {
  const ex = ctx.library.graph.exercises.get(id);
  return ex && blockingReasons(ex, ctx.equipment, ctx.jointFlags, ctx.profile).length === 0 ? ex : null;
}

/** The exercise one step up or down the ladder of `exerciseId`, if an allowed one exists there. */
function ladderStep(ctx: Ctx, exerciseId: string, ladderId: string | null, direction: 1 | -1): { id: string; ladderId: string } | null {
  const found = ladderOf(ctx.library, exerciseId, ladderId);
  if (!found) return null;
  const step = found.ladder.steps[found.step + direction];
  const id = step?.find((x) => allowed(ctx, x) !== null && !ctx.used.has(x)) ?? step?.find((x) => allowed(ctx, x) !== null);
  return id ? { id, ladderId: found.ladder.id } : null;
}

/** The nearest allowed exercise at the same rung of its ladder (a sibling), or below it (any number of steps down), if any. */
function lowerAllowedStep(ctx: Ctx, exerciseId: string, ladderId: string | null): { id: string; ladderId: string } | null {
  const found = ladderOf(ctx.library, exerciseId, ladderId);
  if (!found) return null;
  for (let step = found.step; step >= 0; step--) {
    const id = found.ladder.steps[step]!.find((x) => x !== exerciseId && allowed(ctx, x) !== null);
    if (id) return { id, ladderId: found.ladder.id };
  }
  return null;
}

const SKILL_WANTS: Partial<Record<SlotIntent, number>> = { strength: 2, hypertrophy: 2, general: 1 };

/** Exercises of the pattern for a slot without history or assessment, best first (deterministic; ties on id). */
function defaultCandidates(ctx: Ctx, slot: ProgramSlot): Candidate[] {
  const scored: [number, string][] = [];
  for (const ex of ctx.library.graph.exercises.values()) {
    if (ex.pattern !== slot.pattern || skillRank(ex.skill) > ctx.maxSkill || allowed(ctx, ex.id) === null) continue;
    const tags = tagsOf(ctx.library, ex.id);
    const loaded = implementFor(ex, ctx.library.loadType(ex.id), ctx.equipment, ctx.loads, ctx.legacyStep);
    let score = 0;
    if (loaded?.implement) score += SKILL_WANTS[slot.intent] ?? 0;
    const rung = loaded ? null : ladderOf(ctx.library, ex.id);
    // Bodyweight ladders: a rung is a difficulty; without history or an assessment, start low on it (safer, and progression moves up).
    if (rung) score += 1 - 0.05 * rung.step;
    if (slot.intent === 'skill' && tags.includes('calisthenics_skill')) score += 3;
    if (tags.includes('conditioning')) score -= 5;
    if (tags.includes('eccentric_focus') && slot.intent !== 'skill') score -= 1;
    score -= 0.25 * Math.abs(skillRank(ex.skill) - ctx.maxSkill);
    // Amber joints (M05 caution): exercises loading them are chosen less readily.
    for (const joint of JOINTS) {
      if (ctx.jointFlags[joint] !== 'amber') continue;
      if (ex.jointLoad[joint] === 'high') score -= sessionValue('selection.amberHighPenalty');
      else if (ex.jointLoad[joint] === 'medium') score -= sessionValue('selection.amberMediumPenalty');
    }
    scored.push([score, ex.id]);
  }
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  return scored.map(([, id]) => ({ exerciseId: id, ladderId: ladderOf(ctx.library, id)?.ladder.id ?? null, origin: 'from_program' as const, reasonCode: 'session.exercise.from_program', capacity: null, note: [], params: {} }));
}

/** The target for a slot: history's hold time or the capacity target when they apply, else the intent's range. */
function targetFor(ctx: Ctx, cand: Candidate, slot: ProgramSlot, prev: HistoryExercise | null): { target: SlotTarget; code: string; params: Record<string, number> } {
  if (ctx.library.isHold(cand.exerciseId)) {
    const last = prev && prev.exerciseId === cand.exerciseId && prev.target.kind === 'hold' ? prev.target.seconds : null;
    const fromCap = cand.capacity && cand.capacity.exerciseId === cand.exerciseId && cand.capacity.target.kind === 'hold' ? cand.capacity.target.seconds : null;
    const seconds = cand.origin === 'next_variant' ? sessionValue('hold.minSeconds') : (last ?? fromCap ?? sessionValue('hold.defaultSeconds'));
    return { target: { kind: 'hold', seconds }, code: 'session.hold.target', params: { seconds } };
  }
  const bodyweight = implementFor(ctx.library.graph.exercises.get(cand.exerciseId)!, ctx.library.loadType(cand.exerciseId), ctx.equipment, ctx.loads, ctx.legacyStep) === null;
  if (bodyweight) {
    // A bodyweight range is personal: the one the user is building on (kept across variants), else the assessment's.
    const cap = cand.capacity;
    if (prev && prev.target.kind === 'reps' && ctx.library.loadType(prev.exerciseId) !== 'external' && ctx.library.loadType(prev.exerciseId) !== 'machine') {
      return { target: prev.target, code: 'session.rep_range.personal', params: { min: prev.target.min, max: prev.target.max } };
    }
    if (cap && cap.exerciseId === cand.exerciseId && cap.target.kind === 'reps') {
      return { target: cap.target, code: 'session.rep_range.from_assessment', params: { min: cap.target.min, max: cap.target.max } };
    }
  }
  const r = repRange(slot.intent, slot.role);
  return { target: { kind: 'reps', min: r.min, max: r.max }, code: r.code, params: { min: r.min, max: r.max } };
}

interface Prescribed {
  readonly exercise: PlannedExercise;
  readonly s5: boolean;
}

/** Sets, load, reserve, rest and tempo for one candidate; null when no safe load exists on this equipment (then the next candidate is tried). */
function prescribe(ctx: Ctx, cand: Candidate, slot: ProgramSlot, prev: HistoryExercise | null, sets: number): Prescribed | null {
  const ex = ctx.library.graph.exercises.get(cand.exerciseId)!;
  const { target, code: rangeCode, params: rangeParams } = targetFor(ctx, cand, slot, prev);
  const loading = implementFor(ex, ctx.library.loadType(ex.id), ctx.equipment, ctx.loads, ctx.legacyStep);
  const impl: LoadImplement | null = loading?.implement ?? null;
  const refs = loadReferencesFor(ctx.input.history ?? [], ctx.input.recentLoads ?? [], ex.id);
  const decision: ProgressionDecision = evaluateProgression({
    exerciseId: ex.id,
    pattern: ex.pattern,
    loading: loading === null ? 'bodyweight' : impl === null ? 'self_select' : 'load',
    target,
    targetRir: ctx.targetRir,
    sessions: progressionSessions(ctx, ex.id).slice(-sessionValue('history.maxSessions')),
    implement: impl,
    loadReferences: refs,
    asOf: iso(ctx.nowMs),
    allowProgression: ctx.allowProgression,
  });
  const loadReasons: string[] = [];
  const params: Record<string, number> = { ...rangeParams, rir: ctx.targetRir };
  let loadKg: number | null = null;
  const finalTarget = decision.target;

  if (loading === null) {
    loadReasons.push(ctx.library.loadType(ex.id) === 'band' ? 'session.load.band_self_select' : 'session.load.bodyweight_variant');
    const coef = ctx.library.bodyweightLoad?.(ex.id) ?? null;
    if (coef !== null) {
      loadReasons.push('session.load.bodyweight_share');
      params.percent = Math.round(coef * 100);
    }
    if (decision.action !== 'start' && cand.origin === 'continued') {
      loadReasons.push(...decision.reasonCodes);
      Object.assign(params, decision.reasonParams);
    }
  } else if (decision.action === 'start') {
    const cap = cand.capacity && cand.capacity.exerciseId === ex.id ? cand.capacity : null;
    let raw: number | null = null;
    if (cap?.e1rmKg != null && finalTarget.kind === 'reps') {
      raw = loadForReps(cap.e1rmKg, finalTarget.max, ctx.targetRir) * assessmentValue('firstSessionLoadFactor');
      loadReasons.push('session.load.from_e1rm');
    } else if (cap?.loadKg != null) {
      raw = cap.loadKg;
      loadReasons.push('session.load.from_test_load');
    } else {
      loadReasons.push('session.load.self_select_light');
    }
    if (raw !== null && impl) {
      loadKg = achievableAtMost(raw, impl);
      if (loadKg === null) return null;
      if (loadKg < raw - 1e-9) {
        loadReasons.push('session.load.rounded');
        params.stepKg = stepAbove(loadKg, impl) ?? 0;
      }
    } else if (raw !== null && !impl) {
      // Steps unknown: a number the user may not be able to make is not prescribed.
      loadReasons.splice(0, loadReasons.length, 'session.load.self_select_light');
    }
  } else {
    if (decision.action === 'variant_down' && decision.loadKg === null) return null; // no safe load on this equipment
    loadKg = decision.loadKg;
    loadReasons.push(...decision.reasonCodes);
    Object.assign(params, decision.reasonParams);
  }

  // S5 on every path (the progression evaluator already applied it to its own decisions).
  let s5 = decision.s5Capped;
  if (loadKg !== null) {
    const ceiling = s5LoadCeiling(refs, ctx.nowMs);
    if (ceiling !== null && loadKg > ceiling) {
      loadKg = impl ? achievableAtMost(ceiling, impl) : null;
      if (loadKg === null) return null;
      s5 = true;
      if (!loadReasons.includes('session.load.s5_capped')) loadReasons.push('session.load.s5_capped');
    }
  }

  const tempo = tagsOf(ctx.library, ex.id).includes('eccentric_focus') ? { eccentricSeconds: sessionValue('tempo.eccentricSeconds') } : null;
  if (tempo) params.tempoSeconds = tempo.eccentricSeconds;
  const restSeconds = restFor(slot.intent, loadKg !== null);
  const rangeReason = finalTarget.kind === 'hold' ? 'session.hold.target' : rangeCode;
  if (finalTarget.kind === 'hold') params.seconds = finalTarget.seconds;
  // Holds have no reps to spare: the reserve is an effort level (RPE = 10 − RIR on the same scale).
  const effortReason = finalTarget.kind === 'hold' && ctx.rirReason !== 'session.rir.s1_capped' ? 'session.effort.hold' : ctx.rirReason;
  if (effortReason === 'session.effort.hold') params.rpe = assessmentValue('rpeAtZeroRir') - ctx.targetRir;
  const setReasons = [cand.reasonCode, ...cand.note, ...loadReasons, rangeReason, effortReason, ...(tempo ? ['session.tempo.eccentric'] : [])];
  const planned: PlannedSet[] = Array.from({ length: sets }, (_, i) => ({
    index: i + 1,
    target: finalTarget,
    loadKg,
    targetRir: ctx.targetRir,
    restSeconds,
    tempo,
    reasonCodes: [...new Set(setReasons)],
    reasonParams: { ...cand.params, ...params },
  }));
  const ladderId = ladderOf(ctx.library, ex.id, cand.ladderId)?.ladder.id ?? null;
  return { exercise: { slot: slot.pattern, role: slot.role, exerciseId: ex.id, ladderId, supersetGroup: null, sets: planned, reasonCodes: [cand.reasonCode, `session.slot.${slot.role}`] }, s5 };
}

/** A blocked candidate mapped to the nearest-stimulus exercise here (S2 red joint, Anywhere Switcher, or other restriction). */
function mapBlocked(ctx: Ctx, cand: Candidate, ex: GraphExercise): Candidate | null {
  const reasons = blockingReasons(ex, ctx.equipment, ctx.jointFlags, ctx.profile);
  const red = redJointsLoaded(ex, ctx.jointFlags);
  // The same movement one or more steps easier first (never harder than where the person is), then the nearest stimulus.
  const lower = lowerAllowedStep(ctx, ex.id, cand.ladderId);
  const sub = lower ? null : substitute(ctx.library.graph, ex, ctx.equipment, ctx.jointFlags, ctx.profile);
  const id = lower?.id ?? sub?.exerciseId ?? null;
  if (!id) return null;
  if (red.length > 0) {
    return { ...cand, exerciseId: id, ladderId: lower?.ladderId ?? null, origin: 's2', reasonCode: `session.exercise.s2_substituted.${red[0]!}` };
  }
  // An easier step of the same movement says so (M07 wording); a different exercise is the switcher's or a substitute.
  if (lower) return { ...cand, exerciseId: id, ladderId: lower.ladderId, origin: 'substituted', reasonCode: 'session.exercise.stepped_down' };
  if (reasons.some((r) => r.code === 'substitution.equipment_unavailable')) return { ...cand, exerciseId: id, ladderId: null, origin: 'switcher', reasonCode: 'session.switcher.mapped' };
  return { ...cand, exerciseId: id, ladderId: null, origin: 'substituted', reasonCode: 'session.exercise.substituted' };
}

function planSlot(ctx: Ctx, slot: ProgramSlot, sets: number): Prescribed | null {
  const prev = previousFor(ctx.history, slot.pattern, slot.role);
  const candidates: Candidate[] = [];
  if (prev) {
    const prevEx = ctx.library.graph.exercises.get(prev.exerciseId);
    if (prevEx) {
      const loading = implementFor(prevEx, ctx.library.loadType(prevEx.id), ctx.equipment, ctx.loads, ctx.legacyStep);
      const decision = evaluateProgression({
        exerciseId: prevEx.id,
        pattern: prevEx.pattern,
        loading: loading === null ? 'bodyweight' : loading.implement === null ? 'self_select' : 'load',
        target: prev.target,
        targetRir: ctx.targetRir,
        sessions: progressionSessions(ctx, prevEx.id).slice(-sessionValue('history.maxSessions')),
        implement: loading?.implement ?? null,
        loadReferences: loadReferencesFor(ctx.input.history ?? [], ctx.input.recentLoads ?? [], prevEx.id),
        asOf: iso(ctx.nowMs),
        allowProgression: ctx.allowProgression,
      });
      const up = decision.action === 'variant_up';
      const down = decision.action === 'variant_down';
      const moved = up || down ? ladderStep(ctx, prevEx.id, prev.ladderId, up ? 1 : -1) : null;
      if (moved) {
        // The new variant carries why it was chosen (not the old variant's S5 note: its own load is decided afresh).
        const note = decision.reasonCodes.filter((c) => c !== 'session.load.s5_capped');
        candidates.push({ exerciseId: moved.id, ladderId: moved.ladderId, origin: up ? 'next_variant' : 'easier_variant', reasonCode: up ? 'session.exercise.next_variant' : 'session.exercise.easier_variant', capacity: null, note, params: decision.reasonParams });
      }
      const stay: string[] = up ? ['session.progression.next_variant_unavailable'] : down && !moved ? ['session.progression.easier_variant_unavailable'] : [];
      candidates.push({ exerciseId: prevEx.id, ladderId: prev.ladderId, origin: 'continued', reasonCode: 'session.exercise.continued', capacity: null, note: moved ? [] : stay, params: {} });
    }
  }
  const capSlot = ctx.input.capacity?.slots.find((s) => s.slot === slot.pattern) ?? null;
  if (capSlot) {
    candidates.push({ exerciseId: capSlot.exerciseId, ladderId: capSlot.ladderId, origin: 'from_assessment', reasonCode: 'session.exercise.from_assessment', capacity: capSlot, note: [], params: {} });
    // The capacity ladder's lower steps come before unrelated defaults (M07 rule: step down the same movement first).
    const ladder = ctx.library.ladders.find((l) => l.id === capSlot.ladderId);
    for (let step = Math.min(capSlot.stepIndex, (ladder?.steps.length ?? 0) - 1) - 1; ladder && step >= 0; step--) {
      for (const id of ladder.steps[step]!) candidates.push({ exerciseId: id, ladderId: ladder.id, origin: 'from_assessment', reasonCode: 'session.exercise.stepped_down', capacity: capSlot, note: [], params: {} });
    }
  }
  candidates.push(...defaultCandidates(ctx, slot));

  // S2: when the exercise this slot would have had without the joint flags loads a red joint, whatever replaces it is an S2 substitution.
  const unflagged = candidates.length > 0 && candidates[0]!.origin !== 'from_program' ? candidates[0] : defaultCandidates({ ...ctx, jointFlags: {} }, slot)[0];
  const preferred = unflagged ? ctx.library.graph.exercises.get(unflagged.exerciseId) : undefined;
  const redPreferred = preferred ? redJointsLoaded(preferred, ctx.jointFlags) : [];
  const otherRole = recentInOtherRole(ctx, slot.pattern, slot.role);
  const tried = new Set<string>();
  for (const pass of [false, true]) {
    for (const original of candidates) {
      // First pass: not already in today's session; second pass: repeats allowed (few options here).
      const ex = ctx.library.graph.exercises.get(original.exerciseId);
      if (!ex) continue;
      let cand = original;
      if (!allowed(ctx, ex.id)) {
        const mapped = mapBlocked(ctx, original, ex);
        if (!mapped) continue;
        cand = mapped;
      }
      if ((!pass && (ctx.used.has(cand.exerciseId) || (cand.origin !== 'continued' && otherRole.has(cand.exerciseId)))) || tried.has(`${pass}:${cand.exerciseId}:${cand.origin}`)) continue;
      tried.add(`${pass}:${cand.exerciseId}:${cand.origin}`);
      const result = prescribe(ctx, redPreferred.length > 0 && cand.origin !== 's2' ? { ...cand, origin: 's2', reasonCode: `session.exercise.s2_substituted.${redPreferred[0]!}` } : cand, slot, prev, sets);
      if (result) return result;
    }
  }
  return null;
}

function makeCtx(input: GenerateSessionInput, library: SessionLibrary, nowMs: number, targetRir: number, rirReason: string, allowProgression: boolean): Ctx {
  return {
    input,
    library,
    equipment: new Set(input.equipment),
    loads: input.equipmentLoads ?? null,
    legacyStep: input.loadIncrementKg ?? assessmentValue('defaultLoadIncrementKg'),
    jointFlags: input.jointFlags ?? {},
    profile: input.safetyProfile,
    nowMs,
    history: [...(input.history ?? [])].slice(-sessionValue('history.maxSessions')),
    targetRir,
    rirReason,
    allowProgression,
    maxSkill: sessionValue(`selection.maxSkill.${input.experience ?? 'beginner'}` as SessionConfigKey),
    used: new Set(),
  };
}

/**
 * Alternatives for one exercise of a plan (the user's swap, a pain flag, or
 * equipment that is not there): the nearest-stimulus exercises the graph
 * allows under the equipment, the SafetyProfile and the joint flags (S2),
 * each fully prescribed with the same rules (load, S5, rest, reserve), best
 * first. Exercises already in the plan are not offered.
 */
export function replacementsFor(input: GenerateSessionInput, library: SessionLibrary, plan: SessionPlan, exerciseIndex: number, nowMs: number, reason: 'user' | 'pain' | 'equipment', limit = 3): PlannedExercise[] {
  const current = plan.exercises[exerciseIndex];
  const original = current ? library.graph.exercises.get(current.exerciseId) : undefined;
  if (!current || !original) return [];
  const c = makeCtx(input, library, nowMs, plan.targetRir, 'session.rir.target', plan.program ? plan.program.microcycleKind === 'accumulation' : true);
  for (const e of plan.exercises) c.used.add(e.exerciseId);
  const first = current.sets[0]!;
  const intent: SlotIntent = plan.program ? intentFromRange(first.reasonCodes) : 'general';
  const slot: ProgramSlot = { pattern: current.slot, role: current.role, intent, hardSets: Math.min(12, current.sets.length) };
  const code = reason === 'pain' ? 'session.exercise.swapped_pain' : reason === 'equipment' ? 'session.switcher.mapped' : 'session.exercise.swapped';
  const out: PlannedExercise[] = [];
  const ranked = rankSubstitutes(library.graph, original, c.equipment, c.jointFlags, c.profile).map((r) => r.exerciseId);
  const sameLadder = ladderOf(library, original.id, current.ladderId);
  const lower = sameLadder ? sameLadder.ladder.steps.slice(0, sameLadder.step).reverse().flat() : [];
  for (const id of [...ranked, ...lower]) {
    if (out.length >= limit || c.used.has(id) || !allowed(c, id)) continue;
    const result = prescribe(c, { exerciseId: id, ladderId: null, origin: 'substituted', reasonCode: code, capacity: input.capacity?.slots.find((s) => s.slot === current.slot) ?? null, note: [], params: {} }, slot, null, slot.hardSets);
    if (result) {
      out.push(result.exercise);
      c.used.add(id);
    }
  }
  return out;
}

function intentFromRange(codes: readonly string[]): SlotIntent {
  if (codes.includes('session.rep_range.strength')) return 'strength';
  if (codes.includes('session.rep_range.hypertrophy') || codes.includes('session.rep_range.hypertrophy_primary')) return 'hypertrophy';
  if (codes.includes('session.rep_range.skill')) return 'skill';
  if (codes.includes('session.rep_range.mobility')) return 'mobility';
  return 'general';
}

export function programSession(input: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext): GenerateSessionResult {
  const program = input.programSession!;
  const session = program.session;
  const profile = input.safetyProfile;
  const reduced = input.readiness === 'reduced';
  const rir = sessionRir(profile, session.targetRpe, reduced ? sessionValue('readiness.extraRir') : 0);
  if (rir === null) return { status: 'unavailable', reasonCodes: ['session.unavailable.effort_cap'] };
  const nowMs = ctx.clock.now();
  const events: SessionSafetyEvent[] = [];
  if (rir.s1Capped) events.push({ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION });
  const kind = program.microcycle.kind;
  const rirReason = rir.s1Capped ? 'session.rir.s1_capped' : reduced ? 'session.rir.readiness_reduced' : kind === 'deload' ? 'session.rir.deload' : 'session.rir.target';
  const c = makeCtx(input, library, nowMs, rir.rir, rirReason, kind === 'accumulation');

  const planReasons: string[] = ['session.program.from_program'];
  if (kind === 'deload') planReasons.push('session.program.deload_week');
  if (kind === 'transition') planReasons.push('session.program.transition_week');
  if (session.state === 'shifted') planReasons.push('session.program.shifted');
  if (session.mergedFrom.length > 0) planReasons.push('session.program.merged');
  if (rir.s1Capped) planReasons.push('session.rir.s1_capped');
  if (reduced) planReasons.push('session.readiness.reduced');
  const place = input.equipmentProfileId ?? null;
  if (session.equipmentProfileId !== null && place !== null && place !== session.equipmentProfileId) planReasons.push('session.switcher.place_changed');

  const work: WorkExercise[] = [];
  for (const slot of session.slots) {
    if (reduced && slot.role === 'accessory') {
      planReasons.push('session.readiness.accessory_dropped');
      continue;
    }
    const sets = reduced ? Math.max(1, slot.hardSets - 1) : slot.hardSets;
    const result = planSlot(c, slot, sets);
    if (!result) {
      planReasons.push(`session.slot_dropped.${slot.pattern}`);
      continue;
    }
    c.used.add(result.exercise.exerciseId);
    work.push({ exercise: result.exercise, pattern: slot.pattern, role: slot.role, intent: slot.intent, sets: result.exercise.sets.length, partner: null, dropped: false });
  }

  // Conditioning goes to M03; S1 is re-checked (intervals only when HIIT is allowed).
  let conditioning: Conditioning | null = session.conditioning;
  if (conditioning?.kind === 'intervals' && screeningGateCheck({ profile, request: { rpe: assessmentValue('rpeAtZeroRir') - c.targetRir, hiit: true, maximalTest: false } }) !== null) {
    conditioning = { ...conditioning, kind: 'steady' };
    planReasons.push('session.conditioning.intervals_not_allowed');
    events.push({ invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed', action: 'capped', engineVersion: ENGINE_VERSION });
  }
  if (conditioning) planReasons.push(`session.conditioning.${conditioning.kind}_${conditioning.placement}`);

  const fit = fitToTime(work, sessionValue('warmUp.minutes'), conditioning, input.minutesAvailable);
  if (!fit) return { status: 'unavailable', reasonCodes: [...new Set([...planReasons, 'session.unavailable.no_time'])] };
  if (fit.reasonCodes.length > 0) planReasons.push('session.time.trimmed', ...fit.reasonCodes);
  if (fit.exercises.length === 0 && fit.conditioning === null) return { status: 'unavailable', reasonCodes: [...new Set([...planReasons, 'session.unavailable.no_exercise'])] };

  // Safety events for exercises that were dropped by time-boxing still happened (the engine decided them): keep them all, once each.
  const s = stamp(ctx);
  const draft = {
    planId: uuidFrom(ctx.rng),
    kind: 'program_session' as const,
    engineVersion: s.engineVersion,
    rulesVersion: SESSION_RULES_VERSION,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    capacityAssessedAt: input.capacity?.assessedAt ?? null,
    program: { programId: program.programId, sessionId: session.id, date: session.date, week: program.microcycle.week, microcycleKind: kind, mesocycleIntent: program.mesocycle.intent },
    equipmentProfileId: place,
    targetRir: c.targetRir,
    minutesAvailable: input.minutesAvailable,
    estimatedMinutes: 0,
    warmUp: { minutes: fit.warmUpMinutes, minimumMinutes: sessionValue('warmUp.minimumMinutes') },
    conditioning: fit.conditioning,
    exercises: fit.exercises,
    reasonCodes: [...new Set(planReasons)],
  };
  const seconds = planSeconds(draft);
  const plan: SessionPlan = SessionPlanSchema.parse({ ...draft, estimatedMinutes: Math.min(input.minutesAvailable, Math.ceil(seconds / 6) / 10) });
  // Safety events of what the plan actually prescribes (L11): S2 substitutions and S5 caps that survived time-boxing, plus S1.
  const setCodes = plan.exercises.flatMap((e) => e.sets.flatMap((x) => x.reasonCodes));
  if (plan.exercises.some((e) => e.reasonCodes[0]!.startsWith('session.exercise.s2_substituted.'))) events.push({ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted', engineVersion: ENGINE_VERSION });
  if (setCodes.includes('session.load.s5_capped')) events.push({ invariant: 'S5', reasonCode: 'safety.s5.load_ceiling', action: 'capped', engineVersion: ENGINE_VERSION });
  return { status: 'ok', plan, safetyEvents: dedupe(events) };
}

function dedupe(events: readonly SessionSafetyEvent[]): SessionSafetyEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = `${e.invariant}:${e.reasonCode}:${e.action}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const _internal = { previousFor, repRange, restFor, DAY_MS };

/** The generator's program input for one session of a program day (M08 programDay → M02). */
export function programSessionContext(day: ProgramDay, session: EffectiveSession): ProgramSessionContext {
  if (session.state !== 'planned' && session.state !== 'shifted') throw new RangeError('only a planned or shifted session can be generated');
  return ProgramSessionContextSchema.parse({
    programId: day.programId,
    session: { ...session, state: session.state },
    microcycle: { week: day.microcycle.week, kind: day.microcycle.kind, volumeFactor: day.microcycle.volumeFactor },
    mesocycle: { index: day.mesocycle.index, intent: day.mesocycle.intent },
  });
}
