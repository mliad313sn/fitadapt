import { screeningGateCheck } from '@fitadapt/safety';
import { SessionPlanSchema, type CardioPlan, type Conditioning, type SessionPlan } from '@fitadapt/shared';
import { sessionValue, SESSION_RULES_VERSION, type SessionConfigKey } from '../config/session.js';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { buildWarmUp, type WarmupContext } from '../recovery/warmup.js';
import type { SessionLibrary } from '../session/library.js';
import type { GenerateSessionInput, GenerateSessionResult, SessionSafetyEvent } from '../session/types.js';
import { ENGINE_VERSION } from '../version.js';
import { cardioValue } from './config.js';
import { cardioImpactCeiling, consistentTraining, hiitGate } from './gates.js';
import type { MovementContext } from './movements.js';
import { buildCardio, isHiitRequest, type CardioBuildContext } from './plan.js';
import { zoneOf, zonesFor } from './zones.js';

/**
 * M03 inside the one session generator (ADR-016, ADR-018):
 * - `cardioSession`: a standalone cardio session (mode 'cardio'), after the
 *   same gates as every session (generateSession: S1 effort cap, S3 lock, S7);
 *   a HIIT request is refused (never downgraded silently) when S1 or the
 *   two-weeks-of-training rule does not allow it;
 * - `cardioBlock`: the M08 conditioning block of a program session (a
 *   finisher, or the whole session), built once the M02 time-boxing has set
 *   its minutes.
 */

export function movementContext(input: GenerateSessionInput, library: SessionLibrary): MovementContext & { impactReasons: string[] } {
  const impact = cardioImpactCeiling({ profile: input.safetyProfile, jointFlags: input.jointFlags, bodyweightKg: input.bodyweightKg, heightCm: input.heightCm, impactOptIn: input.impactOptIn });
  return {
    library,
    equipment: new Set(input.equipment),
    jointFlags: input.jointFlags ?? {},
    profile: input.safetyProfile,
    ceiling: impact.ceiling,
    maxSkill: sessionValue(`selection.maxSkill.${input.experience ?? 'beginner'}` as SessionConfigKey),
    impactReasons: impact.reasonCodes,
  };
}

function buildContext(input: GenerateSessionInput, library: SessionLibrary, nowMs: number): CardioBuildContext {
  const m = movementContext(input, library);
  return { ...m, zones: zonesFor({ profile: input.safetyProfile, birthDate: input.birthDate, heartRate: input.heartRate, nowMs }) };
}

/** The HIIT gate for M08 interval blocks: null when intervals may stay, else the reason they become steady. */
export function programIntervalsGate(input: GenerateSessionInput, nowMs: number): string | null {
  return consistentTraining(input.history ?? [], nowMs) ? null : 'cardio.hiit.needs_consistent_training';
}

/**
 * The cardio block of a program session's conditioning. Intervals that have no
 * allowed movement here become steady work (`fellBack`). Null when no block
 * can be built (too short): the conditioning then keeps its minutes only.
 */
export function cardioBlock(
  input: GenerateSessionInput,
  library: SessionLibrary,
  nowMs: number,
  conditioning: Conditioning,
  warmUpMinutes: number,
): { plan: CardioPlan; conditioning: Conditioning; fellBack: boolean; events: SessionSafetyEvent[] } | null {
  const ctx = buildContext(input, library, nowMs);
  const block = (protocol: 'hiit' | 'steady') => buildCardio({ protocol, placement: conditioning.placement, minutes: conditioning.minutes, warmUpSeconds: warmUpMinutes * 60 }, ctx);
  const events = (redBlocked: boolean): SessionSafetyEvent[] => (redBlocked ? [{ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'blocked', engineVersion: ENGINE_VERSION }] : []);
  const first = block(conditioning.kind === 'intervals' ? 'hiit' : 'steady');
  if (first) return { plan: first.plan, conditioning, fellBack: false, events: events(first.redBlocked) };
  if (conditioning.kind !== 'intervals') return null;
  const steady = block('steady');
  return steady ? { plan: steady.plan, conditioning: { ...conditioning, kind: 'steady' }, fellBack: true, events: events(steady.redBlocked) } : null;
}

export function cardioSession(input: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext): GenerateSessionResult {
  const unavailable = (...codes: string[]): GenerateSessionResult => ({ status: 'unavailable', reasonCodes: codes });
  const request = input.cardio ?? { protocol: 'steady' as const };
  const nowMs = ctx.clock.now();
  const profile = input.safetyProfile;
  const bctx = buildContext(input, library, nowMs);
  const hiit = isHiitRequest(request.protocol, request.custom);
  const target = zoneOf(bctx.zones, hiit ? 'vigorous' : 'moderate');
  // M05 readiness: on a day the check says "less ready", high-intensity intervals wait; the rest stays at a moderate effort.
  const reduced = input.readiness === 'reduced';
  if (hiit && reduced) return unavailable('cardio.session.standalone', 'cardio.unavailable.readiness_reduced');
  if (hiit) {
    const gate = hiitGate(profile, input.history ?? [], nowMs, target.rpeMax);
    if (gate === 'safety.s1.hiit_not_allowed') return unavailable('cardio.session.standalone', 'cardio.unavailable.hiit_s1');
    if (gate) return unavailable('cardio.session.standalone', 'cardio.unavailable.hiit_needs_consistent_training');
  } else if (screeningGateCheck({ profile, request: { rpe: target.rpeMax, hiit: false, maximalTest: false } }) !== null) {
    return unavailable('session.unavailable.effort_cap');
  }
  const warmUpMinutes = sessionValue('warmUp.minimumMinutes');
  const minutes = Math.min(180, Math.floor(input.minutesAvailable - warmUpMinutes));
  if (minutes * 60 - cardioValue('coolDown.sessionSeconds') < cardioValue('session.minMainSeconds')) return unavailable('cardio.session.standalone', 'session.unavailable.no_time');
  const built = buildCardio({ protocol: request.protocol, placement: 'session', minutes, warmUpSeconds: warmUpMinutes * 60, custom: request.custom, preferred: request.exerciseId ?? null }, bctx);
  if (!built) return unavailable('cardio.session.standalone', 'cardio.unavailable.no_movement');

  const warm: WarmupContext = { library, equipment: bctx.equipment, loads: input.equipmentLoads ?? null, legacyStep: input.loadIncrementKg ?? 2.5, jointFlags: bctx.jointFlags, profile };
  const conditioning: Conditioning = { kind: hiit ? 'intervals' : 'steady', placement: 'session', minutes };
  const s = stamp(ctx);
  const draft: SessionPlan = {
    planId: uuidFrom(ctx.rng),
    kind: 'cardio_session',
    engineVersion: s.engineVersion,
    rulesVersion: SESSION_RULES_VERSION,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    capacityAssessedAt: input.capacity?.assessedAt ?? null,
    program: null,
    equipmentProfileId: input.equipmentProfileId ?? null,
    targetRir: Math.max(0, Math.min(10, Math.ceil(10 - target.rpeMax))),
    minutesAvailable: input.minutesAvailable,
    estimatedMinutes: warmUpMinutes + minutes,
    warmUp: { minutes: warmUpMinutes, minimumMinutes: warmUpMinutes, content: buildWarmUp(warm, [], warmUpMinutes) },
    conditioning,
    exercises: [],
    coolDown: null,
    cardio: built.plan,
    reasonCodes: ['cardio.session.standalone', `cardio.protocol.${request.protocol}`, ...(reduced ? ['cardio.readiness.reduced'] : [])],
  };
  const events: SessionSafetyEvent[] = built.redBlocked ? [{ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'blocked', engineVersion: ENGINE_VERSION }] : [];
  return { status: 'ok', plan: SessionPlanSchema.parse(draft), safetyEvents: events };
}
