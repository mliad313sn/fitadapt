import { CardioPlanSchema, JOINTS, type EquipmentId, SafetyProfileSchema, impactRank, type CardioPlan, type CardioProtocol, type ExecutionLog, type SafetyProfile, type SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARDIO_LIBRARY, trainedHistory } from '../__fixtures__/cardio.js';
import { SAFE_FACTS, profileFrom } from '../__fixtures__/library.js';
import { programContext } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import { buildSessionHistory } from '../session/history.js';
import { record } from '../__fixtures__/simulate.js';
import { planSeconds } from '../session/timebox.js';
import type { GenerateSessionInput, GenerateSessionResult } from '../session/types.js';
import { CARDIO_CONFIG } from './config.js';
import { CARDIO_CUE_KEYS, cueSchedule, segmentAt } from './cues.js';
import { cardioImpactCeiling, consistentTraining, hiitFirstExposure, hiitGate, lowImpactDefault, sessionSafetyProfile } from './gates.js';
import { aerobicMinutesLedger, cardioDone, ledgerEntriesFrom } from './ledger.js';
import { cardioAlternatives } from './movements.js';
import { M03_REASON_CODES } from './reason-codes.js';
import { movementContext } from './session.js';
import { ageOn, estimatedHrMax, heartRateZonesAllowed, karvonenBpm, zonesFor } from './zones.js';

const NOW = Date.parse('2026-10-05T07:30:00.000Z');
const DAY = 86_400_000;
const ctx = (ms = NOW, seed = 7) => createEngineContext({ clock: fixedClock(ms), seed });
const HOME: EquipmentId[] = [];
const GYM: EquipmentId[] = ['stationary_bike', 'rowing_machine', 'treadmill', 'elliptical', 'stair_climber', 'box'];
const cleared = () => profileFrom();
const with_ = (p: SafetyProfile, over: Partial<SafetyProfile>) => SafetyProfileSchema.parse({ ...p, ...over });

const cardioInput = (protocol: CardioProtocol, over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({ ...SAFE_FACTS,
  safetyProfile: cleared(),
  equipment: HOME,
  minutesAvailable: 30,
  mode: 'cardio',
  cardio: { protocol },
  // Past the interval ramp (3 interval sessions completed): the long-term ceilings; the first exposures are tested below.
  history: trainedHistory(NOW, 2, 3, 3),
  birthDate: { year: 1986, month: 3, day: 1 },
  experience: 'intermediate',
  ...over,
});

function ok(r: GenerateSessionResult): { plan: SessionPlan; cardio: CardioPlan } {
  if (r.status !== 'ok') throw new Error(`expected a plan: ${r.reasonCodes.join(', ')}`);
  return { plan: r.plan, cardio: r.plan.cardio! };
}
const run = (input: GenerateSessionInput, at = NOW) => ok(generateSession(input, CARDIO_LIBRARY, ctx(at)));
const kinds = (c: CardioPlan) => c.timeline.map((s) => s.kind);
const main = (c: CardioPlan) => c.timeline.filter((s) => s.kind !== 'warm_up' && s.kind !== 'cool_down');

function expectWellFormed(plan: SessionPlan, cardio: CardioPlan) {
  expect(CardioPlanSchema.safeParse(cardio).success).toBe(true);
  cardio.timeline.forEach((s, i) => {
    expect(s.index).toBe(i);
    expect(s.startSeconds).toBe(i === 0 ? 0 : cardio.timeline[i - 1]!.startSeconds + cardio.timeline[i - 1]!.durationSeconds);
  });
  // The whole session: warm-up + conditioning block = the plan's minutes, second for second.
  const warm = cardio.placement === 'session' ? plan.warmUp.minutes * 60 : 0;
  expect(cardio.totalSeconds).toBe(warm + plan.conditioning!.minutes * 60);
  expect(planSeconds(plan)).toBeLessThanOrEqual(plan.minutesAvailable * 60);
}

describe('packages/engine/cardio generates HIIT, Tabata, EMOM, AMRAP and steady-state sessions (goal condition 1)', () => {
  it('HIIT: warm-up, then 30 s vigorous work / 60 s light recovery rounds, then an easy end; the timeline fills the minutes exactly', () => {
    const { plan, cardio } = run(cardioInput('hiit'));
    expectWellFormed(plan, cardio);
    expect(plan.kind).toBe('cardio_session');
    expect(plan.exercises).toEqual([]);
    expect(cardio).toMatchObject({ protocol: 'hiit', placement: 'session', hiit: true, targetIntensity: 'vigorous', interval: { workSeconds: 30, restSeconds: 60, rounds: 10, blocks: 1 } });
    expect(kinds(cardio)[0]).toBe('warm_up');
    expect(cardio.timeline[0]!.durationSeconds).toBe(300);
    expect(kinds(cardio).at(-1)).toBe('cool_down');
    const work = cardio.timeline.filter((s) => s.kind === 'work');
    expect(work).toHaveLength(10);
    expect(work.every((s) => s.durationSeconds === 30 && s.intensity === 'vigorous')).toBe(true);
    expect(work.map((s) => s.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cardio.timeline.filter((s) => s.kind === 'recover').every((s) => s.durationSeconds === 60 && s.intensity === 'light')).toBe(true);
    expect(cardio.planned).toEqual({ moderateSeconds: 0, vigorousSeconds: 300 });
    expect(cardio.totalSeconds).toBe(30 * 60);
  });

  it('Tabata: blocks of 20 s work / 10 s rest × 8 with a minute between blocks', () => {
    const { plan, cardio } = run(cardioInput('tabata'));
    expectWellFormed(plan, cardio);
    expect(cardio.interval).toEqual({ workSeconds: 20, restSeconds: 10, rounds: 8, blocks: 3, blockRestSeconds: 60 });
    const m = main(cardio);
    const firstBlock = m.slice(0, 16);
    expect(firstBlock.map((s) => [s.kind, s.durationSeconds])).toEqual(Array.from({ length: 8 }, () => [['work', 20], ['recover', 10]]).flat());
    expect(firstBlock.filter((s) => s.kind === 'work').map((s) => s.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(m[16]).toMatchObject({ kind: 'block_rest', durationSeconds: 60, intensity: 'light' });
    expect(cardio.timeline.filter((s) => s.kind === 'work')).toHaveLength(24);
    expect(cardio.timeline.filter((s) => s.kind === 'block_rest')).toHaveLength(2);
    expect(cardio.planned.vigorousSeconds).toBe(24 * 20);
    // A 15-minute session has room for one block only.
    const short = run(cardioInput('tabata', { minutesAvailable: 15 })).cardio;
    expect(short.interval).toMatchObject({ blocks: 1 });
    expect(short.timeline.filter((s) => s.kind === 'work')).toHaveLength(8);
  });

  it('A3/A5 #66: the first interval sessions are capped (HIIT ≤ 6 rounds, Tabata 1 block) until 3 were completed, and say so', () => {
    for (const done of [0, 1, 2]) {
      const hiit = run(cardioInput('hiit', { history: trainedHistory(NOW, 2, 3, done) })).cardio;
      expect(hiit.interval).toMatchObject({ rounds: 6, blocks: 1 });
      expect(hiit.reasonCodes).toContain('cardio.hiit.first_exposure');
      const tabata = run(cardioInput('tabata', { history: trainedHistory(NOW, 2, 3, done) })).cardio;
      expect(tabata.interval).toMatchObject({ blocks: 1 });
      expect(tabata.reasonCodes).toContain('cardio.hiit.first_exposure');
      const custom = run(cardioInput('custom', { history: trainedHistory(NOW, 2, 3, done), cardio: { protocol: 'custom', custom: { workSeconds: 30, restSeconds: 60, rounds: 12, intensity: 'vigorous' } } })).cardio;
      expect(custom.interval!.rounds).toBeLessThanOrEqual(6);
    }
    const ramped = run(cardioInput('hiit')).cardio;
    expect(ramped.interval).toMatchObject({ rounds: 10 });
    expect(ramped.reasonCodes).not.toContain('cardio.hiit.first_exposure');
    // Moderate custom intervals are not interval (HIIT) exposures: no cap.
    const moderate = run(cardioInput('custom', { history: trainedHistory(NOW), cardio: { protocol: 'custom', custom: { workSeconds: 30, restSeconds: 60, rounds: 8, intensity: 'moderate' } } })).cardio;
    expect(moderate.interval!.rounds).toBe(8);
    expect(moderate.reasonCodes).not.toContain('cardio.hiit.first_exposure');
  });

  it('A3/A5 #66: an interval session counts toward the ramp only when run to the end, without a red-flag stop or red pain', () => {
    const input = cardioInput('hiit', { history: trainedHistory(NOW) });
    const { plan, cardio } = run(input);
    const done = (endedEarly: boolean): ExecutionLog => ({ kind: 'cardio_done', planId: plan.planId, protocol: 'hiit', moderateSeconds: 0, vigorousSeconds: cardio.planned.vigorousSeconds, completedWork: 6, totalWork: 6, rounds: null, endedEarly, at: plan.generatedAt });
    const entry = (events: ExecutionLog[]) => buildSessionHistory([record(input, plan)], [], events)[0]!;
    expect(entry([done(false)]).hiitCompleted).toBe(true);
    expect(entry([done(true)]).hiitCompleted).toBeUndefined();
    expect(entry([done(false), { kind: 'red_flag', planId: plan.planId, symptom: 'palpitations', at: plan.generatedAt }]).hiitCompleted).toBeUndefined();
    expect(entry([done(false), { kind: 'pain', planId: plan.planId, joint: 'knee', score: 6, at: plan.generatedAt }]).hiitCompleted).toBeUndefined();
    expect(entry([done(false), { kind: 'pain', planId: plan.planId, joint: 'knee', score: 5, at: plan.generatedAt }]).hiitCompleted).toBe(true);
    const steady = run(cardioInput('steady'));
    expect(buildSessionHistory([record(cardioInput('steady'), steady.plan)], [], [{ ...(done(false) as Extract<ExecutionLog, { kind: 'cardio_done' }>), planId: steady.plan.planId, protocol: 'steady' }])[0]!.hiitCompleted).toBeUndefined();
    expect(hiitFirstExposure(trainedHistory(NOW, 2, 3, 2))).toBe(true);
    expect(hiitFirstExposure(trainedHistory(NOW, 2, 3, 3))).toBe(false);
  });

  it('CS-7: a user who reported a medication affecting effort gets effort and talk-test zones only, never heart-rate targets', () => {
    const heartRate = { source: 'manual' as const, restingBpm: 60 };
    const withHr = zonesFor({ profile: cleared(), birthDate: { year: 1986, month: 3, day: 1 }, heartRate, nowMs: NOW });
    expect(withHr.method).toBe('heart_rate_reserve');
    for (const clearanceAttested of [false, true]) {
      const profile = profileFrom(['medication_affecting_effort'], { clearanceAttested });
      const z = zonesFor({ profile, birthDate: { year: 1986, month: 3, day: 1 }, heartRate, nowMs: NOW });
      expect(z).toMatchObject({ method: 'perceived_exertion', hrMaxBpm: null, restingBpm: null });
      expect(z.zones.every((x) => x.minBpm === null && x.maxBpm === null && x.talkTest !== undefined)).toBe(true);
      expect(z.reasonCodes).toEqual(['cardio.zones.perceived_exertion', 'cardio.zones.medication_effort_only', 'cardio.zones.talk_test']);
    }
  });

  it('integration FIX-A × FIX-B (CS-7): heart-rate targets only when the profile says heartRateZonesAllowed === true; absent or false means effort only', () => {
    const heartRate = { source: 'manual' as const, restingBpm: 60 };
    const facts = (profile: SafetyProfile) => zonesFor({ profile, birthDate: { year: 1986, month: 3, day: 1 }, heartRate, nowMs: NOW });
    const open = cleared();
    expect(open.heartRateZonesAllowed).toBe(true);
    expect(facts(open).method).toBe('heart_rate_reserve');
    const { heartRateZonesAllowed: _drop, ...legacy } = open;
    for (const profile of [{ ...open, heartRateZonesAllowed: false }, legacy as SafetyProfile]) {
      const z = facts(profile);
      expect(z).toMatchObject({ method: 'perceived_exertion', hrMaxBpm: null, restingBpm: null });
      expect(z.reasonCodes).toEqual(['cardio.zones.perceived_exertion', 'cardio.zones.profile_effort_only', 'cardio.zones.talk_test']);
    }
    // The restriction form of the medication answer is honoured even if a profile still claimed zones (stricter wins).
    const restricted = { ...open, reasonCodes: [...open.reasonCodes, 'safety_profile.restriction.medication_affecting_heart_rate'] };
    expect(heartRateZonesAllowed(restricted)).toEqual({ allowed: false, medication: true });
    expect(facts(restricted).reasonCodes).toContain('cardio.zones.medication_effort_only');
    const flagged = { ...open, reasonCodes: [...open.reasonCodes, 'safety_profile.flag.medication_affecting_effort'] };
    expect(facts(flagged).method).toBe('perceived_exertion');
  });

  it('property (CS-7): a heart-rate band is only ever given when heartRateZonesAllowed === true and no medication reason is present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<boolean | undefined>(true, false, undefined),
        fc.subarray(['safety_profile.flag.medication_affecting_effort', 'safety_profile.restriction.medication_affecting_heart_rate', 'safety_profile.cleared']),
        fc.integer({ min: 35, max: 100 }),
        (allowed, extra, restingBpm) => {
          const { heartRateZonesAllowed: _drop, ...base } = cleared();
          const profile = { ...base, ...(allowed === undefined ? {} : { heartRateZonesAllowed: allowed }), reasonCodes: [...base.reasonCodes, ...extra] } as SafetyProfile;
          const z = zonesFor({ profile, birthDate: { year: 1986, month: 3, day: 1 }, heartRate: { source: 'manual', restingBpm }, nowMs: NOW });
          const medication = extra.some((c) => c.includes('medication'));
          if (z.zones.some((x) => x.minBpm !== null || x.maxBpm !== null)) expect(allowed === true && !medication).toBe(true);
        },
      ),
    );
  });

  it('EMOM: a set of reps at the top of every minute, at a moderate (controlled) effort, rotating movements from different patterns', () => {
    const { plan, cardio } = run(cardioInput('emom'));
    expectWellFormed(plan, cardio);
    expect(cardio.hiit).toBe(false);
    const minutes = cardio.timeline.filter((s) => s.kind === 'emom_minute');
    expect(minutes).toHaveLength(20);
    expect(minutes.every((s) => s.durationSeconds === 60 && s.intensity === 'moderate' && s.reps === 8)).toBe(true);
    expect(minutes.map((s) => s.round)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(minutes.map((s) => s.exerciseId)).size).toBe(cardio.movements.length);
    expect(cardio.movements.length).toBeGreaterThanOrEqual(2);
    const patterns = cardio.movements.map((m) => CARDIO_LIBRARY.graph.exercises.get(m.exerciseId)!.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(cardio.planned).toEqual({ moderateSeconds: 1200, vigorousSeconds: 0 });
  });

  it('AMRAP: one moderate block of as many rounds as possible of a short circuit', () => {
    const { plan, cardio } = run(cardioInput('amrap', { minutesAvailable: 20 }));
    expectWellFormed(plan, cardio);
    const block = cardio.timeline.filter((s) => s.kind === 'amrap');
    expect(block).toHaveLength(1);
    expect(block[0]).toMatchObject({ durationSeconds: 12 * 60, intensity: 'moderate', reps: 8, exerciseId: null });
    expect(cardio.interval).toBeNull();
    expect(cardio.movements.length).toBeGreaterThanOrEqual(2);
  });

  it('steady-state: one moderate block on the preferred machine of the place (incline walk, bike, rower, elliptical), or brisk walking without one', () => {
    const gym = run(cardioInput('steady', { equipment: GYM }));
    expectWellFormed(gym.plan, gym.cardio);
    expect(kinds(gym.cardio)).toEqual(['warm_up', 'steady', 'cool_down']);
    expect(gym.cardio.movements.map((m) => m.exerciseId)).toEqual(['stationary_bike_easy']);
    expect(gym.cardio.timeline[1]).toMatchObject({ intensity: 'moderate', exerciseId: 'stationary_bike_easy', durationSeconds: 30 * 60 - 300 - 180 });
    // The easy steps stay on the machine.
    expect(gym.cardio.timeline[0]!.exerciseId).toBe('stationary_bike_easy');
    for (const [id, eq] of [['rowing_machine_steady', 'rowing_machine'], ['elliptical_steady', 'elliptical'], ['treadmill_incline_walk', 'treadmill']] as const) {
      expect(run(cardioInput('steady', { equipment: [eq], cardio: { protocol: 'steady', exerciseId: id } })).cardio.movements[0]!.exerciseId).toBe(id);
    }
    const outdoor = run(cardioInput('steady', { equipment: [] }));
    expect(outdoor.cardio.movements[0]!.exerciseId).toBe('brisk_walk');
    expect(outdoor.cardio.planned).toEqual({ moderateSeconds: 30 * 60 - 480, vigorousSeconds: 0 });
  });

  it('custom work/rest: the requested structure, rounds cut to fit, vigorous only when asked (then gated as HIIT)', () => {
    const moderate = run(cardioInput('custom', { cardio: { protocol: 'custom', custom: { workSeconds: 45, restSeconds: 15, rounds: 12, intensity: 'moderate' } } }));
    expectWellFormed(moderate.plan, moderate.cardio);
    expect(moderate.cardio).toMatchObject({ hiit: false, interval: { workSeconds: 45, restSeconds: 15, rounds: 12 } });
    expect(moderate.cardio.timeline.filter((s) => s.kind === 'work').every((s) => s.intensity === 'moderate')).toBe(true);
    const long = run(cardioInput('custom', { minutesAvailable: 15, cardio: { protocol: 'custom', custom: { workSeconds: 120, restSeconds: 60, rounds: 30, intensity: 'vigorous' } } }));
    expect(long.cardio).toMatchObject({ hiit: true, interval: { rounds: 2 } });
    const gated = generateSession(cardioInput('custom', { history: [], cardio: { protocol: 'custom', custom: { workSeconds: 30, restSeconds: 30, rounds: 5, intensity: 'vigorous' } } }), CARDIO_LIBRARY, ctx());
    expect(gated).toEqual({ status: 'unavailable', reasonCodes: ['cardio.session.standalone', 'cardio.unavailable.hiit_needs_consistent_training'] });
  });

  it('a program finisher (M08) becomes a cardio block after the strength work, with no second warm-up; the M02 time-boxing is kept', () => {
    const input: GenerateSessionInput = { ...SAFE_FACTS,
      safetyProfile: cleared(),
      equipment: ['dumbbell', 'pull_up_bar', 'resistance_band', 'stationary_bike'],
      minutesAvailable: 45,
      programSession: programContext({ conditioning: { kind: 'steady', placement: 'finisher', minutes: 10 } }),
      experience: 'beginner',
    };
    const { plan, cardio } = run(input);
    expectWellFormed(plan, cardio);
    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(cardio.placement).toBe('finisher');
    expect(kinds(cardio)).toEqual(['steady', 'cool_down']);
    expect(cardio.totalSeconds).toBe(plan.conditioning!.minutes * 60);
    expect(plan.reasonCodes).toContain('session.conditioning.steady_finisher');
    // Intervals from the program with ≥ 2 weeks of logged training: a HIIT finisher on the bike.
    const hiit = run({ ...input, history: trainedHistory(NOW), programSession: programContext({ conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } }) });
    expect(hiit.cardio).toMatchObject({ protocol: 'hiit', hiit: true, placement: 'finisher' });
    expect(hiit.cardio.movements.map((m) => m.exerciseId)).toEqual(['stationary_bike_easy']);
  });
});

describe('zones (goal condition 3)', () => {
  it('HRmax = 208 − 0.7 × age (Tanaka), rounded to a whole beat', () => {
    expect(estimatedHrMax(40)).toBe(180);
    expect(estimatedHrMax(20)).toBe(194);
    expect(estimatedHrMax(62)).toBe(165); // 164.6
    expect(estimatedHrMax(38)).toBe(181); // 181.4
    for (let age = 16; age <= 90; age++) expect(estimatedHrMax(age)).toBe(Math.round(208 - 0.7 * age));
    expect(CARDIO_CONFIG['hrMax.intercept']).toMatchObject({ value: 208, validated: false });
    expect(CARDIO_CONFIG['hrMax.agePerYear']).toMatchObject({ value: 0.7, validated: false });
    expect(ageOn({ year: 1986, month: 10, day: 6 }, NOW)).toBe(39);
    expect(ageOn({ year: 1986, month: 10, day: 5 }, NOW)).toBe(40);
  });

  it('Karvonen zones from the resting heart rate: resting + fraction × (HRmax − resting)', () => {
    expect(karvonenBpm(60, 180, 0.4)).toBe(108);
    expect(karvonenBpm(60, 180, 0.59)).toBe(131); // 130.8
    expect(karvonenBpm(70, 160, 0.6)).toBe(124);
    // Age 40 on 2026-10-05, resting 60 → HRmax 180, reserve 120.
    const z = zonesFor({ profile: cleared(), birthDate: { year: 1986, month: 10, day: 5 }, heartRate: { source: 'manual', restingBpm: 60 }, nowMs: NOW });
    expect(z).toMatchObject({ method: 'heart_rate_reserve', hrMaxBpm: 180, restingBpm: 60 });
    expect(z.zones.map((x) => [x.intensity, x.minBpm, x.maxBpm])).toEqual([
      ['light', 96, 107], // 60 + 0.30×120, 60 + 0.39×120 = 106.8
      ['moderate', 108, 131],
      ['vigorous', 132, 161], // 60 + 0.60×120, 60 + 0.84×120 = 160.8
    ]);
    expect(z.reasonCodes).toEqual(['cardio.zones.heart_rate_reserve', 'cardio.zones.hr_max_estimated', 'cardio.zones.talk_test']);
    // A wearable resting heart rate works the same way (the M12 port feeds it).
    expect(zonesFor({ profile: cleared(), birthDate: { year: 1986, month: 10, day: 5 }, heartRate: { source: 'wearable', restingBpm: 60 }, nowMs: NOW }).zones).toEqual(z.zones);
    // In the plan: the heart-rate zones travel with the cardio block.
    const { cardio } = run(cardioInput('steady', { birthDate: { year: 1986, month: 10, day: 5 }, heartRate: { source: 'manual', restingBpm: 60 } }));
    expect(cardio.zones).toEqual(z);
  });

  it('without heart-rate data (no resting HR, no age, or a too-small reserve): perceived exertion and the talk test only', () => {
    const cases = [
      [{ heartRate: null, birthDate: { year: 1986, month: 1, day: 1 } }, 'cardio.zones.no_resting_hr'],
      [{ heartRate: { source: 'none', restingBpm: 60 }, birthDate: { year: 1986, month: 1, day: 1 } }, 'cardio.zones.no_resting_hr'],
      [{ heartRate: { source: 'manual', restingBpm: 60 }, birthDate: null }, 'cardio.zones.no_age'],
      [{ heartRate: { source: 'manual', restingBpm: 120 }, birthDate: { year: 1940, month: 1, day: 1 } }, 'cardio.zones.reserve_too_small'],
    ] as const;
    for (const [facts, code] of cases) {
      const z = zonesFor({ profile: cleared(), nowMs: NOW, ...facts });
      expect(z.method).toBe('perceived_exertion');
      expect(z.hrMaxBpm).toBeNull();
      expect(z.zones.every((x) => x.minBpm === null && x.maxBpm === null)).toBe(true);
      expect(z.zones.map((x) => [x.intensity, x.rpeMin, x.rpeMax, x.talkTest])).toEqual([
        ['light', 2, 3, 'full_conversation'],
        ['moderate', 4, 6, 'short_sentences'],
        ['vigorous', 7, 8, 'few_words'],
      ]);
      expect(z.reasonCodes).toEqual(['cardio.zones.perceived_exertion', code, 'cardio.zones.talk_test']);
    }
  });

  it('S1: the perceived-exertion ranges never exceed the SafetyProfile maxRPE', () => {
    const z = zonesFor({ profile: with_(cleared(), { maxRPE: 6 }), nowMs: NOW });
    expect(z.zones.map((x) => [x.rpeMin, x.rpeMax])).toEqual([[2, 3], [4, 6], [6, 6]]);
  });
});

describe('gating (goal condition 4)', () => {
  it('allowHIIT=false or an unresolved screening flag (S1) → no HIIT or Tabata', () => {
    for (const profile of [with_(cleared(), { allowHIIT: false }), profileFrom(['heart_or_blood_pressure'])]) {
      for (const protocol of ['hiit', 'tabata'] as const) {
        expect(generateSession(cardioInput(protocol, { safetyProfile: profile }), CARDIO_LIBRARY, ctx())).toEqual({ status: 'unavailable', reasonCodes: ['cardio.session.standalone', 'cardio.unavailable.hiit_s1'] });
      }
      // Steady work stays available.
      expect(run(cardioInput('steady', { safetyProfile: profile })).cardio.hiit).toBe(false);
    }
    expect(hiitGate(with_(cleared(), { allowHIIT: false }), trainedHistory(NOW), NOW, 8)).toBe('safety.s1.hiit_not_allowed');
  });

  it('< 2 weeks of logged training → no HIIT; two consistent weeks → HIIT', () => {
    const noHiit = { status: 'unavailable', reasonCodes: ['cardio.session.standalone', 'cardio.unavailable.hiit_needs_consistent_training'] };
    expect(generateSession(cardioInput('hiit', { history: [] }), CARDIO_LIBRARY, ctx())).toEqual(noHiit);
    // 13 days of logs, 3 a week: not yet two weeks.
    const thirteen = trainedHistory(NOW, 2, 3).slice(1);
    expect(consistentTraining(thirteen, NOW)).toBe(false);
    expect(generateSession(cardioInput('tabata', { history: thirteen }), CARDIO_LIBRARY, ctx())).toEqual(noHiit);
    // Two weeks, but a week with a single session: not consistent.
    const gap = trainedHistory(NOW, 2, 2).filter((_, i) => i !== 4);
    expect(consistentTraining(gap, NOW)).toBe(false);
    // Sessions started but with nothing logged do not count.
    const empty = trainedHistory(NOW).map(({ cardioSeconds: _c, ...h }) => h);
    expect(consistentTraining(empty, NOW)).toBe(false);
    // Records dated after the clock never count (time travel cannot open the gate).
    const future = trainedHistory(NOW + 30 * DAY);
    expect(consistentTraining(future, NOW)).toBe(false);
    expect(consistentTraining(trainedHistory(NOW, 2, 2), NOW)).toBe(true);
    expect(run(cardioInput('hiit', { history: trainedHistory(NOW, 2, 2) })).cardio.hiit).toBe(true);
    // A done set counts as logged training too.
    const sets = trainedHistory(NOW).map(({ cardioSeconds: _c, ...h }) => ({ ...h, exercises: [{ slot: 'squat' as const, role: 'primary' as const, exerciseId: 'air_squat', ladderId: null, target: { kind: 'reps' as const, min: 8, max: 12 }, targetRir: 3, prescribedLoadKg: null, performed: [{ index: 1, status: 'done' as const, reps: 10, seconds: null, loadKg: null, rir: 3 }] }] }));
    expect(consistentTraining(sets, NOW)).toBe(true);
  });

  it('a knee, ankle or hip flag (M01 limitation or M05 amber/red) or BMI ≥ 35 → only low-impact movements by default', () => {
    const lowOnly = (input: GenerateSessionInput) => {
      for (const protocol of ['hiit', 'tabata', 'emom', 'amrap', 'steady'] as const) {
        const { cardio } = run({ ...input, cardio: { protocol } });
        expect(cardio.impactCeiling, protocol).toBe('low');
        for (const m of cardio.movements) expect(impactRank(m.impact), `${protocol} ${m.exerciseId}`).toBeLessThanOrEqual(impactRank('low'));
        for (const s of cardio.timeline) if (s.exerciseId) expect(impactRank(CARDIO_LIBRARY.graph.exercises.get(s.exerciseId)!.impact)).toBeLessThanOrEqual(impactRank('low'));
      }
    };
    const base = cardioInput('hiit');
    // Without any flag, HIIT uses high-impact moves at home.
    expect(run(base).cardio.movements.some((m) => m.impact === 'high')).toBe(true);
    for (const joint of ['knee', 'ankle', 'hip'] as const) {
      lowOnly({ ...base, safetyProfile: with_(cleared(), { limitedJoints: [joint] }) });
      lowOnly({ ...base, jointFlags: { [joint]: 'amber' } });
      expect(cardioImpactCeiling({ profile: with_(cleared(), { limitedJoints: [joint] }) }).reasonCodes).toContain(`cardio.impact.low_default.limited.${joint}`);
    }
    // BMI ≥ 35: 120 kg at 178 cm is 37.9 (P1); 110 kg at 178 cm is 34.7.
    lowOnly({ ...base, bodyweightKg: 120, heightCm: 178 });
    expect(cardioImpactCeiling({ profile: cleared(), bodyweightKg: 120, heightCm: 178 })).toEqual({ ceiling: 'low', reasonCodes: ['cardio.impact.low_default.bmi'] });
    expect(cardioImpactCeiling({ profile: cleared(), bodyweightKg: 110, heightCm: 178 }).ceiling).toBe('high');
    expect(lowImpactDefault({ profile: cleared(), bodyweightKg: 120, heightCm: 178 })).toBe(true);
    // A shoulder flag does not change the impact default.
    expect(run({ ...base, safetyProfile: with_(cleared(), { limitedJoints: ['shoulder'] }) }).cardio.impactCeiling).toBe('high');
  });

  it('opting up lifts the default, never above the SafetyProfile ceiling, and never with a red knee, ankle or hip (S2)', () => {
    const base = cardioInput('hiit', { bodyweightKg: 120, heightCm: 178, impactOptIn: true });
    const up = run(base).cardio;
    expect(up.impactCeiling).toBe('high');
    expect(up.reasonCodes).toContain('cardio.impact.opted_up');
    expect(run({ ...base, safetyProfile: with_(cleared(), { impactCeiling: 'moderate' }) }).cardio.impactCeiling).toBe('moderate');
    const red = run({ ...base, jointFlags: { knee: 'red' } }).cardio;
    expect(red.impactCeiling).toBe('low');
    expect(red.reasonCodes).toContain('cardio.impact.red_joint.knee');
    // S2: nothing that loads the red knee at medium or high.
    for (const m of red.movements) expect(CARDIO_LIBRARY.graph.exercises.get(m.exerciseId)!.jointLoad.knee).toBe('low');
    const r = generateSession({ ...base, jointFlags: { knee: 'red' } }, CARDIO_LIBRARY, ctx());
    expect(r.status === 'ok' && r.safetyEvents).toEqual([{ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'blocked', engineVersion: expect.any(String) }]);
  });

  it('property: no cardio plan ever breaks S1, the HIIT gate, the impact ceiling, S2 or the minutes', () => {
    const protocols = ['hiit', 'tabata', 'emom', 'amrap', 'steady', 'custom'] as const;
    fc.assert(
      fc.property(
        fc.record({
          protocol: fc.constantFrom(...protocols),
          minutes: fc.integer({ min: 5, max: 120 }),
          weeks: fc.integer({ min: 0, max: 3 }),
          perWeek: fc.integer({ min: 0, max: 4 }),
          flags: fc.subarray(['heart_or_blood_pressure', 'bone_joint_back'] as const),
          allowHIIT: fc.boolean(),
          ceiling: fc.constantFrom('low', 'moderate', 'high' as const),
          limited: fc.subarray([...JOINTS]),
          red: fc.subarray([...JOINTS]),
          optIn: fc.boolean(),
          weight: fc.integer({ min: 45, max: 180 }),
          equipment: fc.subarray(GYM),
          custom: fc.record({ workSeconds: fc.integer({ min: 10, max: 300 }), restSeconds: fc.integer({ min: 0, max: 300 }), rounds: fc.integer({ min: 1, max: 30 }), intensity: fc.constantFrom('moderate', 'vigorous' as const) }),
          clockJump: fc.integer({ min: -60, max: 60 }),
        }),
        (a) => {
          const profile = with_(profileFrom([...a.flags]), { limitedJoints: a.limited, ...(a.allowHIIT ? {} : { allowHIIT: false }), impactCeiling: a.ceiling });
          const history = a.weeks > 0 && a.perWeek > 0 ? trainedHistory(NOW + a.clockJump * DAY, a.weeks, a.perWeek) : [];
          const input = cardioInput(a.protocol, {
            safetyProfile: profile,
            minutesAvailable: a.minutes,
            history,
            jointFlags: Object.fromEntries(a.red.map((j) => [j, 'red'])),
            impactOptIn: a.optIn,
            bodyweightKg: a.weight,
            heightCm: 170,
            equipment: a.equipment,
            cardio: { protocol: a.protocol, ...(a.protocol === 'custom' ? { custom: a.custom } : {}) },
          });
          const r = generateSession(input, CARDIO_LIBRARY, ctx());
          if (r.status !== 'ok') return;
          const c = r.plan.cardio!;
          expectWellFormed(r.plan, c);
          if (c.hiit) {
            expect(profile.allowHIIT && profile.unresolvedFlags.length === 0).toBe(true);
            expect(consistentTraining(history, NOW)).toBe(true);
          }
          const maxRpe = profile.unresolvedFlags.length > 0 ? Math.min(profile.maxRPE, 7) : profile.maxRPE;
          for (const z of c.zones.zones) expect(z.rpeMax).toBeLessThanOrEqual(maxRpe);
          expect(impactRank(c.impactCeiling)).toBeLessThanOrEqual(impactRank(profile.impactCeiling));
          if (a.red.some((j) => ['knee', 'ankle', 'hip'].includes(j))) expect(c.impactCeiling === 'low' || c.impactCeiling === 'none').toBe(true);
          for (const s of c.timeline) {
            if (!s.exerciseId) continue;
            const ex = CARDIO_LIBRARY.graph.exercises.get(s.exerciseId)!;
            expect(impactRank(ex.impact)).toBeLessThanOrEqual(impactRank(c.impactCeiling));
            for (const j of a.red) expect(ex.jointLoad[j]).toBe('low');
          }
        },
      ),
      { numRuns: 1500 },
    );
  });
});

describe('weekly aerobic-minutes ledger (goal condition 5)', () => {
  const log = (planId: string, at: string, moderateSeconds: number, vigorousSeconds: number): ExecutionLog => ({ kind: 'cardio_done', planId, protocol: 'steady', moderateSeconds, vigorousSeconds, completedWork: 1, totalWork: 1, rounds: null, endedEarly: false, at });
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const dateOf = (iso: string) => iso.slice(0, 10) as `${number}-${number}-${number}`;

  it('counts vigorous minutes double and shows the week against 150–300 minutes', () => {
    const logs = [log(id(1), '2026-10-05T07:00:00.000Z', 30 * 60, 0), log(id(2), '2026-10-07T07:00:00.000Z', 0, 20 * 60), log(id(3), '2026-10-09T07:00:00.000Z', 45 * 60, 5 * 60)];
    const ledger = aerobicMinutesLedger(ledgerEntriesFrom(logs, dateOf), '2026-10-05');
    expect(ledger).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11', moderateMinutes: 75, vigorousMinutes: 25, equivalentMinutes: 125, targetMin: 150, targetMax: 300, status: 'below', sessions: 3 });
    expect(ledger.reasonCodes).toEqual(['cardio.ledger.below', 'cardio.ledger.vigorous_double', 'cardio.ledger.who_range']);
    // 75 vigorous minutes alone reach the 150 (WHO: 75–150 min vigorous).
    expect(aerobicMinutesLedger([{ date: '2026-10-06', moderateSeconds: 0, vigorousSeconds: 75 * 60 }], '2026-10-05')).toMatchObject({ equivalentMinutes: 150, status: 'within' });
    expect(aerobicMinutesLedger([{ date: '2026-10-06', moderateSeconds: 301 * 60, vigorousSeconds: 0 }], '2026-10-05').status).toBe('above');
    // Other weeks and repeated logs of the same block are not counted.
    const noisy = [...logs, log(id(1), '2026-10-05T07:10:00.000Z', 30 * 60, 0), log(id(4), '2026-10-12T07:00:00.000Z', 60 * 60, 0), log(id(5), '2026-10-04T07:00:00.000Z', 60 * 60, 0)];
    expect(aerobicMinutesLedger(ledgerEntriesFrom(noisy, dateOf), '2026-10-05')).toMatchObject({ equivalentMinutes: 125, sessions: 3 });
    expect(CARDIO_CONFIG['who.weeklyModerateMin']).toMatchObject({ value: 150, validated: false });
    expect(CARDIO_CONFIG['who.weeklyModerateMax']).toMatchObject({ value: 300, validated: false });
    expect(CARDIO_CONFIG['who.vigorousFactor']).toMatchObject({ value: 2, validated: false });
  });

  it('a block counts only the time actually spent in each moderate or vigorous step, never more than planned', () => {
    const { cardio } = run(cardioInput('hiit'));
    const work = cardio.timeline.filter((s) => s.kind === 'work');
    const done = cardioDone(cardio, [...cardio.timeline.map((s) => ({ index: s.index, seconds: s.durationSeconds + 50 }))]);
    expect(done).toEqual({ moderateSeconds: 0, vigorousSeconds: 300, completedWork: 10, totalWork: 10 });
    const half = cardioDone(cardio, [{ index: work[0]!.index, seconds: 30 }, { index: work[1]!.index, seconds: 12.7 }, { index: 0, seconds: 300 }]);
    expect(half).toEqual({ moderateSeconds: 0, vigorousSeconds: 42, completedWork: 1, totalWork: 10 });
  });
});

describe('eyes-free cues (Marco: audio and haptics lead)', () => {
  it('announces every step with a haptic, counts down 3-2-1 before hard steps and the end, and says "done" at the end', () => {
    const { cardio } = run(cardioInput('tabata', { minutesAvailable: 15 }));
    const cues = cueSchedule(cardio);
    const steps = cues.filter((c) => c.kind === 'step');
    expect(steps).toHaveLength(cardio.timeline.length);
    for (const s of cardio.timeline) expect(steps.some((c) => c.segmentIndex === s.index && c.atSeconds === s.startSeconds)).toBe(true);
    const work = steps.filter((c) => c.haptic === 'work');
    expect(work).toHaveLength(8);
    expect(work.at(-1)).toMatchObject({ speech: 'cardio.cue.workLast', params: { round: 8, rounds: 8 } });
    expect(work[0]).toMatchObject({ speech: 'cardio.cue.work', params: { round: 1, rounds: 8, seconds: 20 } });
    // The warm-up ends with 3-2-1 before the first work step.
    const firstWork = cardio.timeline.find((s) => s.kind === 'work')!;
    expect(cues.filter((c) => c.kind === 'countdown' && c.atSeconds >= firstWork.startSeconds - 3 && c.atSeconds < firstWork.startSeconds).map((c) => c.params.count)).toEqual([3, 2, 1]);
    // The 10-second rests are long enough for a countdown.
    expect(cues.filter((c) => c.kind === 'countdown').length).toBeGreaterThanOrEqual(3 * 8);
    expect(cues.at(-1)).toMatchObject({ kind: 'finish', atSeconds: cardio.totalSeconds, haptic: 'finish', speech: 'cardio.cue.finish' });
    // In time order, every key is a known i18n key.
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.atSeconds).toBeGreaterThanOrEqual(cues[i - 1]!.atSeconds);
    for (const c of cues) expect(CARDIO_CUE_KEYS).toContain(c.speech);
  });

  it('long steady and AMRAP steps get "halfway" and "one minute left"', () => {
    const steady = run(cardioInput('steady', { minutesAvailable: 40 })).cardio;
    const cues = cueSchedule(steady);
    const block = steady.timeline.find((s) => s.kind === 'steady')!;
    expect(cues.find((c) => c.kind === 'halfway')!.atSeconds).toBe(block.startSeconds + Math.floor(block.durationSeconds / 2));
    expect(cues.find((c) => c.kind === 'minute_left')!.atSeconds).toBe(block.startSeconds + block.durationSeconds - 60);
    const amrap = cueSchedule(run(cardioInput('amrap')).cardio);
    expect(amrap.some((c) => c.kind === 'halfway')).toBe(true);
    const emom = cueSchedule(run(cardioInput('emom')).cardio);
    expect(emom.filter((c) => c.speech === 'cardio.cue.emom' || c.speech === 'cardio.cue.emomLast')).toHaveLength(20);
  });

  it('segmentAt tells the running step and the seconds left in it', () => {
    const { cardio } = run(cardioInput('hiit'));
    expect(segmentAt(cardio, 0)).toMatchObject({ segment: { kind: 'warm_up' }, remainingSeconds: 300 });
    expect(segmentAt(cardio, 310)).toMatchObject({ segment: { kind: 'work', round: 1 }, remainingSeconds: 20 });
    expect(segmentAt(cardio, -5)).toMatchObject({ segment: { index: 0 } });
    expect(segmentAt(cardio, cardio.totalSeconds)).toBeNull();
  });
});

describe('venue swaps and alternatives', () => {
  it('step-ups ↔ stair climber, shadow boxing ↔ rower, marching ↔ bike: a requested movement the place lacks is swapped', () => {
    const rower = run(cardioInput('steady', { equipment: ['rowing_machine'], cardio: { protocol: 'steady', exerciseId: 'shadow_boxing' } })).cardio;
    expect(rower.movements[0]).toMatchObject({ exerciseId: 'shadow_boxing' });
    const atGym = run(cardioInput('steady', { equipment: ['stationary_bike'], cardio: { protocol: 'steady', exerciseId: 'rowing_machine_steady' } })).cardio;
    // No rower here: its swap (shadow boxing) is used.
    expect(atGym.movements[0]).toMatchObject({ exerciseId: 'shadow_boxing', reasonCodes: ['cardio.movement.venue_swap'] });
    const home = run(cardioInput('steady', { equipment: [], cardio: { protocol: 'steady', exerciseId: 'stationary_bike_easy' } })).cardio;
    expect(home.movements[0]).toMatchObject({ exerciseId: 'marching_in_place', reasonCodes: ['cardio.movement.venue_swap'] });
    const m = movementContext(cardioInput('steady', { equipment: ['stair_climber'] }), CARDIO_LIBRARY);
    expect(cardioAlternatives(m, 'steady', 'step_up', [])[0]).toBe('stair_climber_steady');
    expect(cardioAlternatives(m, 'steady', 'stair_climber_steady', ['brisk_walk'])).not.toContain('brisk_walk');
  });
});

describe('every M03 reason code is a unique dotted code', () => {
  it('has no parameters and no fat-burning wording', () => {
    expect(new Set(M03_REASON_CODES).size).toBe(M03_REASON_CODES.length);
    expect(M03_REASON_CODES.length).toBeGreaterThan(40);
    for (const c of M03_REASON_CODES) expect(c).toMatch(/^cardio\.[a-z0-9_.]+$/);
    expect(M03_REASON_CODES.join(' ')).not.toMatch(/fat|lipoly/i);
  });
});

describe('readiness (M05) and cardio', () => {
  it('a "less ready" day refuses high-intensity intervals and keeps the rest at a moderate effort', () => {
    expect(generateSession(cardioInput('tabata', { readiness: 'reduced' }), CARDIO_LIBRARY, ctx())).toEqual({ status: 'unavailable', reasonCodes: ['cardio.session.standalone', 'cardio.unavailable.readiness_reduced'] });
    const { plan, cardio } = run(cardioInput('steady', { readiness: 'reduced' }));
    expect(plan.reasonCodes).toContain('cardio.readiness.reduced');
    expect(cardio.hiit).toBe(false);
  });
});

describe('the impact default applies to the whole session, not only its cardio block', () => {
  it('sessionSafetyProfile lowers the impact ceiling for a knee/ankle/hip flag or BMI ≥ 35 (unless opted up), never raises it, and keeps every other field', () => {
    const p = cleared();
    expect(sessionSafetyProfile({ safetyProfile: p })).toBe(p);
    const heavy = sessionSafetyProfile({ safetyProfile: p, bodyweightKg: 120, heightCm: 178 });
    expect(heavy).toEqual({ ...p, impactCeiling: 'low' });
    expect(sessionSafetyProfile({ safetyProfile: p, bodyweightKg: 120, heightCm: 178, impactOptIn: true })).toBe(p);
    expect(sessionSafetyProfile({ safetyProfile: p, jointFlags: { ankle: 'red' }, impactOptIn: true }).impactCeiling).toBe('low');
    const none = with_(p, { impactCeiling: 'none' });
    expect(sessionSafetyProfile({ safetyProfile: none, bodyweightKg: 120, heightCm: 178 }).impactCeiling).toBe('none');
  });

  it('a program session for a BMI ≥ 35 user uses only low-impact exercises in every slot, and so does its finisher', () => {
    const input: GenerateSessionInput = { ...SAFE_FACTS,
      safetyProfile: cleared(),
      equipment: [],
      minutesAvailable: 45,
      bodyweightKg: 120,
      heightCm: 178,
      history: trainedHistory(NOW),
      programSession: programContext({ slots: [{ pattern: 'squat', role: 'primary', intent: 'general', hardSets: 3 }, { pattern: 'locomotion', role: 'secondary', intent: 'general', hardSets: 2 }], conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } }),
      experience: 'intermediate',
    };
    const { plan, cardio } = run(input);
    for (const e of plan.exercises) expect(impactRank(CARDIO_LIBRARY.graph.exercises.get(e.exerciseId)!.impact), e.exerciseId).toBeLessThanOrEqual(impactRank('low'));
    for (const m of cardio.movements) expect(impactRank(m.impact)).toBeLessThanOrEqual(impactRank('low'));
    // Without the BMI default, the same day may use high-impact moves (the fictional library has jumps).
    const free = run({ ...input, bodyweightKg: null, heightCm: null });
    expect([...free.plan.exercises.map((e) => CARDIO_LIBRARY.graph.exercises.get(e.exerciseId)!.impact), ...free.cardio.movements.map((m) => m.impact)]).toContain('high');
  });
});
