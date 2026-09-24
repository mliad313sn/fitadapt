import { intensityLockStatus, jointFlagsFromPain, type PainReport, type SafetyStopEvent } from '@fitadapt/safety';
import { JOINTS, type Joint, type SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FULL_GYM, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY, RECOVERY_LIBRARY } from '../__fixtures__/recovery.js';
import { GYM_ID, GYM_LOADS, HOME_ID, HOME_LOADS, programContext, slot } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import { planSeconds } from '../session/timebox.js';
import type { GenerateSessionInput } from '../session/types.js';
import { redJointsLoaded } from '../substitution.js';
import { deloadStatus } from './deload.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const gym = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: [...FULL_GYM, 'cable_station'],
  equipmentLoads: GYM_LOADS,
  equipmentProfileId: GYM_ID,
  minutesAvailable: 90,
  programSession: programContext(),
  capacity: GYM_CAPACITY,
  experience: 'intermediate',
  ...over,
});
const gen = (input: GenerateSessionInput, seed = 4) => generateSession(input, RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed }));
const ok = (input: GenerateSessionInput): { plan: SessionPlan; safetyEvents: readonly unknown[] } => {
  const r = gen(input);
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r;
};

/** Every exercise, warm-up drill and cool-down drill of a plan (what the person is asked to do). */
function everything(p: SessionPlan): string[] {
  return [...p.exercises.map((e) => e.exerciseId), ...(p.warmUp.content?.mobility.map((d) => d.exerciseId) ?? []), ...(p.warmUp.content?.general.exerciseId ? [p.warmUp.content.general.exerciseId] : []), ...(p.coolDown?.drills.map((d) => d.exerciseId) ?? [])];
}
const loadsJoint = (id: string, joint: Joint) => RECOVERY_LIBRARY.graph.exercises.get(id)!.jointLoad[joint] !== 'low';

describe('S2 from the M05 pain model into the next generateSession (goal condition 2)', () => {
  for (const [label, reports] of [
    ['a score of 6 during the session', [{ joint: 'knee', score: 6, at: at(MON - DAY), phase: 'during', sessionId: A }]],
    ['a next-morning check that has not settled', [{ joint: 'knee', score: 3, at: at(MON - 2 * DAY), phase: 'after_session', sessionId: A }, { joint: 'knee', score: 2, at: at(MON - DAY), phase: 'next_morning', settled: false, sessionId: null }]],
  ] as [string, PainReport[]][]) {
    it(`${label}: every medium/high-load exercise on that joint is substituted, the plan says so, and S2 is logged`, () => {
      const flags = jointFlagsFromPain(reports);
      expect(flags).toEqual({ knee: 'red' });
      const before = ok(gym()).plan;
      const onKnee = before.exercises.filter((e) => loadsJoint(e.exerciseId, 'knee'));
      expect(onKnee.length).toBeGreaterThan(0);
      const { plan, safetyEvents } = ok(gym({ jointFlags: flags }));
      for (const id of everything(plan)) expect(loadsJoint(id, 'knee'), id).toBe(false);
      for (const e of onKnee) {
        const now = plan.exercises.find((x) => x.slot === e.slot && x.role === e.role);
        if (now) {
          expect(now.exerciseId).not.toBe(e.exerciseId);
          expect(now.reasonCodes[0]).toBe('session.exercise.s2_substituted.knee');
        }
      }
      expect(safetyEvents).toContainEqual(expect.objectContaining({ invariant: 'S2', action: 'substituted' }));
    });
  }

  it('an amber joint keeps its exercises but says how to make them kinder (neutral grip / range of motion)', () => {
    const { plan } = ok(gym({ jointFlags: jointFlagsFromPain([{ joint: 'shoulder', score: 4, at: at(MON - DAY), sessionId: A }]) }));
    const onShoulder = plan.exercises.filter((e) => loadsJoint(e.exerciseId, 'shoulder'));
    expect(onShoulder.length).toBeGreaterThan(0);
    for (const e of onShoulder) expect(e.reasonCodes).toContain('session.amber.shoulder');
    for (const e of plan.exercises.filter((x) => !loadsJoint(x.exerciseId, 'shoulder'))) expect(e.reasonCodes).not.toContain('session.amber.shoulder');
  });

  it('adversarial property: from ANY recorded pain history, the next session (training or mobility) never loads a red joint above "low" — exercises, warm-up or cool-down', () => {
    const report = fc.record({
      joint: fc.constantFrom(...JOINTS),
      score: fc.integer({ min: 0, max: 10 }),
      offset: fc.oneof(fc.integer({ min: -20, max: 5 }), fc.constant(Number.NaN)),
      phase: fc.constantFrom('during' as const, 'after_session' as const, 'next_morning' as const, undefined),
      settled: fc.option(fc.boolean(), { nil: undefined }),
      sessionId: fc.constantFrom(A, B, null, undefined),
    });
    const patterns = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'core', 'isolation', 'carry', 'balance'] as const;
    fc.assert(
      fc.property(
        fc.array(report, { maxLength: 12 }),
        fc.array(fc.record({ pattern: fc.constantFrom(...patterns), role: fc.constantFrom('primary' as const, 'secondary' as const, 'accessory' as const), sets: fc.integer({ min: 1, max: 4 }) }), { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        fc.integer({ min: 10, max: 120 }),
        fc.constantFrom('training' as const, 'mobility_balance' as const),
        (raw, slots, atGym, minutes, mode) => {
          const reports: PainReport[] = raw.map((r) => ({ joint: r.joint, score: r.score, at: Number.isNaN(r.offset) ? 'x' : at(MON + r.offset * DAY), phase: r.phase, settled: r.settled, sessionId: r.sessionId }));
          const flags = jointFlagsFromPain(reports);
          const input = gym({
            jointFlags: flags,
            mode,
            minutesAvailable: minutes,
            ...(atGym ? {} : { equipment: ['pull_up_bar', 'resistance_band', 'dumbbell'], equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID, capacity: null }),
            programSession: programContext({ slots: slots.map((s) => slot(s.pattern, s.role, 'general', s.sets)), equipmentProfileId: atGym ? GYM_ID : HOME_ID }),
          });
          const r = gen(input, minutes);
          if (r.status !== 'ok') return;
          const red = JOINTS.filter((j) => flags[j] === 'red');
          for (const id of everything(r.plan)) {
            expect(redJointsLoaded(RECOVERY_LIBRARY.graph.exercises.get(id)!, flags), `${id} on ${red.join()}`).toEqual([]);
          }
          expect(planSeconds(r.plan)).toBeLessThanOrEqual(minutes * 60);
        },
      ),
      { numRuns: 1500 },
    );
  });
});

describe('S3 red-flag stop in the engine', () => {
  const flag: SafetyStopEvent = { kind: 'red_flag', at: at(MON - DAY) };
  it('while locked no session of any kind is generated; after the attestation sessions return, deloaded for a week', () => {
    const locked = intensityLockStatus([flag]);
    for (const mode of ['training', 'mobility_balance'] as const) {
      expect(gen(gym({ intensityLock: locked, mode }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s3_intensity_locked'] });
    }
    const events: SafetyStopEvent[] = [flag, { kind: 'medical_review_attested', at: at(MON - 3_600_000) }];
    const lock = intensityLockStatus(events);
    expect(lock.locked).toBe(false);
    const deload = deloadStatus({ asOfMs: MON, painReports: [], safetyStops: events, history: [], readinessChecks: [] });
    expect(deload).toMatchObject({ trigger: 'red_flag' });
    const p = ok(gym({ intensityLock: lock, deload })).plan;
    expect(p.reasonCodes).toContain('session.deload.triggered.red_flag');
  });

  it('property: any sequence of red flags and attestations that leaves the lock on blocks every session', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ kind: fc.constantFrom('red_flag', 'medical_review_attested'), offset: fc.integer({ min: -10, max: 10 }) }), { minLength: 1, maxLength: 6 }), fc.constantFrom('training' as const, 'mobility_balance' as const), (raw, mode) => {
        const lock = intensityLockStatus(raw.map((e) => ({ kind: e.kind, at: at(MON + e.offset * DAY) })));
        const r = gen(gym({ intensityLock: lock, mode }));
        if (lock.locked) expect(r.status).toBe('unavailable');
      }),
      { numRuns: 1000 },
    );
  });
});

describe('M05 standalone mobility and balance session (P4, 55+)', () => {
  const p4 = (over: Partial<GenerateSessionInput> = {}) =>
    gym({ mode: 'mobility_balance', safetyProfile: profileFrom(['heart_or_blood_pressure'], { clearanceAttested: true, birthYear: 1964 }), experience: 'returning', minutesAvailable: 20, equipment: ['sturdy_chair'], equipmentLoads: null, capacity: null, ...over });

  it('only gentle balance and mobility exercises, easy effort, alternating, within the minutes, with a warm-up', () => {
    const { plan, safetyEvents } = ok(p4());
    expect(plan.kind).toBe('mobility_session');
    expect(plan.program).toBeNull();
    expect(plan.reasonCodes[0]).toBe('session.mobility.standalone');
    expect(safetyEvents).toEqual([]);
    expect(plan.exercises.length).toBeGreaterThan(1);
    expect(plan.exercises[0]!.slot).toBe('balance');
    for (const e of plan.exercises) {
      expect(['balance', 'mobility']).toContain(e.slot);
      const ex = RECOVERY_LIBRARY.graph.exercises.get(e.exerciseId)!;
      for (const j of JOINTS) expect(ex.jointLoad[j]).not.toBe('high');
      for (const s of e.sets) {
        expect(s.loadKg).toBeNull();
        expect(s.targetRir).toBeGreaterThanOrEqual(4);
        expect(s.reasonCodes).toContain('session.mobility.easy_effort');
        if (e.slot === 'balance') expect(s.target.kind).toBe('hold');
      }
    }
    expect(planSeconds(plan)).toBeLessThanOrEqual(20 * 60);
    expect(plan.warmUp.content!.seconds).toBe(300);
  });

  it('rotates the exercises from one mobility session to the next; nothing fits → unavailable with a reason', () => {
    const first = ok(p4({ minutesAvailable: 10 })).plan;
    const history = [{ planId: first.planId, prescribedAt: at(MON - DAY), startedAt: at(MON - DAY), countsForProgression: false, exercises: first.exercises.map((e) => ({ slot: e.slot, role: e.role, exerciseId: e.exerciseId, ladderId: null, target: e.sets[0]!.target, targetRir: 4, prescribedLoadKg: null, performed: [] })) }];
    const second = ok(p4({ minutesAvailable: 10, history })).plan;
    expect(second.exercises[0]!.exerciseId).not.toBe(first.exercises[0]!.exerciseId);
    expect(gen(p4({ minutesAvailable: 5 }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.no_mobility_exercise'] });
  });
});
