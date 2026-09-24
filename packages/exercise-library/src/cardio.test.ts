import {
  CARDIO_CUE_KEYS,
  M03_REASON_CODES,
  createEngineContext,
  cueSchedule,
  fixedClock,
  reasonParamsFor,
  type GenerateSessionInput,
} from '@fitadapt/engine';
import { createTranslator, en, fatBurnClaims, fr, type MessageKey } from '@fitadapt/i18n';
import { impactRank, type CardioProtocol, type SessionHistoryEntry } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { PERSONA_INPUTS } from './__fixtures__/personas.js';
import { SAFE_FACTS, PERSONA_SESSIONS } from './__fixtures__/session-personas.js';
import { EQUIPMENT_PRESETS, generateSession, seedLibrary, STEADY_MODALITIES, VENUE_SWAPS } from './index.js';

/**
 * M03 on the real M06 seed: cardio sessions for the personas (gates, impact
 * defaults, machines per place, venue swaps), and FR/EN for every M03
 * reason code and spoken cue.
 */
const NOW = Date.parse('2026-10-12T07:00:00.000Z');
const DAY = 86_400_000;
const lib = seedLibrary();
const ctx = () => createEngineContext({ clock: fixedClock(NOW), seed: 3 });
const trained: SessionHistoryEntry[] = [15, 12, 10, 8, 5, 3, 1].map((d, i) => {
  const at = new Date(NOW - d * DAY).toISOString();
  return { planId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, prescribedAt: at, startedAt: at, countsForProgression: false, exercises: [], cardioSeconds: 1500 };
});

function cardioFor(persona: keyof typeof PERSONA_SESSIONS, protocol: CardioProtocol, over: Partial<GenerateSessionInput> = {}) {
  const p = PERSONA_SESSIONS[persona];
  const input = PERSONA_INPUTS[persona];
  const place = input.locations[0]!;
  const gen: GenerateSessionInput = {
    ...SAFE_FACTS,
    safetyProfile: input.safetyProfile,
    equipment: place.equipment,
    equipmentProfileId: place.equipmentProfileId,
    minutesAvailable: input.minutesPerSession,
    jointFlags: p.jointFlags,
    bodyweightKg: p.bodyweightKg,
    heightCm: p.heightCm,
    birthDate: p.birthDate,
    experience: p.experience,
    history: trained,
    mode: 'cardio',
    cardio: { protocol },
    ...over,
  };
  return generateSession(gen, ctx());
}

describe('M03 cardio on the seed', () => {
  it('P1 (knees with an amber history, BMI ≈ 38): low-impact only, whatever the protocol', () => {
    for (const protocol of ['hiit', 'tabata', 'emom', 'amrap', 'steady'] as const) {
      const r = cardioFor('P1', protocol);
      if (r.status !== 'ok') {
        // P1's SafetyProfile may not allow HIIT; then the reason says so.
        expect(r.reasonCodes.at(-1)).toMatch(/^cardio\.unavailable\./);
        continue;
      }
      const c = r.plan.cardio!;
      expect(c.impactCeiling).toBe('low');
      for (const m of c.movements) expect(impactRank(lib.byId.get(m.exerciseId)!.impact), m.exerciseId).toBeLessThanOrEqual(impactRank('low'));
      expect(c.reasonCodes).toEqual(expect.arrayContaining(['cardio.impact.low_default.bmi']));
    }
  });

  it('P3 at the gym: steady on a machine, HIIT only after two weeks of logged training; EMOM and AMRAP use bodyweight circuits', () => {
    const steady = cardioFor('P3', 'steady');
    expect(steady.status === 'ok' && lib.byId.get(steady.plan.cardio!.movements[0]!.exerciseId)!.loadType).toBe('machine');
    const hiit = cardioFor('P3', 'hiit');
    expect(hiit.status === 'ok' && hiit.plan.cardio!.hiit).toBe(true);
    expect(cardioFor('P3', 'hiit', { history: [] })).toEqual({ status: 'unavailable', reasonCodes: ['cardio.session.standalone', 'cardio.unavailable.hiit_needs_consistent_training'] });
    for (const protocol of ['emom', 'amrap'] as const) {
      const r = cardioFor('P3', protocol);
      expect(r.status).toBe('ok');
      if (r.status === 'ok') for (const m of r.plan.cardio!.movements) expect(lib.byId.get(m.exerciseId)!.loadType).toBe('bodyweight');
    }
  });

  it('P4 returning after 10 years, no training logged yet: no HIIT; steady cardio with effort and talk-test guidance', () => {
    const hiit = cardioFor('P4', 'hiit', { history: [] });
    expect(hiit.status).toBe('unavailable');
    const steady = cardioFor('P4', 'steady', { history: [] });
    expect(steady.status).toBe('ok');
    if (steady.status === 'ok') expect(steady.plan.cardio!.zones.method).toBe('perceived_exertion');
  });

  it('venue swaps are seed exercises, both ways; the steady modalities exist and need cardio equipment or none', () => {
    for (const [a, list] of Object.entries(VENUE_SWAPS)) {
      expect(lib.byId.has(a), a).toBe(true);
      for (const b of list) {
        expect(lib.byId.has(b), b).toBe(true);
        expect(VENUE_SWAPS[b]).toContain(a);
      }
    }
    expect(VENUE_SWAPS.step_up).toContain('stair_climber_steady');
    expect(VENUE_SWAPS.shadow_boxing).toContain('rowing_machine_steady');
    expect(VENUE_SWAPS.marching_in_place).toContain('stationary_bike_easy');
    for (const id of STEADY_MODALITIES) {
      const ex = lib.byId.get(id)!;
      expect(ex.tags).toContain('conditioning');
      expect(impactRank(ex.impact)).toBeLessThanOrEqual(impactRank('low'));
    }
    // The full gym has the new machines.
    expect(EQUIPMENT_PRESETS.full_gym).toEqual(expect.arrayContaining(['elliptical', 'stair_climber', 'treadmill', 'rowing_machine', 'stationary_bike']));
  });
});

describe('every M03 reason code and spoken cue has an FR and EN text', () => {
  it('renders in both languages, with no fat-burning or lipolysis wording', () => {
    expect(M03_REASON_CODES.length).toBeGreaterThan(40);
    for (const locale of ['en', 'fr'] as const) {
      const catalogue = locale === 'en' ? en : fr;
      const t = createTranslator(locale);
      for (const code of M03_REASON_CODES) {
        const key = `engine.reason.${code}` as MessageKey;
        expect(catalogue[key], `${locale} ${code}`).toBeTruthy();
        const text = t.t(key, Object.fromEntries(reasonParamsFor(code).map((p) => [p, 3])));
        expect(text).not.toMatch(/[{}]/);
        expect(fatBurnClaims(text)).toEqual([]);
      }
      for (const key of CARDIO_CUE_KEYS) expect(catalogue[key as MessageKey], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('every cue of every protocol renders as a sentence in FR and EN (with the exercise name)', () => {
    for (const protocol of ['hiit', 'tabata', 'emom', 'amrap', 'steady'] as const) {
      const r = cardioFor('P3', protocol);
      if (r.status !== 'ok') throw new Error(protocol);
      for (const cue of cueSchedule(r.plan.cardio!)) {
        for (const locale of ['en', 'fr'] as const) {
          const t = createTranslator(locale);
          const exercise = cue.exerciseId ? t.t(`exercise.${cue.exerciseId}.name` as MessageKey) : t.t('cardio.run.anyMovement');
          const text = t.t(cue.speech as MessageKey, { ...cue.params, exercise });
          expect(text.length, `${protocol} ${cue.speech}`).toBeGreaterThan(0);
          expect(text).not.toMatch(/[{}]/);
        }
      }
    }
  });
});
