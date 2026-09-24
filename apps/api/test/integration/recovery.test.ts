import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, buildSessionHistory, createEngineContext, defaultEquipmentLoads, fixedClock, programDay, programSessionContext, type GenerateSessionInput } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, buildCapacityModel, generateProgram, generateSession, seedLibrary } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { notice, renderNotice } from '@fitadapt/legal';
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
  type ReadinessCheck,
  type SafetyProfile,
  type ScreeningRecord,
  type WorkoutSessionRecord,
} from '@fitadapt/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M05 on the server: readiness checks and pain reports are health data; a
 * pain report that makes a joint red writes an S2 "joint flagged", a red
 * flag (in a session or at a check-in) the S3 events, an attestation
 * `safety.attested` — each IN THE SYNC TRANSACTION (ADR-009). A started
 * session must carry joint flags at least as strict as the stored pain
 * reports (S2), the triggered deload the stored records imply, and the
 * readiness of a low check that day. The seek-care notice is recorded with
 * the jurisdiction's emergency guidance (content hash per jurisdiction).
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

const at = (ms: number) => new Date(ms).toISOString();
const types = async (s: Session) => (await chain(s)).map((e) => [e.type, (e.payload as { invariant?: string; action?: string; reasonCode?: string }).reasonCode ?? null]);

describe('M05 red flags on the server (goal condition 7)', () => {
  it('a red flag at a check-in (no session) writes S3 "session ended" and "intensity locked" in the sync transaction; sessions stay refused until the review is attested, then come back deloaded', async () => {
    const r = await ready();
    const flag: ExecutionLog = { kind: 'red_flag', planId: null, symptom: 'palpitations', at: at(MON - 3_600_000) };
    // Atomic: a failed log write stores neither the red flag nor its events; the retry stores both.
    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_s3() RETURNS trigger AS $$ BEGIN IF NEW.type = 'safety.event' AND NEW.payload->>'invariant' = 'S3' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_s3 BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_s3()`);
    const mutation = insert('execution_logs', flag);
    try {
      const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(r.s.token), payload: { deviceId: r.s.deviceId, mutations: [mutation] } });
      expect(res.statusCode).toBe(500);
      expect((await h.database.db.select().from(syncChanges).where(eq(syncChanges.recordId, mutation.recordId))).length).toBe(0);
      expect((await types(r.s)).some(([t, c]) => t === 'safety.event' && c === 'safety.s3.palpitations')).toBe(false);
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_s3 ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_s3()`);
    }
    expect(await push(r.s, [mutation])).toEqual(['applied']);
    expect((await types(r.s)).slice(-2)).toEqual([
      ['safety.event', 'safety.s3.palpitations'],
      ['safety.event', 'safety.s3.intensity_locked'],
    ]);
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r)))])).toEqual(['safety.s3.intensity_locked']);
    // The M05 attestation (self-attestation of a medical review, with the statement version).
    expect(await push(r.s, [insert('execution_logs', { kind: 'medical_review_attested', at: at(MON - 600_000), statementVersion: 1 })])).toEqual(['applied']);
    expect((await chain(r.s)).at(-1)).toMatchObject({ type: 'safety.attested', payload: { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: ENGINE_VERSION } });
    // Unlocked, but a week of deload follows: a session without it is refused, with it stored.
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r)))])).toEqual(['session.deload_mismatch']);
    const deload = { trigger: 'red_flag' as const, since: flag.at, until: at(MON - 600_000 + 7 * DAY) };
    const deloaded = workout(sessionInput(r, { deload }));
    expect(deloaded.plan.reasonCodes).toContain('session.deload.triggered.red_flag');
    expect(await push(r.s, [insert('workout_sessions', deloaded)])).toEqual(['applied']);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(r.s.userId))).toMatchObject({ ok: true });
  });

  it('the seek-care notice is recorded with the emergency guidance of the user’s jurisdiction: 112 in France, 999 in the UK (two jurisdictions)', async () => {
    const seek = notice('seek_care');
    for (const [jurisdiction, number] of [['FR', '112'], ['GB', '999']] as const) {
      const s = await session();
      const rendered = renderNotice(seek, 'en', jurisdiction);
      expect(rendered.emergency).toBe(`If this is an emergency, call ${number} now.`);
      const other = renderNotice(seek, 'en', jurisdiction === 'FR' ? 'GB' : 'FR');
      const post = (contentHash: string) => h.app.inject({ method: 'POST', url: '/v1/legal/notices', headers: bearer(s.token), payload: { noticeId: 'seek_care', version: seek.version, kind: 'shown', locale: 'en', jurisdiction, contentHash, occurredAt: h.clock.now().toISOString() } });
      // What the person saw is provable: the other market's guidance does not match this jurisdiction.
      expect((await post(other.contentHash)).statusCode).toBe(409);
      expect((await post(rendered.contentHash)).statusCode).toBe(204);
      expect((await chain(s)).at(-1)).toMatchObject({ type: 'notice.shown', payload: { noticeId: 'seek_care', jurisdiction, contentHash: rendered.contentHash } });
    }
  });
});

describe('M05 pain monitoring and S2 on the server (goal condition 2)', () => {
  it('a red pain report writes S2 "joint flagged"; a later session must carry the red joint, and then substitutes it', async () => {
    const r = await ready();
    const first = workout(sessionInput(r));
    const pain: ExecutionLog = { kind: 'pain', planId: first.plan.planId, joint: 'knee', score: 7, at: at(MON + 900_000), phase: 'during' };
    const amber: ExecutionLog = { kind: 'pain', planId: first.plan.planId, joint: 'shoulder', score: 4, at: at(MON + 900_000), phase: 'after_session' };
    expect(await push(r.s, [insert('workout_sessions', first), insert('execution_logs', pain), insert('execution_logs', amber)])).toEqual(['applied', 'applied', 'applied']);
    expect((await chain(r.s)).filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S2' && (e.payload as { action: string }).action === 'joint_flagged').map((e) => e.payload)).toEqual([
      { invariant: 'S2', reasonCode: 'safety.s2.joint_red.knee', action: 'joint_flagged', engineVersion: ENGINE_VERSION },
    ]);
    const history = buildSessionHistory([first], [], [pain, amber]);
    const loose = workout(sessionInput(r, { history, jointFlags: {} }, '2026-09-30'), MON + 2 * DAY, 12, false);
    const onlyAmber = workout(sessionInput(r, { history, jointFlags: { knee: 'amber', shoulder: 'amber' } }, '2026-09-30'), MON + 2 * DAY, 12, false);
    const noShoulder = workout(sessionInput(r, { history, jointFlags: { knee: 'red' } }, '2026-09-30'), MON + 2 * DAY, 12, false);
    expect(await push(r.s, [insert('workout_sessions', loose), insert('workout_sessions', onlyAmber), insert('workout_sessions', noShoulder)])).toEqual(['safety.s2.joint_flags_mismatch', 'safety.s2.joint_flags_mismatch', 'safety.s2.joint_flags_mismatch']);
    const strict = workout(sessionInput(r, { history, jointFlags: { knee: 'red', shoulder: 'amber' } }, '2026-09-30'), MON + 2 * DAY, 12, false);
    // Nothing in it loads the red knee above "low" (S2), exercises and warm-up alike.
    const lib = seedLibrary();
    for (const id of [...strict.plan.exercises.map((e) => e.exerciseId), ...strict.plan.warmUp.content!.mobility.map((d) => d.exerciseId)]) expect(lib.byId.get(id)!.jointLoad.knee, id).toBe('low');
    expect(await push(r.s, [insert('workout_sessions', strict)])).toEqual(['applied']);
    // A next-morning check that has not settled is red too (and a stricter device is always accepted).
    expect(await push(r.s, [insert('execution_logs', { kind: 'pain', planId: null, joint: 'hip', score: 2, at: at(MON + 3 * DAY), phase: 'next_morning', settled: false })])).toEqual(['applied']);
    expect((await chain(r.s)).at(-1)).toMatchObject({ type: 'safety.event', payload: { invariant: 'S2', reasonCode: 'safety.s2.joint_red.hip', action: 'joint_flagged' } });
  });

  it('two amber weeks trigger a deload the session must apply', async () => {
    const r = await ready();
    const reports: ExecutionLog[] = [
      { kind: 'pain', planId: null, joint: 'knee', score: 4, at: at(MON - 9 * DAY), phase: 'after_session' },
      { kind: 'pain', planId: null, joint: 'knee', score: 5, at: at(MON - 1 * DAY), phase: 'after_session' },
    ];
    expect(await push(r.s, reports.map((e) => insert('execution_logs', e)))).toEqual(['applied', 'applied']);
    const flags = { knee: 'amber' as const };
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r, { jointFlags: flags })))])).toEqual(['session.deload_mismatch']);
    const deload = { trigger: 'amber_weeks' as const, since: reports[1]!.at, until: at(MON + 6 * DAY) };
    const record = workout(sessionInput(r, { jointFlags: flags, deload }));
    expect(record.plan.reasonCodes).toEqual(expect.arrayContaining(['session.deload.triggered.amber_weeks', 'session.deload.volume_reduced']));
    expect(await push(r.s, [insert('workout_sessions', record)])).toEqual(['applied']);
  });
});

describe('M05 readiness checks on the server (goal condition 5)', () => {
  const check = (low: boolean, over: Partial<ReadinessCheck> = {}): ReadinessCheck => ({ schemaVersion: 1, date: '2026-09-28', at: at(MON - 600_000), sleep: low ? 1 : 4, soreness: low ? 5 : 2, stress: low ? 4 : 2, energy: low ? 2 : 4, wearable: null, ...over });

  it('stores checks as health data (with or without wearable readings), refuses invalid ones, and a low check makes that day’s session lighter', async () => {
    const r = await ready();
    expect(await push(r.s, [insert('readiness_checks', { ...check(false), sleep: 9 }), insert('readiness_checks', check(false, { wearable: { hrvMs: 55, hrvBaselineMs: 60, restingHr: null, restingHrBaseline: null } })), insert('readiness_checks', check(true))])).toEqual(['readiness_check.invalid', 'applied', 'applied']);
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r)))])).toEqual(['session.readiness_mismatch']);
    const lighter = workout(sessionInput(r, { readiness: 'reduced' }));
    expect(lighter.plan.reasonCodes).toContain('session.readiness.reduced');
    expect(await push(r.s, [insert('workout_sessions', lighter)])).toEqual(['applied']);
    // Withdrawing the health consent erases them; without it none are accepted.
    await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(r.s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    const left = (await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, r.s.userId))).map((x) => x.collection);
    expect(left).not.toContain('readiness_checks');
    expect(await push(r.s, [insert('readiness_checks', check(false))])).toEqual(['privacy.consent_required']);
  });

  it('no check, or a check without wearable data, never blocks a session', async () => {
    const r = await ready();
    expect(await push(r.s, [insert('workout_sessions', workout(sessionInput(r)))])).toEqual(['applied']);
    const r2 = await ready();
    expect(await push(r2.s, [insert('readiness_checks', check(false)), insert('workout_sessions', workout(sessionInput(r2)))])).toEqual(['applied', 'applied']);
  });
});
