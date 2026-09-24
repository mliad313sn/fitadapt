import {
  M05_REASON_CODES,
  addDays,
  createEngineContext,
  dayPatterns,
  fixedClock,
  planSeconds,
  programDay,
  programSessionContext,
  reasonParamsFor,
  type GenerateSessionInput,
} from '@fitadapt/engine';
import { createTranslator, en, fr } from '@fitadapt/i18n';
import { JOINTS, type SessionPlan } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { PERSONA_INPUTS } from './__fixtures__/personas.js';
import { PERSONA_SESSIONS } from './__fixtures__/session-personas.js';
import { buildCapacityModel, generateProgram, generateSession, seedLibrary, WARM_UP_DRILLS } from './index.js';

/**
 * M05 on the real M06 seed: the warm-up of every persona session (5–8 min,
 * mobility for the day's patterns from the seed's drill lists, ramp-up
 * before the first heavy lift), M08's scheduled deload weeks (−40–50 %
 * volume), the P4 mobility and balance session, and FR/EN for every M05
 * reason code.
 */
const PROGRAM_NOW = Date.parse('2026-09-24T08:00:00.000Z');
const personas = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
const lib = seedLibrary();

function firstWeeks(persona: (typeof personas)[number], weeks = 2): { input: GenerateSessionInput; plan: SessionPlan }[] {
  const input = PERSONA_INPUTS[persona];
  const p = PERSONA_SESSIONS[persona];
  const r = generateProgram(input, createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed: 1 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  const out: { input: GenerateSessionInput; plan: SessionPlan }[] = [];
  for (let d = 0; d < weeks * 7; d++) {
    const date = addDays(r.program.startDate, d);
    const day = programDay(r.program, [], date);
    for (const session of day?.sessions ?? []) {
      const place = input.locations.find((l) => l.equipmentProfileId === session.equipmentProfileId)!;
      const gen: GenerateSessionInput = { safetyProfile: input.safetyProfile, equipment: place.equipment, equipmentLoads: p.loads[place.equipmentProfileId]!, equipmentProfileId: place.equipmentProfileId, minutesAvailable: input.minutesPerSession, jointFlags: p.jointFlags, capacity: buildCapacityModel(p.assessment), programSession: programSessionContext(day!, session), bodyweightKg: p.bodyweightKg, birthDate: p.birthDate, experience: p.experience };
      const res = generateSession(gen, createEngineContext({ clock: fixedClock(Date.parse(`${date}T07:00:00.000Z`)), seed: d }));
      if (res.status === 'ok') out.push({ input: gen, plan: res.plan });
    }
  }
  return out;
}

describe('M05 warm-ups on the seed for every persona (goal condition 1)', () => {
  it('5–8 minutes, 2–3 min general, mobility from the seed lists for the day’s patterns, ramp-up before the first heavy lift', () => {
    let ramps = 0;
    for (const persona of personas) {
      for (const { input, plan } of firstWeeks(persona)) {
        const w = plan.warmUp.content!;
        expect(plan.warmUp.minutes).toBeGreaterThanOrEqual(5);
        expect(plan.warmUp.minutes).toBeLessThanOrEqual(8);
        expect(w.seconds).toBe(plan.warmUp.minutes * 60);
        expect(w.general.seconds).toBeGreaterThanOrEqual(120);
        expect(w.general.seconds).toBeLessThanOrEqual(180 + w.mobility.length);
        expect(w.mobility.length).toBeGreaterThan(0);
        const patterns = dayPatterns(plan.exercises);
        for (const d of w.mobility) {
          for (const p of d.forPatterns) {
            expect(patterns, `${persona} ${d.exerciseId}`).toContain(p);
            expect(WARM_UP_DRILLS[p]).toContain(d.exerciseId);
          }
          const ex = lib.byId.get(d.exerciseId)!;
          expect(ex.contraindications.filter((c) => input.safetyProfile.avoidTags.includes(c))).toEqual([]);
          for (const j of JOINTS) {
            expect(ex.jointLoad[j]).not.toBe('high');
            if (input.jointFlags?.[j]) expect(ex.jointLoad[j], `${persona} ${d.exerciseId} ${j}`).toBe('low');
          }
        }
        // The primary patterns of the day are prepared whenever the seed has an allowed drill for them.
        const covered = new Set(w.mobility.flatMap((d) => d.forPatterns));
        const primary = [...new Set(plan.exercises.filter((e) => e.role === 'primary').map((e) => e.slot))];
        const coverable = primary.filter((p) => WARM_UP_DRILLS[p].some((id) => w.mobility.some((d) => d.exerciseId === id) || (!plan.exercises.some((e) => e.exerciseId === id) && JOINTS.every((j) => lib.byId.get(id)!.jointLoad[j] === 'low' || (lib.byId.get(id)!.jointLoad[j] === 'medium' && !input.jointFlags?.[j])) && lib.byId.get(id)!.equipment.every((g) => g.anyOf.some((e) => input.equipment.includes(e))) && !lib.byId.get(id)!.contraindications.some((c) => input.safetyProfile.avoidTags.includes(c)))));
        if (plan.warmUp.minutes === 8) for (const p of coverable) expect(covered, `${persona} ${plan.program?.sessionId} ${p}`).toContain(p);
        const first = plan.exercises.findIndex((e) => (e.sets[0]!.loadKg ?? 0) > 0);
        if (first >= 0) {
          ramps += 1;
          expect(w.rampUp!.exerciseIndex).toBe(first);
          expect(w.rampUp!.sets.every((s, i, a) => s.loadKg < w.rampUp!.workingLoadKg && (i === 0 || s.loadKg > a[i - 1]!.loadKg))).toBe(true);
        } else expect(w.rampUp).toBeNull();
        expect(planSeconds(plan)).toBeLessThanOrEqual(plan.minutesAvailable * 60);
      }
    }
    expect(ramps).toBeGreaterThan(10); // P3 and P5 lift loads in every session
  });

  it('every drill in the seed lists exists in the seed and is gentle (no high joint load)', () => {
    for (const ids of Object.values(WARM_UP_DRILLS)) {
      for (const id of ids) {
        const ex = lib.byId.get(id);
        expect(ex, id).toBeDefined();
        for (const j of JOINTS) expect(ex!.jointLoad[j], `${id} ${j}`).not.toBe('high');
      }
    }
  });
});

describe('M05 scheduled deloads (M08 deload weeks) on the seed: volume −40–50 % (goal condition 3)', () => {
  it('each persona’s deload week has 40–50 % fewer hard sets than the accumulation week before it', () => {
    for (const persona of personas) {
      const r = generateProgram(PERSONA_INPUTS[persona], createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed: 1 }));
      if (r.status !== 'ok') throw new Error(persona);
      const weeks = r.program.microcycles;
      for (let i = 1; i < weeks.length; i++) {
        if (weeks[i]!.kind !== 'deload' || weeks[i - 1]!.kind !== 'accumulation') continue;
        const count = (w: (typeof weeks)[number]) => w.sessions.reduce((s, x) => s + x.slots.reduce((a, b) => a + b.hardSets, 0), 0);
        const reduction = 1 - count(weeks[i]!) / count(weeks[i - 1]!);
        expect(reduction, `${persona} week ${weeks[i]!.week}`).toBeGreaterThanOrEqual(0.4);
        expect(reduction, `${persona} week ${weeks[i]!.week}`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe('M05 mobility and balance session for P4 on the seed', () => {
  it('Mariam (62, controlled hypertension cleared with restrictions) gets a gentle 20–30 min balance and mobility session at home', () => {
    const input = PERSONA_INPUTS.P4;
    const place = input.locations[0]!;
    for (const minutes of [15, 20, 30]) {
      const r = generateSession({ safetyProfile: input.safetyProfile, equipment: place.equipment, equipmentProfileId: place.equipmentProfileId, minutesAvailable: minutes, mode: 'mobility_balance', experience: 'returning', birthDate: PERSONA_SESSIONS.P4.birthDate }, createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed: 4 }));
      if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
      expect(r.plan.kind).toBe('mobility_session');
      expect(planSeconds(r.plan)).toBeLessThanOrEqual(minutes * 60);
      expect(r.plan.exercises.length).toBeGreaterThanOrEqual(2);
      for (const e of r.plan.exercises) {
        const ex = lib.byId.get(e.exerciseId)!;
        expect(['balance', 'mobility']).toContain(ex.pattern);
        expect(ex.contraindications.filter((c) => input.safetyProfile.avoidTags.includes(c))).toEqual([]);
        expect(10 - e.sets[0]!.targetRir).toBeLessThanOrEqual(input.safetyProfile.maxRPE);
      }
    }
  });
});

describe('every M05 reason code has an FR and EN explanation', () => {
  it('renders in both languages with its parameters', () => {
    expect(M05_REASON_CODES.length).toBeGreaterThan(25);
    for (const locale of ['en', 'fr'] as const) {
      const catalogue = locale === 'en' ? en : fr;
      for (const code of M05_REASON_CODES) {
        const key = `engine.reason.${code}` as keyof typeof en;
        expect(catalogue[key], `${locale} ${code}`).toBeTruthy();
        const text = createTranslator(locale).t(key, Object.fromEntries(reasonParamsFor(code).map((p) => [p, 3])));
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });
});
