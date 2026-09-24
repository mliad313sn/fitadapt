import { SessionPlanSchema, skillRank, type MovementPattern, type PlannedExercise, type PlannedSet } from '@fitadapt/shared';
import { sessionValue, SESSION_RULES_VERSION, type SessionConfigKey } from '../config/session.js';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { tagsOf, type SessionLibrary } from '../session/library.js';
import { planSeconds } from '../session/timebox.js';
import type { GenerateSessionInput, GenerateSessionResult } from '../session/types.js';
import { recoveryValue } from './config.js';
import { buildCoolDown, buildWarmUp, gentle, type WarmupContext } from './warmup.js';

/**
 * M05 standalone mobility and balance session (Mariam: "balance and mobility
 * matter more to me than biceps"; targeted at 55+). Gentle by construction:
 * only balance and mobility exercises that are allowed for the person
 * (equipment, SafetyProfile avoid-tags and impact ceiling, S2) and never load
 * a joint at a high level or an amber/red joint beyond "low"; easiest skill
 * first, supported variants first; balance as timed holds, mobility as
 * 8–10 easy reps, generous reserve. Alternates balance and mobility until the
 * minutes are used, after a short warm-up, and rotates the starting exercise
 * with each mobility session done so the sessions vary. The same gates as
 * every session apply before it (generateSession: S1, S3, S7).
 */

const PATTERNS: readonly MovementPattern[] = ['balance', 'mobility'];

export function mobilitySession(input: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext): GenerateSessionResult {
  const warm: WarmupContext = {
    library,
    equipment: new Set(input.equipment),
    loads: input.equipmentLoads ?? null,
    legacyStep: input.loadIncrementKg ?? 2.5,
    jointFlags: input.jointFlags ?? {},
    profile: input.safetyProfile,
  };
  const maxSkill = sessionValue(`selection.maxSkill.${input.experience ?? 'beginner'}` as SessionConfigKey);
  const done = (input.history ?? []).filter((h) => h.exercises.length > 0 && h.exercises.every((e) => PATTERNS.includes(e.slot))).length;
  const pools = PATTERNS.map((pattern) => {
    const list = [...library.graph.exercises.values()].filter((ex) => {
      const tags = tagsOf(library, ex.id);
      return ex.pattern === pattern && skillRank(ex.skill) <= maxSkill && !tags.includes('conditioning') && gentle(warm, ex);
    });
    list.sort((a, b) => skillRank(a.skill) - skillRank(b.skill) || Number(tagsOf(library, b.id).includes('supported')) - Number(tagsOf(library, a.id).includes('supported')) || (a.id < b.id ? -1 : 1));
    const offset = list.length > 0 ? done % list.length : 0;
    return [...list.slice(offset), ...list.slice(0, offset)];
  });
  const rir = Math.max(recoveryValue('mobility.targetRir'), 10 - input.safetyProfile.maxRPE);
  const warmUpMinutes = sessionValue('warmUp.minimumMinutes');
  const exercises: PlannedExercise[] = [];
  const budget = input.minutesAvailable * 60;
  const seen = new Set<string>();
  for (let round = 0; round < 20; round++) {
    const pattern = PATTERNS[round % 2]!;
    const pool = pools[round % 2]!;
    const id = pool.find((x) => !seen.has(x.id))?.id;
    if (!id) {
      if (pools.every((p) => p.every((x) => seen.has(x.id)))) break;
      continue;
    }
    const exercise = prescribe(library, id, pattern, rir);
    if (planSeconds({ warmUp: { minutes: warmUpMinutes }, conditioning: null, exercises: [...exercises, exercise] }) > budget) break;
    seen.add(id);
    exercises.push(exercise);
  }
  if (exercises.length === 0) return { status: 'unavailable', reasonCodes: ['session.unavailable.no_mobility_exercise'] };
  const warmUp = { minutes: warmUpMinutes, minimumMinutes: warmUpMinutes, content: buildWarmUp(warm, exercises, warmUpMinutes) };
  const base = planSeconds({ warmUp, conditioning: null, exercises });
  const coolDown = buildCoolDown(warm, exercises, budget - base);
  const s = stamp(ctx);
  const draft = {
    planId: uuidFrom(ctx.rng),
    kind: 'mobility_session' as const,
    engineVersion: s.engineVersion,
    rulesVersion: SESSION_RULES_VERSION,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    capacityAssessedAt: input.capacity?.assessedAt ?? null,
    program: null,
    equipmentProfileId: input.equipmentProfileId ?? null,
    targetRir: rir,
    minutesAvailable: input.minutesAvailable,
    estimatedMinutes: 0,
    warmUp,
    conditioning: null,
    exercises,
    coolDown,
    reasonCodes: ['session.mobility.standalone', ...(coolDown ? ['cooldown.after_session'] : [])],
  };
  const seconds = planSeconds(draft);
  return { status: 'ok', plan: SessionPlanSchema.parse({ ...draft, estimatedMinutes: Math.min(input.minutesAvailable, Math.ceil(seconds / 6) / 10) }), safetyEvents: [] };
}

function prescribe(library: SessionLibrary, id: string, pattern: MovementPattern, rir: number): PlannedExercise {
  const hold = pattern === 'balance' || library.isHold(id);
  const seconds = recoveryValue('mobility.holdSeconds');
  const min = sessionValue('repRange.mobility.min');
  const max = sessionValue('repRange.mobility.max');
  const set = (index: number): PlannedSet => ({
    index,
    target: hold ? { kind: 'hold', seconds } : { kind: 'reps', min, max },
    loadKg: null,
    targetRir: rir,
    restSeconds: recoveryValue('mobility.restSeconds'),
    tempo: null,
    reasonCodes: [`session.mobility.${pattern === 'balance' ? 'balance' : 'mobility'}`, hold ? 'session.hold.target' : 'session.rep_range.mobility', 'session.mobility.easy_effort'],
    reasonParams: hold ? { seconds, rir } : { min, max, rir },
  });
  return {
    slot: pattern,
    role: 'primary',
    exerciseId: id,
    ladderId: null,
    supersetGroup: null,
    sets: Array.from({ length: recoveryValue('mobility.sets') }, (_, i) => set(i + 1)),
    reasonCodes: [`session.mobility.${pattern === 'balance' ? 'balance' : 'mobility'}`, 'session.slot.primary'],
  };
}
