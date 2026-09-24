import { impactRank, skillRank, type CardioMovement, type CardioProtocol, type EquipmentId, type ImpactLevel, type JointFlags, type MovementPattern, type SafetyProfile } from '@fitadapt/shared';
import { blockingReasons, redJointsLoaded, type GraphExercise } from '../substitution.js';
import { tagsOf, type SessionLibrary } from '../session/library.js';
import { cardioValue } from './config.js';

/**
 * Which movements and machines a cardio block uses, for the equipment of the
 * place, the SafetyProfile (avoid tags, exclusions, impact ceiling), the
 * joint flags (S2: nothing loading a red joint at medium/high) and today's
 * cardio impact ceiling (gates.ts). Machines are preferred for steady work
 * and for intervals when the place has them (lowest impact first); otherwise
 * a bodyweight circuit. Venue swaps (step-ups ↔ stair climber, shadow boxing
 * ↔ rower, marching ↔ bike) come from the library (M06 seed content).
 */

export interface MovementContext {
  readonly library: SessionLibrary;
  readonly equipment: ReadonlySet<EquipmentId>;
  readonly jointFlags: JointFlags;
  readonly profile: SafetyProfile;
  readonly ceiling: ImpactLevel;
  /** The user's skill ceiling (SESSION_CONFIG selection.maxSkill), capped for conditioning. */
  readonly maxSkill: number;
}

const CIRCUIT_PATTERNS: readonly MovementPattern[] = ['squat', 'horizontal_push', 'locomotion', 'lunge', 'hinge', 'core'];

const isMachine = (library: SessionLibrary, id: string) => library.loadType(id) === 'machine';

/** Allowed here and now, within today's impact and skill ceilings. */
export function movementAllowed(ctx: MovementContext, ex: GraphExercise | undefined): ex is GraphExercise {
  if (!ex) return false;
  if (blockingReasons(ex, ctx.equipment, ctx.jointFlags, ctx.profile).length > 0) return false;
  if (impactRank(ex.impact) > impactRank(ctx.ceiling)) return false;
  return skillRank(ex.skill) <= Math.min(ctx.maxSkill, cardioValue('movement.maxSkillRank'));
}

/** True when a red joint (S2) is what keeps this conditioning exercise out (for the safety log). */
export function blockedByRedJoint(ctx: MovementContext, ex: GraphExercise): boolean {
  return redJointsLoaded(ex, ctx.jointFlags).length > 0;
}

function conditioning(ctx: MovementContext): GraphExercise[] {
  return [...ctx.library.graph.exercises.values()].filter((ex) => tagsOf(ctx.library, ex.id).includes('conditioning')).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Timed movements for steady work and intervals: machines, walking, marching … (no external load). */
function timedPool(ctx: MovementContext): GraphExercise[] {
  return conditioning(ctx).filter((ex) => {
    const lt = ctx.library.loadType(ex.id);
    return lt === 'machine' || lt === 'none' || lt === 'bodyweight';
  });
}

/** Rep-counted bodyweight movements for EMOM and AMRAP circuits. */
function circuitPool(ctx: MovementContext): GraphExercise[] {
  return [...ctx.library.graph.exercises.values()]
    .filter((ex) => CIRCUIT_PATTERNS.includes(ex.pattern) && ctx.library.loadType(ex.id) === 'bodyweight' && !ctx.library.isHold(ex.id))
    .filter((ex) => {
      const tags = tagsOf(ctx.library, ex.id);
      return !tags.includes('calisthenics_skill') && !tags.includes('mobility') && !tags.includes('balance') && !tags.includes('eccentric_focus');
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface MovementChoice {
  readonly movements: CardioMovement[];
  /** Conditioning exercises left out because they load a red joint (S2), for the defensibility log. */
  readonly redBlocked: boolean;
  readonly reasonCodes: string[];
}

function movement(ex: GraphExercise, code: string): CardioMovement {
  return { exerciseId: ex.id, impact: ex.impact, reasonCodes: [code] };
}

/** The steady modality the library prefers first (M06 content), then any allowed timed low-impact movement. */
function steadyOrder(ctx: MovementContext): string[] {
  const listed = ctx.library.cardio?.steady ?? [];
  const rest = timedPool(ctx)
    .filter((ex) => !listed.includes(ex.id))
    .sort((a, b) => Number(isMachine(ctx.library, b.id)) - Number(isMachine(ctx.library, a.id)) || impactRank(a.impact) - impactRank(b.impact) || (a.id < b.id ? -1 : 1))
    .map((ex) => ex.id);
  return [...listed, ...rest];
}

/** The requested movement if allowed here; else its venue swap (e.g. rower for shadow boxing at the gym); else null. */
function requested(ctx: MovementContext, id: string | null | undefined, pool: readonly string[]): { id: string; code: string } | null {
  if (!id) return null;
  const graph = ctx.library.graph.exercises;
  if (pool.includes(id) && movementAllowed(ctx, graph.get(id))) return { id, code: 'cardio.movement.requested' };
  for (const swap of ctx.library.cardio?.swaps(id) ?? []) if (pool.includes(swap) && movementAllowed(ctx, graph.get(swap))) return { id: swap, code: 'cardio.movement.venue_swap' };
  return null;
}

export function chooseMovements(ctx: MovementContext, protocol: CardioProtocol, preferred: string | null | undefined): MovementChoice {
  const graph = ctx.library.graph.exercises;
  const circuit = protocol === 'emom' || protocol === 'amrap';
  const candidates = circuit ? circuitPool(ctx) : timedPool(ctx);
  const redBlocked = candidates.some((ex) => blockedByRedJoint(ctx, ex));
  const allowedIds = candidates.filter((ex) => movementAllowed(ctx, ex)).map((ex) => ex.id);
  const reasons: string[] = [];
  const asked = requested(ctx, preferred, candidates.map((c) => c.id));
  if (preferred && !asked) reasons.push('cardio.movement.requested_unavailable');

  if (protocol === 'steady') {
    const id = asked?.id ?? steadyOrder(ctx).find((x) => allowedIds.includes(x));
    if (!id) return { movements: [], redBlocked, reasonCodes: [...reasons, 'cardio.movement.any_easy'] };
    return { movements: [movement(graph.get(id)!, asked?.code ?? (isMachine(ctx.library, id) ? 'cardio.movement.machine' : 'cardio.movement.steady'))], redBlocked, reasonCodes: reasons };
  }

  if (circuit) {
    const picks: CardioMovement[] = [];
    if (asked) picks.push(movement(graph.get(asked.id)!, asked.code));
    for (const pattern of CIRCUIT_PATTERNS) {
      if (picks.length >= cardioValue('movement.maxInCircuit')) break;
      if (picks.some((p) => graph.get(p.exerciseId)!.pattern === pattern)) continue;
      const pick = candidates
        .filter((ex) => ex.pattern === pattern && allowedIds.includes(ex.id))
        .sort((a, b) => skillRank(a.skill) - skillRank(b.skill) || impactRank(a.impact) - impactRank(b.impact) || (a.id < b.id ? -1 : 1))[0];
      if (pick) picks.push(movement(pick, 'cardio.movement.circuit'));
    }
    return { movements: picks, redBlocked, reasonCodes: picks.length > 0 ? reasons : [...reasons, 'cardio.movement.none'] };
  }

  // Intervals: a machine the place has (one modality, lowest impact), else a bodyweight rotation.
  if (asked) return { movements: [movement(graph.get(asked.id)!, asked.code)], redBlocked, reasonCodes: reasons };
  const machine = steadyOrder(ctx).find((x) => allowedIds.includes(x) && isMachine(ctx.library, x));
  if (machine) return { movements: [movement(graph.get(machine)!, 'cardio.movement.machine')], redBlocked, reasonCodes: reasons };
  const rotation = candidates
    .filter((ex) => allowedIds.includes(ex.id) && ctx.library.loadType(ex.id) !== 'machine' && !tagsOf(ctx.library, ex.id).includes('warm_up'))
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || skillRank(a.skill) - skillRank(b.skill) || (a.id < b.id ? -1 : 1))
    .slice(0, cardioValue('movement.maxInIntervals'))
    .map((ex) => movement(ex, 'cardio.movement.rotation'));
  if (rotation.length > 0) return { movements: rotation, redBlocked, reasonCodes: reasons };
  // Nothing hard is allowed: easy timed moves (e.g. marching) still make an interval.
  const easy = candidates.filter((ex) => allowedIds.includes(ex.id)).slice(0, cardioValue('movement.maxInIntervals')).map((ex) => movement(ex, 'cardio.movement.rotation'));
  return { movements: easy, redBlocked, reasonCodes: easy.length > 0 ? reasons : [...reasons, 'cardio.movement.any_easy'] };
}

/**
 * Alternatives for one movement of a cardio block (the user's swap during
 * execution, or another place): its venue swaps first, then the other allowed
 * movements of the same kind, never one already in the block.
 */
export function cardioAlternatives(ctx: MovementContext, protocol: CardioProtocol, exerciseId: string, inBlock: readonly string[], limit = 3): string[] {
  const graph = ctx.library.graph.exercises;
  const circuit = protocol === 'emom' || protocol === 'amrap';
  const pool = (circuit ? circuitPool(ctx) : timedPool(ctx)).filter((ex) => movementAllowed(ctx, ex)).map((ex) => ex.id);
  const out: string[] = [];
  for (const id of [...(ctx.library.cardio?.swaps(exerciseId) ?? []), ...(circuit ? pool : steadyOrder(ctx))]) {
    if (out.length >= limit) break;
    if (id === exerciseId || inBlock.includes(id) || out.includes(id) || !pool.includes(id) || !movementAllowed(ctx, graph.get(id))) continue;
    out.push(id);
  }
  return out;
}
