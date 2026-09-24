import { CardioPlanSchema, impactRank, type CardioIntensity, type CardioPlan, type CardioProtocol, type CardioRequest, type CardioSegment, type CardioSegmentKind, type HrZoneSet, type IntervalProtocol } from '@fitadapt/shared';
import { cardioValue } from './config.js';
import { chooseMovements, movementAllowed, type MovementContext } from './movements.js';

/**
 * M03 protocol builder: the timeline of a conditioning block, second by
 * second, for HIIT (work/recover rounds), Tabata (20 s/10 s × 8 per block),
 * EMOM (a set at the top of every minute), AMRAP (as many rounds as possible
 * of a short circuit), steady-state and custom work/rest. The block fills
 * exactly the minutes it was given (whole seconds, contiguous segments), so
 * the M02 time-boxing and the plan's estimated minutes stay right, and the
 * device can run it eyes-free (cues.ts).
 *
 * Intensity of each step: HIIT/Tabata/vigorous-custom work is vigorous (the
 * only vigorous work, S1-gated upstream); EMOM, AMRAP, steady and
 * moderate-custom work are moderate; warm-up, recoveries, block rests and the
 * cool-down are light (not counted toward the weekly aerobic target).
 */

export interface CardioBlockRequest {
  readonly protocol: CardioProtocol;
  readonly placement: 'session' | 'finisher';
  /** Minutes of the conditioning block (main work and the easy end). */
  readonly minutes: number;
  /** Warm-up seconds at the start of the timeline (whole cardio sessions: the plan's warm-up). */
  readonly warmUpSeconds: number;
  readonly custom?: CardioRequest['custom'];
  readonly preferred?: string | null;
}

export interface CardioBuildContext extends MovementContext {
  readonly zones: HrZoneSet;
  readonly impactReasons: readonly string[];
}

export interface CardioBuildResult {
  readonly plan: CardioPlan;
  /** A conditioning exercise was left out because it loads a red joint (S2). */
  readonly redBlocked: boolean;
}

export const isHiitRequest = (protocol: CardioProtocol, custom?: CardioRequest['custom']): boolean => protocol === 'hiit' || protocol === 'tabata' || (protocol === 'custom' && custom?.intensity === 'vigorous');

class Timeline {
  readonly segments: CardioSegment[] = [];
  private at = 0;
  push(kind: CardioSegmentKind, durationSeconds: number, intensity: CardioIntensity, exerciseId: string | null, extra: { reps?: number | null; round?: number | null; rounds?: number | null } = {}): void {
    if (durationSeconds <= 0) return;
    this.segments.push({ index: this.segments.length, kind, startSeconds: this.at, durationSeconds, intensity, exerciseId, reps: extra.reps ?? null, round: extra.round ?? null, rounds: extra.rounds ?? null });
    this.at += durationSeconds;
  }
  get total(): number {
    return this.at;
  }
}

/** Null when the block cannot be built (too short for the protocol, or no allowed movement for a circuit or intervals). */
export function buildCardio(req: CardioBlockRequest, ctx: CardioBuildContext): CardioBuildResult | null {
  const hiit = isHiitRequest(req.protocol, req.custom);
  const choice = chooseMovements(ctx, req.protocol, req.preferred);
  const ids = choice.movements.map((m) => m.exerciseId);
  if (req.protocol !== 'steady' && ids.length === 0) return null;
  const machine = ids.length > 0 && ctx.library.loadType(ids[0]!) === 'machine';
  const graph = ctx.library.graph.exercises;
  // The easy steps use the same machine when there is one, else the gentlest allowed timed movement (or the user's choice).
  const easyId = machine
    ? ids[0]!
    : (ctx.library.cardio?.steady ?? []).find((id) => {
        const ex = graph.get(id);
        return movementAllowed(ctx, ex) && impactRank(ex.impact) <= impactRank('low') && ctx.library.loadType(id) !== 'machine';
      }) ?? null;

  const t = new Timeline();
  if (req.placement === 'session') t.push('warm_up', Math.round(req.warmUpSeconds), 'light', easyId);
  const cool = cardioValue(req.placement === 'session' ? 'coolDown.sessionSeconds' : 'coolDown.finisherSeconds');
  const main = Math.round(req.minutes * 60) - cool;
  if (main < cardioValue('session.minMainSeconds')) return null;
  const mainStart = t.total;
  let interval: IntervalProtocol | null = null;
  const move = (i: number) => (ids.length > 0 ? ids[i % ids.length]! : null);
  const recoverId = machine ? ids[0]! : null;

  switch (req.protocol) {
    case 'steady':
      t.push('steady', main, 'moderate', move(0));
      break;
    case 'hiit':
    case 'custom': {
      const work = req.protocol === 'hiit' ? cardioValue('hiit.workSeconds') : req.custom?.workSeconds ?? cardioValue('hiit.workSeconds');
      const rest = req.protocol === 'hiit' ? cardioValue('hiit.recoverSeconds') : req.custom?.restSeconds ?? cardioValue('hiit.recoverSeconds');
      const wanted = req.protocol === 'hiit' ? cardioValue('hiit.maxRounds') : req.custom?.rounds ?? cardioValue('hiit.maxRounds');
      const rounds = Math.min(wanted, Math.floor(main / (work + rest)));
      if (rounds < 1) return null;
      const intensity: CardioIntensity = hiit ? 'vigorous' : 'moderate';
      for (let i = 0; i < rounds; i++) {
        t.push('work', work, intensity, move(i), { round: i + 1, rounds });
        t.push('recover', rest, 'light', recoverId, { round: i + 1, rounds });
      }
      interval = { workSeconds: work, restSeconds: rest, rounds, blocks: 1, blockRestSeconds: 0 };
      break;
    }
    case 'tabata': {
      const work = cardioValue('tabata.workSeconds');
      const rest = cardioValue('tabata.restSeconds');
      const rounds = cardioValue('tabata.rounds');
      const blockRest = cardioValue('tabata.blockRestSeconds');
      const block = rounds * (work + rest);
      const blocks = Math.min(cardioValue('tabata.maxBlocks'), Math.floor((main + blockRest) / (block + blockRest)));
      if (blocks < 1) return null;
      for (let b = 0; b < blocks; b++) {
        for (let i = 0; i < rounds; i++) {
          t.push('work', work, 'vigorous', move(b * rounds + i), { round: i + 1, rounds });
          t.push('recover', rest, 'light', recoverId, { round: i + 1, rounds });
        }
        if (b < blocks - 1) t.push('block_rest', blockRest, 'light', recoverId);
      }
      interval = { workSeconds: work, restSeconds: rest, rounds, blocks, blockRestSeconds: blockRest };
      break;
    }
    case 'emom': {
      const minutes = Math.min(cardioValue('emom.maxMinutes'), Math.floor(main / 60));
      for (let i = 0; i < minutes; i++) t.push('emom_minute', 60, 'moderate', move(i), { reps: cardioValue('emom.reps'), round: i + 1, rounds: minutes });
      interval = { workSeconds: 60, restSeconds: 0, rounds: minutes, blocks: 1, blockRestSeconds: 0 };
      break;
    }
    case 'amrap': {
      const minutes = Math.min(cardioValue('amrap.maxMinutes'), Math.floor(main / 60));
      t.push('amrap', minutes * 60, 'moderate', null, { reps: cardioValue('amrap.reps') });
      break;
    }
  }
  // Whatever the main block leaves goes to the easy end, so the block fills exactly its minutes.
  const leftover = main - (t.total - mainStart);
  t.push('cool_down', cool + leftover, 'light', easyId);

  const planned = { moderateSeconds: 0, vigorousSeconds: 0 };
  for (const s of t.segments) {
    if (s.intensity === 'moderate') planned.moderateSeconds += s.durationSeconds;
    if (s.intensity === 'vigorous') planned.vigorousSeconds += s.durationSeconds;
  }
  const target: CardioIntensity = hiit ? 'vigorous' : 'moderate';
  const reasonCodes = [
    `cardio.protocol.${req.protocol}`,
    `cardio.placement.${req.placement}`,
    `cardio.intensity.${target}`,
    ...(req.placement === 'session' ? ['cardio.warm_up.included'] : []),
    'cardio.cool_down.easy',
    ...ctx.impactReasons,
    ...choice.reasonCodes,
    ...(hiit ? ['cardio.hiit.gates_passed'] : []),
  ];
  const plan = CardioPlanSchema.parse({
    protocol: req.protocol,
    placement: req.placement,
    hiit,
    interval,
    impactCeiling: ctx.ceiling,
    movements: choice.movements,
    targetIntensity: target,
    zones: ctx.zones,
    timeline: t.segments,
    totalSeconds: t.total,
    planned,
    reasonCodes: [...new Set(reasonCodes)],
  });
  return { plan, redBlocked: choice.redBlocked };
}
