import { randomUUID } from 'node:crypto';
import { ModelUnavailableError, type CoachModel, type ModelRequest } from '@fitadapt/coach';
import { heuristicModel, scriptedModel, type ScriptStep } from '@fitadapt/coach/testing';
import { ENGINE_VERSION, createEngineContext, defaultEquipmentLoads, fixedClock, programDay, programSessionContext, type GenerateSessionInput } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, buildCapacityModel, generateProgram, generateSession } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  CoachMessageResponseSchema,
  DataExportSchema,
  EMPTY_BIOMETRICS,
  PROFILE_RECORD_ID,
  SCREENING_QUESTION_IDS,
  StartConversationResponseSchema,
  type AssessmentRecord,
  type AssessmentResult,
  type CoachContext,
  type CoachMessageResponse,
  type EquipmentId,
  type Profile,
  type ProgramInput,
  type ProgramRecord,
  type SafetyProfile,
  type ScreeningRecord,
  type WorkoutSessionRecord,
} from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keyedHash } from '../../src/auth/crypto.js';
import { coachConversations, coachMessages, coachToolCalls, syncChanges } from '../../src/db/schema.js';
import { PEPPER, bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M11 on the server (ADR-024): the coach endpoint proxies the model
 * server-side; conversations need the ai_coach consent and start with the AI
 * disclosure (L5); tool calls run the engine on the server's own records, are
 * audited in the conversation store and the defensibility log, and write
 * records only through the sync validators; a red-flag phrase starts the M05
 * stop flow (S3 events in the sync transaction, sessions refused until a
 * medical review is attested); rate limits per tier and a cache for general
 * answers live in Redis; conversations are exported, erased on withdrawal and
 * purged after the retention period; no text reaches a log.
 */

/** A model the tests switch per case (deterministic: CI has no network and no key). */
const switchable: CoachModel & { inner: CoachModel | null; requests: ModelRequest[] } = {
  inner: null,
  requests: [],
  async complete(request) {
    this.requests.push(request);
    if (!this.inner) throw new ModelUnavailableError('coach.model_not_configured');
    return this.inner.complete(request);
  },
};
let tier: 'free' | 'premium' = 'free';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ coachModel: switchable, coachTierOf: async () => tier });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await truncateAll(h);
  switchable.inner = null;
  switchable.requests = [];
  tier = 'free';
});

const GYM: EquipmentId[] = [...EQUIPMENT_PRESETS.full_gym];
const BIRTH = { year: 1982, month: 5, day: 4 };
const MON = Date.parse('2026-09-28T07:00:00.000Z');

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
const consent = (s: Session, dataType: 'health' | 'ai_coach', decision: 'granted' | 'withdrawn' = 'granted') =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType, decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
async function acceptL2(s: Session) {
  for (const documentId of ['terms', 'privacy', 'exercise_risk']) {
    const d = (await h.app.inject({ method: 'GET', url: `/v1/legal/documents/${documentId}?locale=en&jurisdiction=GB` })).json() as { version: number; contentHash: string };
    const res = await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(s.token), payload: { documentId, version: d.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: d.contentHash } });
    expect(res.statusCode).toBe(201);
  }
}
const chain = (s: Session) => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));

/** A user who onboarded and allowed AI-coach conversations. */
async function ready(options: { aiConsent?: boolean } = {}) {
  const s = await session();
  await consent(s, 'health');
  if (options.aiConsent !== false) await consent(s, 'ai_coach');
  await acceptL2(s);
  const gymId = randomUUID();
  const scr = screening();
  const profile: Profile = { schemaVersion: 1, goals: { primary: 'muscle_gain', secondary: null }, experience: 'intermediate', schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false }, birthDate: BIRTH, biometrics: EMPTY_BIOMETRICS, limitations: [], excludedExerciseIds: [], motivation: null, activeEquipmentProfileId: gymId, onboardingCompletedAt: h.clock.now().toISOString() };
  const assessment: AssessmentRecord = { reason: 'first', result: gymResult, capacity: buildCapacityModel(gymResult), cappedByS1: false };
  const program = programRecord(gymId, scr.safetyProfile);
  expect(await push(s, [insert('screenings', scr), insert('profile', profile, PROFILE_RECORD_ID), insert('equipment_profiles', { location: 'gym', equipment: GYM }, gymId), insert('assessments', assessment), insert('programs', program)])).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
  return { s, gymId, safetyProfile: scr.safetyProfile, program, capacity: assessment.capacity };
}
type Ready = Awaited<ReturnType<typeof ready>>;

function todayInput(r: Ready, over: Partial<GenerateSessionInput> = {}): GenerateSessionInput {
  const day = programDay(r.program.program, [], '2026-09-28')!;
  return { safetyProfile: r.safetyProfile, equipment: GYM, equipmentLoads: defaultEquipmentLoads('gym'), equipmentProfileId: r.gymId, minutesAvailable: 45, capacity: r.capacity, programSession: programSessionContext(day, day.sessions[0]!), history: [], birthDate: BIRTH, experience: 'intermediate', intensityLock: { locked: false, since: null }, ...over };
}
/** The context the device sends (today's input and plan, the program), as M02/M08 build it on the device. */
function context(r: Ready, over: Partial<GenerateSessionInput> = {}, started = false): CoachContext {
  const input = todayInput(r, over);
  const g = generateSession(input, createEngineContext({ clock: fixedClock(MON), seed: 7 }));
  return {
    locale: 'en',
    jurisdiction: 'GB',
    today: { input: input as CoachContext['today'] extends infer T ? (T extends { input: infer I } ? I : never) : never, plan: g.status === 'ok' ? g.plan : null, started, generatedAt: new Date(MON).toISOString(), seed: 7 },
    program: { record: r.program, reflows: [], today: '2026-09-28' },
  };
}

async function start(s: Session, locale: 'en' | 'fr' = 'en') {
  const res = await h.app.inject({ method: 'POST', url: '/v1/coach/conversations', headers: bearer(s.token), payload: { locale, jurisdiction: 'GB' } });
  return res;
}
async function say(s: Session, conversationId: string, text: string, ctx: CoachContext) {
  const res = await h.app.inject({ method: 'POST', url: `/v1/coach/conversations/${conversationId}/messages`, headers: bearer(s.token), payload: { text, context: ctx } });
  return { res, body: res.json() as CoachMessageResponse };
}
const coachEvents = async (s: Session) => (await chain(s)).filter((e) => e.type === 'coach.tool_call').map((e) => e.payload);

describe('M11 coach endpoint (server-side proxy, L5, consent)', () => {
  it('needs the ai_coach consent; every conversation starts with the FR/EN AI disclosure, recorded as shown (goal conditions 1, 7)', async () => {
    const r = await ready({ aiConsent: false });
    expect((await start(r.s)).statusCode).toBe(403);
    await consent(r.s, 'ai_coach');
    for (const locale of ['en', 'fr'] as const) {
      const res = await start(r.s, locale);
      expect(res.statusCode).toBe(201);
      const body = StartConversationResponseSchema.parse(res.json());
      expect(body.disclosure).toMatchObject({ noticeId: 'ai_coach', titleKey: 'legal.notice.aiCoach.v1.title', bodyKey: 'legal.notice.aiCoach.v1.body', labelKey: 'legal.notice.aiCoach.label' });
      const conv = (await h.app.inject({ method: 'GET', url: `/v1/coach/conversations/${body.conversationId}`, headers: bearer(r.s.token) })).json() as { messages: { role: string }[] };
      expect(conv.messages[0]!.role).toBe('disclosure');
    }
    const shown = (await chain(r.s)).filter((e) => e.type === 'notice.shown' && (e.payload as { noticeId: string }).noticeId === 'ai_coach');
    expect(shown.map((e) => (e.payload as { locale: string }).locale)).toEqual(['en', 'fr']);
    // The OpenAPI document lists the coach paths.
    const paths = Object.keys(((await h.app.inject({ method: 'GET', url: '/docs/openapi.json' })).json() as { paths: object }).paths);
    expect(paths).toEqual(expect.arrayContaining(['/v1/coach/conversations', '/v1/coach/conversations/{id}/messages', '/v1/coach/conversations/{id}']));
  });

  it('answers a general question from reviewed content with its reference, through the model proxy (goal conditions 1, 5)', async () => {
    const r = await ready();
    switchable.inner = heuristicModel(context(r));
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { res, body } = await say(r.s, conversationId, 'What does RIR mean?', context(r));
    expect(res.statusCode).toBe(200);
    CoachMessageResponseSchema.parse(body);
    expect(body.reply).toMatchObject({ source: 'model', references: ['kb.rir'] });
    // The model got the M20 legal preamble first, then the coach rules.
    expect(switchable.requests[0]!.systemStable.startsWith('You are an AI fitness assistant inside a general wellness app.')).toBe(true);
    expect(switchable.requests[0]!.systemStable).toContain('The app\'s training engine decides every prescription');
    // Unsupported: scoped refusal, no model call.
    const out = await say(r.s, conversationId, 'Who won the football world cup?', context(r));
    expect(out.body.reply.parts).toEqual([{ kind: 'template', key: 'coach.reply.outOfScope', values: {} }]);
    expect(switchable.requests).toHaveLength(1);
  });

  it('without a configured model the coach still answers, deterministically (the offline FAQ and actions)', async () => {
    const r = await ready();
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'What does RIR mean?', context(r));
    expect(body.reply).toMatchObject({ source: 'deterministic', references: ['kb.rir'] });
    const time = await say(r.s, conversationId, 'I only have 30 minutes', context(r));
    expect(time.body.actions[0]).toMatchObject({ type: 'session_proposal', change: 'time' });
  });
});

describe('M11 red flag in chat → the M05 stop flow (goal condition 4)', () => {
  it('"chest pain" ends the session, logs S3 in the sync transaction, and sessions stay refused until a review is attested — without a model call', async () => {
    const r = await ready();
    switchable.inner = scriptedModel([{ text: 'Keep going, it is probably nothing.' }]);
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const ctx = context(r, {}, true);
    const { res, body } = await say(r.s, conversationId, 'I have chest pain but I want to train through it', ctx);
    expect(res.statusCode).toBe(200);
    expect(switchable.requests).toHaveLength(0);
    expect(body.reply).toMatchObject({ category: 'red_flag', source: 'deterministic', parts: [{ kind: 'template', key: 'coach.reply.redFlag', values: {} }] });
    expect(body.actions[0]).toMatchObject({ type: 'red_flag_stop', symptom: 'chest_pain_pressure', log: { kind: 'red_flag', planId: ctx.today!.plan!.planId } });
    // Stored through the sync validators like a device write, with its S3 events in the same transaction.
    const logs = await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.collection, 'execution_logs')));
    expect(logs.map((l) => (l.data as { kind: string; symptom: string }).symptom)).toEqual(['chest_pain_pressure']);
    const types = (await chain(r.s)).map((e) => [e.type, (e.payload as { reasonCode?: string }).reasonCode ?? (e.payload as { tool?: string }).tool]);
    expect(types).toEqual(expect.arrayContaining([
      ['safety.event', 'safety.s3.chest_pain_pressure'],
      ['safety.event', 'safety.s3.intensity_locked'],
      ['coach.tool_call', 'coach.red_flag.stop'],
    ]));
    expect(await coachEvents(r.s)).toEqual([{ tool: 'reportRedFlag', status: 'applied', reasonCode: 'coach.red_flag.stop', engineVersion: ENGINE_VERSION }]);
    // S3: a new session is refused until the medical review is attested.
    const g = generateSession(todayInput(r), createEngineContext({ clock: fixedClock(MON), seed: 7 }));
    if (g.status !== 'ok') throw new Error('no plan');
    const record: WorkoutSessionRecord = { schemaVersion: 1, input: todayInput(r) as WorkoutSessionRecord['input'], plan: g.plan, safetyEvents: [...g.safetyEvents], startedAt: new Date(MON + 60_000).toISOString(), jurisdiction: 'GB', firstWorkout: true };
    expect(await push(r.s, [insert('workout_sessions', record)])).toEqual(['safety.s3.intensity_locked']);
    // The next message cannot rebuild a session either: the server's stored lock applies even if the device says unlocked.
    switchable.inner = scriptedModel([{ toolCalls: [{ name: 'adjustSessionTime', input: { minutes: 30 } }] }, { text: 'Training is paused.' }]);
    const again = await say(r.s, conversationId, 'Can I just do 30 minutes?', context(r));
    expect(again.body.toolCalls[0]).toMatchObject({ tool: 'adjustSessionTime', status: 'refused', reasonCode: 'session.unavailable.s3_intensity_locked' });
    expect(again.body.actions).toEqual([]);
  });

  it('works in French too', async () => {
    const r = await ready();
    const { conversationId } = (await start(r.s, 'fr')).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'J’ai des palpitations depuis la dernière série', { ...context(r), locale: 'fr' });
    expect(body.actions[0]).toMatchObject({ type: 'red_flag_stop', symptom: 'palpitations' });
  });
});

describe('M11 tools: the engine decides, every call is audited (goal condition 2)', () => {
  it('a time change is the engine\'s plan: audited, logged, and accepted by the server when the device starts it', async () => {
    const r = await ready();
    switchable.inner = scriptedModel([{ toolCalls: [{ name: 'adjustSessionTime', input: { minutes: 30 } }] }, { text: 'Done, the engine rebuilt it.' }]);
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'I only have 30 minutes today', context(r));
    const proposal = body.actions.find((a) => a.type === 'session_proposal');
    if (proposal?.type !== 'session_proposal') throw new Error('no proposal');
    expect(proposal.plan.estimatedMinutes).toBeLessThanOrEqual(30);
    const rows = await h.database.db.select().from(coachToolCalls).where(eq(coachToolCalls.conversationId, conversationId));
    expect(rows.map((t) => [t.tool, t.status, t.reasonCode])).toEqual([['adjustSessionTime', 'proposed', 'coach.time.proposed']]);
    expect(rows[0]!.input).toEqual({ minutes: 30 });
    expect(await coachEvents(r.s)).toEqual([{ tool: 'adjustSessionTime', status: 'proposed', reasonCode: 'coach.time.proposed', engineVersion: ENGINE_VERSION }]);
    // The device starts it as a normal session: the server re-derives it with the engine and stores it.
    const record: WorkoutSessionRecord = { schemaVersion: 1, input: proposal.input, plan: proposal.plan, safetyEvents: [], startedAt: new Date(h.clock.now().getTime() + 1000).toISOString(), jurisdiction: 'GB', firstWorkout: true };
    const expected = generateSession(proposal.input as GenerateSessionInput, createEngineContext({ clock: fixedClock(Date.parse(proposal.plan.generatedAt)), seed: proposal.plan.seed }));
    record.safetyEvents = expected.status === 'ok' ? [...expected.safetyEvents] : [];
    expect(await push(r.s, [insert('workout_sessions', record)])).toEqual(['applied']);
  });

  it('a plan change outside the tools is impossible: an unknown tool is refused and audited as "unknown"; a load in the reply is blocked (S6)', async () => {
    const r = await ready();
    switchable.inner = scriptedModel([{ toolCalls: [{ name: 'setLoad', input: { exerciseIndex: 0, loadKg: 180 } }] }, { text: 'Put 180 kg on the bar.' }]);
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'make my squat heavier', context(r));
    expect(body.toolCalls).toEqual([expect.objectContaining({ tool: 'setLoad', status: 'invalid', reasonCode: 'coach.tool.unknown' })]);
    expect(body.actions).toEqual([]);
    expect(body.reply.source).toBe('guard_fallback');
    expect(await coachEvents(r.s)).toEqual([{ tool: 'unknown', status: 'invalid', reasonCode: 'coach.tool.unknown', engineVersion: ENGINE_VERSION }]);
    expect((await chain(r.s)).some((e) => e.type === 'safety.event' && (e.payload as { invariant: string; reasonCode: string }).invariant === 'S6' && (e.payload as { reasonCode: string }).reasonCode === 'coach.guard.ungrounded_number')).toBe(true);
    // Nothing was written to the user's records.
    expect(await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.collection, 'workout_sessions')))).toEqual([]);
  });

  it('S2: the engine refuses a swap to an exercise that loads a red joint the SERVER knows about, even if the device says green', async () => {
    const r = await ready();
    expect(await push(r.s, [insert('execution_logs', { kind: 'pain', planId: null, joint: 'knee', score: 7, at: new Date(MON - 3_600_000).toISOString(), phase: 'after_session' })])).toEqual(['applied']);
    switchable.inner = scriptedModel([{ toolCalls: [{ name: 'swapExercise', input: { exerciseIndex: 0, reason: 'user', preferredExerciseId: 'barbell_back_squat' } }] }, { text: 'The engine kept that off your knee.' }]);
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'swap the first exercise for back squats', context(r, { jointFlags: {} }));
    expect(body.toolCalls[0]).toMatchObject({ tool: 'swapExercise', status: 'refused', reasonCode: 'coach.swap.joint_red' });
    expect(body.actions).toEqual([]);
  });

  it('logPain goes through the M05 validators (S2 "joint flagged" in the sync transaction) and today is rebuilt by the engine', async () => {
    const r = await ready();
    switchable.inner = heuristicModel(context(r));
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'My knee hurts 7/10, change today', context(r));
    expect(body.toolCalls[0]).toMatchObject({ tool: 'logPain', status: 'applied' });
    expect(body.actions.map((a) => a.type)).toEqual(['record', 'session_proposal']);
    const logs = await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.collection, 'execution_logs')));
    expect(logs.map((l) => l.data)).toEqual([expect.objectContaining({ kind: 'pain', joint: 'knee', score: 7 })]);
    expect((await chain(r.s)).some((e) => e.type === 'safety.event' && (e.payload as { reasonCode: string }).reasonCode === 'safety.s2.joint_red.knee')).toBe(true);
  });

  it('reschedule goes through the M08 reflow validators (program.reflowed in the sync transaction)', async () => {
    const r = await ready();
    switchable.inner = heuristicModel(context(r));
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'I can’t train today', context(r));
    expect(body.toolCalls[0]).toMatchObject({ tool: 'reschedule', status: 'applied' });
    const reflows = await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.collection, 'program_reflows')));
    expect(reflows).toHaveLength(1);
    expect((await chain(r.s)).some((e) => e.type === 'program.reflowed')).toBe(true);
    // Again: today's session is no longer planned today (the engine handled it on the server's stored reflows); nothing is written.
    const again = await say(r.s, conversationId, 'I can’t train today', context(r));
    expect(again.body.toolCalls[0]).toMatchObject({ tool: 'reschedule', status: 'refused', reasonCode: 'coach.reschedule.no_session_today' });
    expect(await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, r.s.userId), eq(syncChanges.collection, 'program_reflows')))).toHaveLength(1);
  });

  it('a refused change is explained, never retried around', async () => {
    const r = await ready();
    switchable.inner = scriptedModel([
      { toolCalls: [{ name: 'swapExercise', input: { exerciseIndex: 0, reason: 'user', preferredExerciseId: 'ring_muscle_up' } }] },
      { toolCalls: [{ name: 'requestDeload', input: {} }] },
      { text: 'The engine did not allow that swap.' },
    ]);
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const { body } = await say(r.s, conversationId, 'swap the first one for muscle-ups', context(r));
    expect(body.toolCalls.map((t) => [t.tool, t.status, t.reasonCode])).toEqual([
      ['swapExercise', 'refused', 'coach.swap.not_offered'],
      ['requestDeload', 'refused', 'coach.tool.retry_after_refusal'],
    ]);
    expect(body.actions).toEqual([]);
  });
});

describe('M11 rate limits per tier and response caching (goal condition 6)', () => {
  it('limits messages per tier in Redis: free stops at its limit, premium goes further; bursts are limited too', async () => {
    const r = await ready();
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const ref = keyedHash(PEPPER, 'coach', r.s.userId);
    await h.redis.set(`${h.redisPrefix}rl:coach-free:${ref}`, 40, 'EX', 3600);
    expect((await say(r.s, conversationId, 'hello', context(r))).res.statusCode).toBe(429);
    tier = 'premium';
    await h.redis.set(`${h.redisPrefix}rl:coach-premium:${ref}`, 40, 'EX', 3600);
    expect((await say(r.s, conversationId, 'hello', context(r))).res.statusCode).toBe(200);
    await h.redis.set(`${h.redisPrefix}rl:coach-premium:${ref}`, 200, 'EX', 3600);
    expect((await say(r.s, conversationId, 'hello', context(r))).res).toMatchObject({ statusCode: 429 });
    expect(JSON.parse((await say(r.s, conversationId, 'hello', context(r))).res.body)).toEqual({ error: { code: 'coach.rate_limited' } });
    // Burst: 10 requests a minute, any tier.
    tier = 'free';
    await h.redis.del(`${h.redisPrefix}rl:coach-free:${ref}`, `${h.redisPrefix}rl:coach-burst:${ref}`);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await say(r.s, conversationId, 'hello', context(r))).res.statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('caches general answers (no second model call) but never a question with personal data or a personal request', async () => {
    const r = await ready();
    switchable.inner = heuristicModel(context(r));
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    const a = await say(r.s, conversationId, 'What does RIR mean?', context(r));
    const b = await say(r.s, conversationId, 'what does RIR mean?', context(r));
    expect([a.body.reply.source, b.body.reply.source]).toEqual(['model', 'cache']);
    expect(switchable.requests).toHaveLength(1);
    const keys = await h.redis.keys(`${h.redisPrefix}coach:cache:*`);
    expect(keys).toHaveLength(1);
    // The key is a keyed hash, and the cached value holds no personal context.
    expect(keys[0]).not.toContain('rir');
    await say(r.s, conversationId, 'What does RIR mean? mail me at a.person@example.test', context(r));
    await say(r.s, conversationId, 'What is RIR? I weigh 82 kg', context(r));
    expect(await h.redis.keys(`${h.redisPrefix}coach:cache:*`)).toHaveLength(1);
  });
});

describe('M11 conversations are health data: exported, erased, purged, never logged', () => {
  it('exports conversations with tool calls; deleting one, withdrawing ai_coach consent and the retention purge erase them', async () => {
    const r = await ready();
    const canary = 'canary-knee-7c1e';
    const first = (await start(r.s)).json() as { conversationId: string };
    await say(r.s, first.conversationId, `My knee hurts 4/10 ${canary}`, context(r));
    const exported = DataExportSchema.parse((await h.app.inject({ method: 'GET', url: '/v1/privacy/export', headers: bearer(r.s.token) })).json());
    expect(exported.coach.conversations).toHaveLength(1);
    expect(exported.coach.conversations[0]!.messages.map((m) => m.role)).toEqual(['disclosure', 'user', 'coach']);
    expect(exported.coach.conversations[0]!.toolCalls.map((t) => t.tool)).toEqual(['logPain']);
    // No message text or tool input reached a log line.
    expect(h.logs.join('\n')).not.toContain(canary);
    expect(h.logs.join('\n')).not.toContain('"score":4');

    // DELETE one conversation.
    expect((await h.app.inject({ method: 'DELETE', url: `/v1/coach/conversations/${first.conversationId}`, headers: bearer(r.s.token) })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'DELETE', url: `/v1/coach/conversations/${first.conversationId}`, headers: bearer(r.s.token) })).statusCode).toBe(404);
    expect(await h.database.db.select().from(coachMessages).where(eq(coachMessages.conversationId, first.conversationId))).toEqual([]);

    // Withdrawal of the ai_coach consent erases all of them, in the withdrawal transaction; the coach then refuses.
    const second = (await start(r.s)).json() as { conversationId: string };
    await say(r.s, second.conversationId, 'hello', context(r));
    expect((await consent(r.s, 'ai_coach', 'withdrawn')).statusCode).toBeLessThan(300);
    expect(await h.database.db.select().from(coachConversations).where(eq(coachConversations.userId, r.s.userId))).toEqual([]);
    expect((await say(r.s, second.conversationId, 'hello', context(r))).res.statusCode).toBe(403);

    // Retention: conversations are purged a set time after their last message.
    await consent(r.s, 'ai_coach');
    const third = (await start(r.s)).json() as { conversationId: string };
    expect(await h.app.services.coach.purgeExpired()).toBe(0);
    h.clock.advance(91 * 86_400);
    expect(await h.app.services.coach.purgeExpired()).toBe(1);
    expect(await h.database.db.select().from(coachConversations).where(eq(coachConversations.id, third.conversationId))).toEqual([]);
  });

  it('account deletion removes every conversation (cascade); messages and tool calls are append-only', async () => {
    const r = await ready();
    const { conversationId } = (await start(r.s)).json() as { conversationId: string };
    await say(r.s, conversationId, 'My shoulder hurts 3/10', context(r));
    await expect(h.database.db.execute(sql`UPDATE coach_messages SET content = '{}'::jsonb WHERE conversation_id = ${conversationId}`)).rejects.toThrow();
    await expect(h.database.db.execute(sql`UPDATE coach_tool_calls SET status = 'applied' WHERE conversation_id = ${conversationId}`)).rejects.toThrow();
    const res = await h.app.inject({ method: 'POST', url: '/v1/privacy/deletion', headers: bearer(r.s.token), payload: { confirm: ACCOUNT_DELETION_CONFIRMATION } });
    expect(res.statusCode).toBeLessThan(300);
    expect(await h.database.db.select().from(coachConversations)).toEqual([]);
    expect(await h.database.db.select().from(coachToolCalls)).toEqual([]);
  });

  it('refuses a conversation that is not the caller\'s', async () => {
    const a = await ready();
    const b = await ready();
    const { conversationId } = (await start(a.s)).json() as { conversationId: string };
    expect((await say(b.s, conversationId, 'hello', context(b))).res.statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/v1/coach/conversations/${conversationId}`, headers: bearer(b.s.token) })).statusCode).toBe(404);
  });
});

export type { ScriptStep };
