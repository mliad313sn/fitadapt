import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, buildSessionHistory, createEngineContext, fixedClock, type GenerateSessionInput } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, generateSession } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { EMPTY_BIOMETRICS, PROFILE_RECORD_ID, SCREENING_QUESTION_IDS, type Biometrics, type EquipmentId, type ExecutionLog, type Profile, type ScreeningRecord, type WorkoutSessionRecord } from '@fitadapt/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M03 on the server: a cardio session is re-derived like every session
 * (engine 0.4.0, the same gates, the recorded clock and seed), and in
 * addition
 * - HIIT needs ≥ 2 weeks of consistent training in the records the SERVER
 *   stores (a device cannot claim a history it does not have);
 * - the BMI ≥ 35 impact default reads the stored height and weight;
 * - a `cardio_done` log belongs to a stored cardio block and never counts
 *   more moderate or vigorous seconds than the block planned (the weekly
 *   ledger);
 * - "prescription issued" carries the cardio reason codes, in the sync
 *   transaction.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  // API-5: synced session times must be plausible against the server's clock; the fixtures are dated around one week.
  h.clock.set(NOW + 3_600_000);
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const HOME: EquipmentId[] = [...EQUIPMENT_PRESETS.home_basic];
const BIRTH = { year: 1990, month: 5, day: 20 };
const NOW = Date.parse('2026-10-12T07:00:00.000Z');
const DAY = 86_400_000;

function screening(yes: string[] = []): ScreeningRecord {
  const d = h.clock.now();
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  const responses = { answers, clearanceAttested: false, birthDate: BIRTH, answeredOn: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: d.toISOString() };
}

const insert = (collection: string, data: unknown, recordId: string = randomUUID()) => ({ mutationId: randomUUID(), collection, recordId, op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() });

async function ready(biometrics: Biometrics = EMPTY_BIOMETRICS) {
  const dev = device();
  const auth = await signIn(h, uniqueEmail(), dev);
  const s = { token: auth.tokens.accessToken, userId: auth.user.id, deviceId: dev.id };
  await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
  for (const documentId of ['terms', 'privacy', 'exercise_risk']) {
    const d = (await h.app.inject({ method: 'GET', url: `/v1/legal/documents/${documentId}?locale=en&jurisdiction=GB` })).json() as { version: number; contentHash: string };
    await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(s.token), payload: { documentId, version: d.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: d.contentHash } });
  }
  const homeId = randomUUID();
  const scr = screening();
  const profile: Profile = { schemaVersion: 1, goals: { primary: 'fat_loss', secondary: null }, experience: 'intermediate', schedule: { daysPerWeek: 3, minutesPerSession: 30, preferredTimes: [], remindersEnabled: false }, birthDate: BIRTH, biometrics, limitations: [], excludedExerciseIds: [], motivation: null, activeEquipmentProfileId: homeId, onboardingCompletedAt: h.clock.now().toISOString() };
  const push = async (mutations: ReturnType<typeof insert>[]) => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { results: { status: string; reason?: string }[] }).results.map((r) => (r.status === 'rejected' ? r.reason : r.status));
  };
  expect(await push([insert('screenings', scr), insert('profile', profile, PROFILE_RECORD_ID), insert('equipment_profiles', { location: 'home', equipment: HOME }, homeId)])).toEqual(['applied', 'applied', 'applied']);
  const input = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
    safetyProfile: scr.safetyProfile,
    equipment: HOME,
    equipmentLoads: { barKg: null, platePairsKg: [], dumbbellsKg: [10], kettlebellsKg: [], stack: null },
    minutesAvailable: 30,
    history: [],
    birthDate: BIRTH,
    experience: 'intermediate',
    intensityLock: { locked: false, since: null },
    heightCm: biometrics.heightCm,
    bodyweightKg: biometrics.weightKg,
    mode: 'cardio',
    cardio: { protocol: 'steady' },
    ...over,
  });
  const chain = () => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));
  return { s, push, input, chain };
}

function workout(input: GenerateSessionInput, at = NOW, seed = 7, firstWorkout = true): WorkoutSessionRecord {
  const r = generateSession(input, createEngineContext({ clock: fixedClock(at), seed }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join(','));
  return { schemaVersion: 1, input: input as WorkoutSessionRecord['input'], plan: r.plan, safetyEvents: [...r.safetyEvents], startedAt: new Date(at + 60_000).toISOString(), jurisdiction: 'GB', firstWorkout };
}
const done = (record: WorkoutSessionRecord, over: Partial<Extract<ExecutionLog, { kind: 'cardio_done' }>> = {}): ExecutionLog => {
  const c = record.plan.cardio!;
  const work = c.timeline.filter((s) => ['work', 'emom_minute', 'amrap', 'steady'].includes(s.kind)).length;
  return { kind: 'cardio_done', planId: record.plan.planId, protocol: c.protocol, moderateSeconds: c.planned.moderateSeconds, vigorousSeconds: c.planned.vigorousSeconds, completedWork: work, totalWork: work, rounds: null, endedEarly: false, at: new Date(Date.parse(record.startedAt) + c.totalSeconds * 1000).toISOString(), ...over };
};

describe('M03 cardio sessions on the server', () => {
  it('stores a steady cardio session with "prescription issued" (engine version and cardio reason codes), then its cardio log; refuses a log that counts more than the block planned or belongs to no block', async () => {
    const r = await ready();
    const record = workout(r.input());
    expect(record.plan).toMatchObject({ kind: 'cardio_session', engineVersion: ENGINE_VERSION });
    expect(await r.push([insert('workout_sessions', record)])).toEqual(['applied']);
    const issued = (await r.chain()).find((e) => e.type === 'prescription.issued')!;
    expect(issued.payload).toMatchObject({ prescriptionId: record.plan.planId, engineVersion: ENGINE_VERSION });
    expect((issued.payload as { reasonCodes: string[] }).reasonCodes).toEqual(expect.arrayContaining(['cardio.session.standalone', 'cardio.protocol.steady', 'cardio.zones.perceived_exertion']));
    const c = record.plan.cardio!;
    expect(await r.push([insert('execution_logs', done(record, { moderateSeconds: c.planned.moderateSeconds + 60 }))])).toEqual(['execution_log.cardio_mismatch']);
    expect(await r.push([insert('execution_logs', done(record, { vigorousSeconds: 30 }))])).toEqual(['execution_log.cardio_mismatch']);
    expect(await r.push([insert('execution_logs', done(record, { totalWork: 9 }))])).toEqual(['execution_log.cardio_mismatch']);
    expect(await r.push([insert('execution_logs', done(record, { planId: randomUUID() }))])).toEqual(['execution_log.cardio_unknown_block']);
    expect(await r.push([insert('execution_logs', done(record, { protocol: 'tabata' }))])).toEqual(['execution_log.cardio_unknown_block']);
    expect(await r.push([insert('execution_logs', done(record, { moderateSeconds: 600, endedEarly: true, completedWork: 0 }))])).toEqual(['applied']);
    // Other execution logs are unaffected; an invalid one is still refused.
    expect(await r.push([insert('execution_logs', { kind: 'ended', planId: record.plan.planId, reason: 'completed', at: new Date(NOW + 1_800_000).toISOString() })])).toEqual(['applied']);
    expect(await r.push([insert('execution_logs', { kind: 'cardio_done' })])).toEqual(['execution_log.invalid']);
  });

  it('HIIT needs two weeks of consistent training in the records the server stores: a device-side history alone is refused', async () => {
    const r = await ready();
    // Two weeks of steady cardio, run to the end (stored on the server, session then log).
    const earlier: WorkoutSessionRecord[] = [];
    for (const [i, daysAgo] of [15, 13, 11, 9, 6, 4, 2].entries()) {
      const at = NOW - daysAgo * DAY;
      const rec = workout(r.input(), at, i + 1, i === 0);
      earlier.push(rec);
      expect(await r.push([insert('workout_sessions', rec), insert('execution_logs', done(rec))])).toEqual(['applied', 'applied']);
    }
    const logs = earlier.map((rec) => done(rec));
    const history = buildSessionHistory(earlier, [], logs);
    expect(history.every((h) => (h.cardioSeconds ?? 0) > 0)).toBe(true);
    const hiit = workout(r.input({ cardio: { protocol: 'tabata' }, history }), NOW, 99, false);
    expect(hiit.plan.cardio).toMatchObject({ protocol: 'tabata', hiit: true });
    expect(await r.push([insert('workout_sessions', hiit)])).toEqual(['applied']);

    // Another user sends the same history without having trained: refused.
    const other = await ready();
    const claimed = workout(other.input({ cardio: { protocol: 'hiit' }, history }), NOW, 5);
    expect(claimed.plan.cardio!.hiit).toBe(true);
    expect(await other.push([insert('workout_sessions', claimed)])).toEqual(['session.hiit_not_allowed']);
    // Steady cardio is fine for them.
    expect(await other.push([insert('workout_sessions', workout(other.input(), NOW, 6))])).toEqual(['applied']);
  });

  it('the BMI ≥ 35 low-impact default reads the stored height and weight: other numbers are refused', async () => {
    const r = await ready({ heightCm: 178, weightKg: 120, bodyFatPercent: null });
    const honest = workout(r.input({ cardio: { protocol: 'emom' } }));
    expect(honest.plan.cardio).toMatchObject({ impactCeiling: 'low' });
    expect(honest.plan.cardio!.reasonCodes).toContain('cardio.impact.low_default.bmi');
    expect(await r.push([insert('workout_sessions', workout(r.input({ cardio: { protocol: 'emom' }, heightCm: null, bodyweightKg: null }), NOW, 3))])).toEqual(['session.biometrics_mismatch']);
    expect(await r.push([insert('workout_sessions', workout(r.input({ cardio: { protocol: 'emom' }, bodyweightKg: 80 }), NOW, 4))])).toEqual(['session.biometrics_mismatch']);
    expect(await r.push([insert('workout_sessions', honest)])).toEqual(['applied']);
    // Every session, not only cardio: a mobility session with another height is refused too.
    expect(await r.push([insert('workout_sessions', workout(r.input({ mode: 'mobility_balance', cardio: null, heightCm: 150 }), NOW, 8, false))])).toEqual(['session.biometrics_mismatch']);
    expect(await r.push([insert('workout_sessions', workout(r.input({ mode: 'mobility_balance', cardio: null }), NOW, 8, false))])).toEqual(['applied']);
    // An edited plan (another impact ceiling) is refused by the re-derivation.
    const tampered = { ...honest, plan: { ...honest.plan, planId: randomUUID(), cardio: { ...honest.plan.cardio!, impactCeiling: 'high' as const } } };
    expect(await r.push([insert('workout_sessions', tampered)])).toEqual(['session.mismatch']);
  });
});
