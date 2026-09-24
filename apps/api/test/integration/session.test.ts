import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, SESSION_RULES_VERSION, buildSessionHistory, createEngineContext, defaultEquipmentLoads, fixedClock, programDay, programSessionContext, type GenerateSessionInput } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, buildCapacityModel, generateProgram, generateSession } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import {
  EMPTY_BIOMETRICS,
  PROFILE_RECORD_ID,
  SCREENING_QUESTION_IDS,
  type AssessmentRecord,
  type AssessmentResult,
  type EquipmentId,
  type ExecutionLog,
  type Profile,
  type ProgramInput,
  type ProgramRecord,
  type SafetyProfile,
  type ScreeningRecord,
  type SetLog,
  type WorkoutSessionRecord,
} from '@fitadapt/shared';
import { HttpTransport, MemoryLocalStore, SyncClient } from '@fitadapt/sync';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncChanges } from '../../src/db/schema.js';
import { planReasonCodes } from '../../src/profile/session-hooks.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M02 on the server (ADR-016, goal condition 8): a started session is the
 * executed prescription with its inputs. The server re-derives it on the
 * seed (recorded clock and seed), checks its inputs against what it stores
 * (screening, S3 lock, place and loads, assessment, program, date of birth,
 * S5 over every stored session) and the L2 gate, then writes "prescription
 * issued" with the engine and rules versions and every reason code, plus the
 * plan's safety events, IN THE SYNC TRANSACTION (ADR-009, pattern of 3bff4b8).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  // API-5: synced session times must be plausible against the server's clock; the fixtures are dated around one week.
  h.clock.set(MON + 7 * DAY);
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const GYM: EquipmentId[] = [...EQUIPMENT_PRESETS.full_gym];
const BIRTH = { year: 1982, month: 5, day: 4 };
const MON = Date.parse('2026-09-28T07:00:00.000Z');
const DAY = 86_400_000;

function screening(yes: string[] = []): ScreeningRecord {
  const d = h.clock.now();
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  const responses = { answers, clearanceAttested: false, birthDate: BIRTH, answeredOn: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: d.toISOString() };
}

const gymResult: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-24T17:00:00.000Z',
  completedAt: '2026-09-24T17:30:00.000Z',
  tests: [
    { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 100, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 80, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 60, reps: 10, rir: 2, seconds: null },
    { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 70, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 90, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 50, rir: null },
  ],
};
/** S1: a flagged user's tests stop at RIR 3 (M07); the server refuses a closer stop. */
const resultFor = (flagged: boolean): AssessmentResult => (flagged ? { ...gymResult, stopRir: 3, tests: gymResult.tests.map((t) => (t.status === 'done' && t.rir !== null ? { ...t, rir: 3 } : t)) } : gymResult);
const capacity = (flagged = false) => buildCapacityModel(resultFor(flagged));

function programRecord(gymId: string, safetyProfile: SafetyProfile): ProgramRecord {
  const input: ProgramInput = { goals: { primary: 'muscle_gain', secondary: null }, experience: 'intermediate', daysPerWeek: 3, minutesPerSession: 45, trainingDays: null, startDate: '2026-09-28', safetyProfile, locations: [{ equipmentProfileId: gymId, location: 'gym', equipment: GYM }], defaultEquipmentProfileId: gymId, locationByWeekday: {}, previousGoal: null };
  const r = generateProgram(input, createEngineContext({ clock: fixedClock(Date.parse('2026-09-24T08:00:00.000Z')), seed: 42 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join(','));
  return { reason: 'first', input, program: r.program };
}

async function session() {
  const dev = device();
  const auth = await signIn(h, uniqueEmail(), dev);
  return { token: auth.tokens.accessToken, userId: auth.user.id, deviceId: dev.id };
}
type Session = Awaited<ReturnType<typeof session>>;
const insert = (collection: string, data: unknown, recordId: string = randomUUID()) => ({ mutationId: randomUUID(), collection, recordId, op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() });
async function push(s: Session, mutations: ReturnType<typeof insert>[]) {
  const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { results: { status: string; reason?: string }[] }).results.map((r) => (r.status === 'rejected' ? r.reason : r.status));
}
const grantHealth = (s: Session) => h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
async function acceptL2(s: Session) {
  for (const documentId of ['terms', 'privacy', 'exercise_risk']) {
    const d = (await h.app.inject({ method: 'GET', url: `/v1/legal/documents/${documentId}?locale=en&jurisdiction=GB` })).json() as { version: number; contentHash: string };
    const res = await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(s.token), payload: { documentId, version: d.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: d.contentHash } });
    expect(res.statusCode).toBe(201);
  }
}
const chain = (s: Session) => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));

/** A user who onboarded: health consent, L2 texts accepted, screening, profile, a gym, an assessment and a program. */
async function ready(options: { yes?: string[]; l2?: boolean } = {}) {
  const s = await session();
  await grantHealth(s);
  if (options.l2 !== false) await acceptL2(s);
  const gymId = randomUUID();
  const scr = screening(options.yes);
  const profile: Profile = { schemaVersion: 1, goals: { primary: 'muscle_gain', secondary: null }, experience: 'intermediate', schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false }, birthDate: BIRTH, biometrics: EMPTY_BIOMETRICS, limitations: [], excludedExerciseIds: [], motivation: null, activeEquipmentProfileId: gymId, onboardingCompletedAt: h.clock.now().toISOString() };
  const flagged = (options.yes ?? []).length > 0;
  const assessment: AssessmentRecord = { reason: 'first', result: resultFor(flagged), capacity: capacity(flagged), cappedByS1: flagged };
  const program = programRecord(gymId, scr.safetyProfile);
  expect(await push(s, [insert('screenings', scr), insert('profile', profile, PROFILE_RECORD_ID), insert('equipment_profiles', { location: 'gym', equipment: GYM }, gymId), insert('assessments', assessment), insert('programs', program)])).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
  return { s, gymId, safetyProfile: scr.safetyProfile, program: program.program, capacity: assessment.capacity };
}
type Ready = Awaited<ReturnType<typeof ready>>;

function sessionInput(r: Ready, over: Partial<GenerateSessionInput> = {}, date = '2026-09-28'): GenerateSessionInput {
  const day = programDay(r.program, [], date)!;
  return {
    safetyProfile: r.safetyProfile,
    equipment: GYM,
    equipmentLoads: defaultEquipmentLoads('gym'),
    equipmentProfileId: r.gymId,
    minutesAvailable: 45,
    capacity: r.capacity,
    programSession: programSessionContext(day, day.sessions[0]!),
    history: [],
    birthDate: BIRTH,
    experience: 'intermediate',
    intensityLock: { locked: false, since: null },
    ...over,
  };
}

function workout(input: GenerateSessionInput, at = MON, seed = 7, firstWorkout = true): WorkoutSessionRecord {
  const r = generateSession(input, createEngineContext({ clock: fixedClock(at), seed }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join(','));
  return { schemaVersion: 1, input: input as WorkoutSessionRecord['input'], plan: r.plan, safetyEvents: [...r.safetyEvents], startedAt: new Date(at + 60_000).toISOString(), jurisdiction: 'GB', firstWorkout };
}

const setLog = (planId: string, exerciseIndex: number, exerciseId: string, index: number, loadKg: number | null, reps = 10): SetLog => ({ schemaVersion: 1, planId, exerciseIndex, exerciseId, set: { index, status: 'done', reps, seconds: null, loadKg, rir: 2 }, loggedAt: new Date(MON + 120_000).toISOString(), correctionOf: null });

describe('M02 started sessions: re-derived on the server, prescription logged in the sync transaction', () => {
  it('stores a program session and writes "prescription issued" with the engine and rules versions and every reason code', async () => {
    const r = await ready();
    // The first session (from the capacity model alone), the day before the program starts.
    const first = workout(sessionInput(r, { programSession: null }), MON - DAY, 8);
    expect(await push(r.s, [insert('workout_sessions', first)])).toEqual(['applied']);
    // Monday: the program session, with the history the device holds.
    const record = workout(sessionInput(r, { history: buildSessionHistory([first], [], []) }), MON, 7, false);
    expect(await push(r.s, [insert('workout_sessions', record)])).toEqual(['applied']);
    const issued = (await chain(r.s)).filter((e) => e.type === 'prescription.issued');
    expect(issued.map((e) => e.payload)).toEqual([
      { prescriptionId: first.plan.planId, engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION, reasonCodes: planReasonCodes(first) },
      { prescriptionId: record.plan.planId, engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION, reasonCodes: planReasonCodes(record) },
    ]);
    // The first session was started but no set was logged: same loads, "not every set was done last time".
    expect(planReasonCodes(record)).toEqual(expect.arrayContaining(['session.program.from_program', 'session.exercise.from_assessment', 'session.progression.incomplete', 'session.rep_range.hypertrophy_primary']));
    expect(planReasonCodes(first)).toContain('session.first.from_assessment');
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(r.s.userId))).toMatchObject({ ok: true });
  });

  it('S1: a flagged user’s session never asks for more than RPE 7, and its prescription is logged after the program’s S1 caps', async () => {
    const r = await ready({ yes: ['chest_discomfort'] });
    const record = workout(sessionInput(r));
    expect(record.plan.exercises.every((e) => e.sets.every((x) => 10 - x.targetRir <= 7))).toBe(true);
    expect(await push(r.s, [insert('workout_sessions', record)])).toEqual(['applied']);
    const types = (await chain(r.s)).map((e) => [e.type, (e.payload as { reasonCode?: string }).reasonCode ?? null]);
    const issuedAt = types.findIndex(([t]) => t === 'prescription.issued');
    expect(types.slice(0, issuedAt)).toEqual(expect.arrayContaining([['safety.event', 'safety.s1.rpe_above_cap']]));
    // Whatever S1 still had to cap in the session itself is logged right after its prescription.
    expect(types.slice(issuedAt + 1)).toEqual(record.safetyEvents.map((e) => ['safety.event', e.reasonCode]));
  });

  it('refuses a session that is not what the engine derives, or not for what the server stores', async () => {
    const r = await ready({ yes: ['chest_discomfort'] });
    const good = workout(sessionInput(r));
    const heavier = { ...good, plan: { ...good.plan, exercises: good.plan.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((x) => ({ ...x, loadKg: (x.loadKg ?? 0) + 20 })) } : e)) } };
    const oldEngine = { ...good, plan: { ...good.plan, engineVersion: '0.1.0' } };
    const cleared = evaluateScreening({ ...screening().responses });
    const looser = workout(sessionInput(r, { safetyProfile: cleared }));
    const otherPlace = workout(sessionInput(r, { equipment: ['dumbbell'] }));
    const otherLoads = workout(sessionInput(r, { equipmentLoads: { ...defaultEquipmentLoads('gym'), barKg: 10 } }));
    const fakeCapacity = workout(sessionInput(r, { capacity: { ...r.capacity, assessedAt: '2026-09-01T10:00:00.000Z' } }));
    const day = programDay(r.program, [], '2026-09-30')!;
    const wrongDay = workout(sessionInput(r, { programSession: { ...programSessionContext(day, day.sessions[0]!), session: { ...programSessionContext(day, day.sessions[0]!).session, targetRpe: 9 } } }));
    const olderUser = workout(sessionInput(r, { birthDate: { year: 1970, month: 1, day: 1 } }));
    expect(
      await push(r.s, [
        insert('workout_sessions', heavier),
        insert('workout_sessions', oldEngine),
        insert('workout_sessions', looser),
        insert('workout_sessions', otherPlace),
        insert('workout_sessions', otherLoads),
        insert('workout_sessions', fakeCapacity),
        insert('workout_sessions', wrongDay),
        insert('workout_sessions', olderUser),
        insert('workout_sessions', { schemaVersion: 1 }),
      ]),
    ).toEqual(['session.mismatch', 'session.engine_version_unsupported', 'session.safety_profile_mismatch', 'session.equipment_mismatch', 'session.equipment_mismatch', 'session.capacity_mismatch', 'session.program_mismatch', 'session.profile_mismatch', 'session.invalid']);
    expect((await chain(r.s)).some((e) => e.type === 'prescription.issued')).toBe(false);
  });

  it('L2 and consent: no session is stored before the texts are accepted, or without the health consent', async () => {
    const noL2 = await ready({ l2: false });
    expect(await push(noL2.s, [insert('workout_sessions', workout(sessionInput(noL2)))])).toEqual(['legal.acceptance_required']);
    const r = await ready();
    await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(r.s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r))), insert('execution_logs', { kind: 'medical_review_attested', at: new Date(MON).toISOString() })])).toEqual(['privacy.consent_required', 'privacy.consent_required']);
  });

  it('S5 on the server: a device that leaves its history out cannot raise a load more than 10 % over what the server stores', async () => {
    const r = await ready();
    // Monday: the user logs the squat at 50 kg (a load of their own, lighter than prescribed).
    const monday = workout(sessionInput(r));
    const squat = monday.plan.exercises.findIndex((e) => e.slot === 'squat');
    expect(await push(r.s, [insert('workout_sessions', monday), insert('set_logs', setLog(monday.plan.planId, squat, monday.plan.exercises[squat]!.exerciseId, 1, 50))])).toEqual(['applied', 'applied']);
    // Two days later the device "forgets" Monday: the plan starts again from the e1RM, far above 50 × 1.1.
    const forgetful = workout(sessionInput(r, {}, '2026-09-28'), MON + 2 * DAY, 9, false);
    expect(await push(r.s, [insert('workout_sessions', forgetful)])).toEqual(['safety.s5.load_above_ceiling']);
  });

  it('SAF-5 / API-5: a plan dated ahead of the server clock (a device clock moved forward past the S5 window) is refused', async () => {
    const r = await ready();
    const monday = workout(sessionInput(r));
    const squat = monday.plan.exercises.findIndex((e) => e.slot === 'squat');
    expect(await push(r.s, [insert('workout_sessions', monday), insert('set_logs', setLog(monday.plan.planId, squat, monday.plan.exercises[squat]!.exerciseId, 1, 50))])).toEqual(['applied', 'applied']);
    // Eight days after the server's now, Monday's 50 kg is out of the 7-day window: without the bound, no ceiling.
    const ahead = workout(sessionInput(r, {}, '2026-09-28'), h.clock.now().getTime() + 8 * DAY, 9, false);
    expect(await push(r.s, [insert('workout_sessions', ahead)])).toEqual(['session.client_time_out_of_range']);
    // Older than the offline window: refused too.
    const stale = workout(sessionInput(r, {}, '2026-09-28'), h.clock.now().getTime() - 31 * DAY, 9, false);
    expect(await push(r.s, [insert('workout_sessions', stale)])).toEqual(['session.client_time_out_of_range']);
  });

  it('S3: a red flag ends the session and locks intensity (logged in the sync transaction); sessions are refused until a review is attested', async () => {
    const r = await ready();
    const first = workout(sessionInput(r));
    const flag: ExecutionLog = { kind: 'red_flag', planId: first.plan.planId, symptom: 'chest_pain_pressure', at: new Date(MON + 600_000).toISOString() };
    expect(await push(r.s, [insert('workout_sessions', first), insert('execution_logs', flag), insert('execution_logs', { kind: 'ended', planId: first.plan.planId, reason: 'red_flag', at: flag.at })])).toEqual(['applied', 'applied', 'applied']);
    const s3 = (await chain(r.s)).filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S3').map((e) => e.payload);
    expect(s3).toEqual([
      { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_pressure', action: 'session_ended', engineVersion: ENGINE_VERSION },
      { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: ENGINE_VERSION },
    ]);
    const later = workout(sessionInput(r, { intensityLock: { locked: false, since: null } }, '2026-09-30'), MON + 2 * DAY, 10, false);
    expect(await push(r.s, [insert('workout_sessions', later)])).toEqual(['safety.s3.intensity_locked']);
    // A locked input is refused by the engine itself (no plan to record); after the attestation the lock is off.
    expect(generateSession(sessionInput(r, { intensityLock: { locked: true, since: flag.at } }), createEngineContext({ clock: fixedClock(MON), seed: 1 }))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s3_intensity_locked'] });
    expect(await push(r.s, [insert('execution_logs', { kind: 'medical_review_attested', at: new Date(MON + DAY).toISOString() })])).toEqual(['applied']);
    expect((await chain(r.s)).at(-1)).toMatchObject({ type: 'safety.attested', payload: { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: ENGINE_VERSION } });
    // M05: after the review, a week of deload follows the red flag (triggered deload); without it the session is refused.
    const withoutDeload = workout(sessionInput(r, { history: buildSessionHistory([first], [], [flag]) }, '2026-09-30'), MON + 2 * DAY, 11, false);
    expect(await push(r.s, [insert('workout_sessions', withoutDeload)])).toEqual(['session.deload_mismatch']);
    const deload = { trigger: 'red_flag' as const, since: flag.at, until: new Date(MON + DAY + 7 * DAY).toISOString() };
    const afterReview = workout(sessionInput(r, { history: buildSessionHistory([first], [], [flag]), deload }, '2026-09-30'), MON + 2 * DAY, 11, false);
    expect(await push(r.s, [insert('workout_sessions', afterReview)])).toEqual(['applied']);
    expect(await push(r.s, [insert('execution_logs', { kind: 'pain', planId: null, joint: 'knee', score: 12, at: flag.at })])).toEqual(['execution_log.invalid']);
  });

  it('stores a session and its prescription atomically: a failed log write persists neither, the client retries and then both exist (ADR-009)', async () => {
    const r = await ready();
    const fetchIntoApp: typeof fetch = async (url, init) => {
      const res = await h.app.inject({ method: 'POST', url: new URL(String(url)).pathname, headers: { ...(init?.headers as Record<string, string>) }, payload: String(init?.body) });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    };
    const client = new SyncClient({ deviceId: r.s.deviceId, store: new MemoryLocalStore(), transport: new HttpTransport({ baseUrl: 'http://api.test', getAccessToken: () => r.s.token, fetch: fetchIntoApp }), newId: randomUUID });
    const recordId = client.insert('workout_sessions', workout(sessionInput(r)) as unknown as Record<string, unknown>);
    const stored = async () => (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.recordId, recordId)))).length;
    const issued = async () => (await chain(r.s)).filter((e) => e.type === 'prescription.issued');
    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_prescription() RETURNS trigger AS $$ BEGIN IF NEW.type = 'prescription.issued' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_prescription BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_prescription()`);
    try {
      await expect(client.sync()).rejects.toMatchObject({ name: 'HttpError', status: 500 });
      expect(await stored()).toBe(0);
      expect(await issued()).toEqual([]);
      expect(client.pendingCount()).toBe(1);
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_prescription ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_prescription()`);
    }
    expect((await client.sync()).push).toMatchObject({ acked: 1, rejected: 0 });
    expect(await stored()).toBe(1);
    expect(await issued()).toHaveLength(1);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(r.s.userId))).toMatchObject({ ok: true });
  });

  it('erases started sessions and execution logs when the health consent is withdrawn; the pseudonymous log keeps its events', async () => {
    const r = await ready();
    const record = workout(sessionInput(r));
    expect(await push(r.s, [insert('workout_sessions', record), insert('execution_logs', { kind: 'ended', planId: record.plan.planId, reason: 'completed', at: new Date(MON + 3_600_000).toISOString() }), insert('set_logs', setLog(record.plan.planId, 0, record.plan.exercises[0]!.exerciseId, 1, null))])).toEqual(['applied', 'applied', 'applied']);
    await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(r.s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    const left = (await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, r.s.userId))).map((x) => x.collection).sort();
    expect(left).toEqual(['equipment_profiles', 'set_logs']);
    expect((await chain(r.s)).filter((e) => e.type === 'prescription.issued')).toHaveLength(1);
  });
});
