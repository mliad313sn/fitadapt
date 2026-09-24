import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M09_REASON_CODES, M09_REASON_PARAMS, addDays, createEngineContext, expectedUnits, fixedClock, programDay, programSessionContext, weekdayOf, type GenerateSessionInput } from '@fitadapt/engine';
import { createTranslator, en, fr, type MessageKey } from '@fitadapt/i18n';
import { SharedTimelineSchema, type ScoredSet, type SessionPlan } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { versioned } from './__fixtures__/golden.js';
import { HOME_ID, PERSONA_INPUTS } from './__fixtures__/personas.js';
import { SAFE_FACTS, PERSONA_SESSIONS } from './__fixtures__/session-personas.js';
import { buildCapacityModel, fairScore, generatePairSession, generateProgram, seedLibrary } from './index.js';

/**
 * M09 on the real M06 seed: P1 (Ibrahima, 120 kg) and P2 (Awa, 60 kg) —
 * fictional committee personas — train together at P1's home on the first
 * Wednesday of their programs (Awa's program puts Wednesday at P1's home).
 * The shared timeline is committed as a reviewed golden file
 * (src/__golden__/P1-P2.pair.json, for seat A3): any change to the pair
 * planner or to either persona's session fails here until the file is
 * deliberately updated and the diff reviewed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PROGRAM_NOW = Date.parse('2026-09-24T08:00:00.000Z');
const t = createTranslator('en').t;

function wednesdayInputs(): { a: GenerateSessionInput; b: GenerateSessionInput; at: number } {
  const input = (persona: 'P1' | 'P2', seed: number): { date: string; input: GenerateSessionInput } => {
    const p = PERSONA_SESSIONS[persona];
    const program = generateProgram(PERSONA_INPUTS[persona], createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed }));
    if (program.status !== 'ok') throw new Error(program.reasonCodes.join());
    const date = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(program.program.startDate, d)).find((d) => weekdayOf(d) === 'wed')!;
    const day = programDay(program.program, [], date)!;
    const session = day.sessions[0]!;
    const place = PERSONA_INPUTS[persona].locations.find((l) => l.equipmentProfileId === HOME_ID)!;
    return {
      date,
      input: {
        ...SAFE_FACTS,
        safetyProfile: PERSONA_INPUTS[persona].safetyProfile,
        equipment: place.equipment,
        equipmentLoads: p.loads[HOME_ID]!,
        equipmentProfileId: HOME_ID,
        minutesAvailable: PERSONA_INPUTS[persona].minutesPerSession,
        jointFlags: p.jointFlags,
        capacity: buildCapacityModel(p.assessment),
        programSession: programSessionContext(day, session),
        history: [],
        bodyweightKg: p.bodyweightKg,
        heightCm: p.heightCm,
        birthDate: p.birthDate,
        experience: p.experience,
        intensityLock: { locked: false, since: null },
      },
    };
  };
  const a = input('P1', 1);
  const b = input('P2', 2);
  expect(a.date).toBe(b.date);
  return { a: a.input, b: b.input, at: Date.parse(`${a.date}T17:00:00.000Z`) };
}

function pair() {
  const { a, b, at } = wednesdayInputs();
  const place = { equipment: a.equipment, equipmentLoads: a.equipmentLoads ?? null, equipmentProfileId: HOME_ID };
  const r = generatePairSession(a, b, place, createEngineContext({ clock: fixedClock(at), seed: 9 }));
  if (r.status !== 'ok') throw new Error('expected a pair session');
  return r;
}

const dose = (plan: SessionPlan, i: number) => {
  const e = plan.exercises[i]!;
  const s = e.sets[0]!;
  const target = s.target.kind === 'reps' ? `${s.target.min}–${s.target.max} reps` : `${s.target.seconds} s`;
  return `${e.exerciseId} ${e.sets.length} × ${target} @ ${s.loadKg !== null ? `${s.loadKg} kg` : 'no set load'}, RIR ${s.targetRir}, rest ${s.restSeconds} s`;
};

describe('Fair Pair on the M06 seed: P1 + P2 at P1’s home', () => {
  it('the shared timeline matches the reviewed golden file', async () => {
    const { a, b, timeline } = pair();
    expect(SharedTimelineSchema.parse(timeline)).toEqual(timeline);
    const golden = {
      reasonCodes: timeline.reasonCodes,
      totalMinutes: Math.round(timeline.totalSeconds / 6) / 10,
      p1: `budget ${a.plan.estimatedMinutes} of ${a.plan.minutesAvailable} min, reserve RIR ${a.plan.targetRir}`,
      p2: `budget ${b.plan.estimatedMinutes} of ${b.plan.minutesAvailable} min, reserve RIR ${b.plan.targetRir}`,
      blocks: timeline.blocks.map((k) => ({
        block: `${k.index} ${k.kind}${k.pattern ? ` ${k.pattern}` : ''}${k.conflict ? ` (one ${k.conflict.equipment}: staggered, ${k.conflict.changeoverSeconds} s changeover)` : ''}`,
        ...(k.a !== null ? { p1: dose(a.plan, k.a) } : {}),
        ...(k.b !== null ? { p2: dose(b.plan, k.b) } : {}),
        why: k.reasonCodes.map((c) => t(`engine.reason.${c}` as MessageKey, { seconds: k.conflict?.changeoverSeconds ?? 0 })),
      })),
      turns: timeline.steps.map((s) => `${String(s.startSecond).padStart(4)} s ${s.kind === 'set' ? `${s.participant === 'a' ? 'P1' : 'P2'} ${s.exerciseIndex}.${s.setIndex}` : 'together'} ${s.durationSeconds} s, then rest ${s.restAfterSeconds} s`),
    };
    const file = './__golden__/P1-P2.pair.json';
    expect(existsSync(join(here, file)), `${file} must be committed`).toBe(true);
    await expect(JSON.stringify(versioned('pair', golden), null, 2) + '\n').toMatchFileSnapshot(file);
  });

  it('each plays their own prescription: P1 with his amber knees and one pair of 10 kg dumbbells, P2 at her own level', () => {
    const { a, b, timeline } = pair();
    const lib = seedLibrary();
    // Same pattern per shared block, each person's own variant (the two differ at least once: very different capacities).
    const shared = timeline.blocks.filter((k) => k.kind === 'shared');
    expect(shared.length).toBeGreaterThanOrEqual(3);
    for (const k of shared) expect([a.plan.exercises[k.a!]!.slot, b.plan.exercises[k.b!]!.slot]).toEqual([k.pattern, k.pattern]);
    expect(shared.some((k) => k.exerciseA !== k.exerciseB)).toBe(true);
    // Only the home's equipment for both; every load is the one pair of 10 kg dumbbells or none.
    for (const plan of [a.plan, b.plan]) {
      for (const e of plan.exercises) {
        expect(lib.byId.get(e.exerciseId)!.equipment.every((g) => g.anyOf.some((id) => PERSONA_INPUTS.P1.locations[0]!.equipment.includes(id)))).toBe(true);
        for (const s of e.sets) expect(s.loadKg === null || s.loadKg === 10).toBe(true);
      }
    }
  });

  it('the Fair Challenge Score is relative: both completing their own plans score 100 though their absolute volume differs; the same share scores within 5 %', () => {
    const { a, b } = pair();
    const doShare = (plan: SessionPlan, f: number): ScoredSet[] => {
      const total = plan.exercises.flatMap((e) => e.sets).reduce((x, s) => x + expectedUnits(s), 0);
      let left = Math.round(f * total);
      return plan.exercises.flatMap((e, i) =>
        e.sets.flatMap((s) => {
          const units = Math.min(expectedUnits(s), left);
          left -= units;
          return units === 0 ? [] : [{ exerciseIndex: i, exerciseId: e.exerciseId, loggedAt: plan.generatedAt, set: { index: s.index, status: 'done' as const, reps: s.target.kind === 'reps' ? units : null, seconds: s.target.kind === 'hold' ? units : null, loadKg: s.loadKg, rir: s.targetRir } }];
        }),
      );
    };
    const bwLoad = (plan: SessionPlan, sets: ScoredSet[], kg: number) => sets.reduce((x, s) => x + (s.set.reps ?? 0) * (s.set.loadKg ?? (seedLibrary().byId.get(s.exerciseId)!.bodyweightLoad?.value ?? 0) * kg), 0);
    const full = [fairScore({ participant: 'a', plan: a.plan, sets: doShare(a.plan, 1), events: [] }), fairScore({ participant: 'b', plan: b.plan, sets: doShare(b.plan, 1), events: [] })];
    expect(full.map((s) => s.points)).toEqual([100, 100]);
    const va = bwLoad(a.plan, doShare(a.plan, 1), 120);
    const vb = bwLoad(b.plan, doShare(b.plan, 1), 60);
    expect(Math.abs(va - vb) / Math.max(va, vb)).toBeGreaterThan(0.1);
    for (const f of [0.5, 0.7, 0.9]) {
      const sa = fairScore({ participant: 'a', plan: a.plan, sets: doShare(a.plan, f), events: [] }).points;
      const sb = fairScore({ participant: 'b', plan: b.plan, sets: doShare(b.plan, f), events: [] }).points;
      expect(Math.abs(sa - sb) / Math.max(sa, sb)).toBeLessThanOrEqual(0.05);
    }
  });

  it('every M09 reason code renders in FR and EN with the parameters it carries', () => {
    for (const code of M09_REASON_CODES) {
      const key = `engine.reason.${code}` as MessageKey;
      expect({ code, en: key in en, fr: key in fr }).toEqual({ code, en: true, fr: true });
      const params = Object.fromEntries(M09_REASON_PARAMS[code]!.map((p) => [p, 30]));
      for (const locale of ['en', 'fr'] as const) {
        const text = createTranslator(locale).t(key, params);
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toMatch(/\{|\}/);
      }
    }
  });
});
