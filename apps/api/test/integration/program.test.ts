import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, addDays, createEngineContext, fixedClock, reflowRecord } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, generateProgram } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type EquipmentId, type Program, type ProgramInput, type ProgramRecord, type ScreeningRecord } from '@fitadapt/shared';
import { HttpTransport, MemoryLocalStore, SyncClient } from '@fitadapt/sync';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M08 on the server: programs and reflows sync as append-only health
 * collections. The server re-derives the program from its inputs on the
 * seed library, for the SafetyProfile of the latest stored screening and the
 * stored equipment profiles; a reflow must be what the engine decides for the
 * stored program. "Program generated" (engine version) and "reflowed" events,
 * and the program's S1 caps, are written in the sync transaction (ADR-009).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const GYM_EQUIPMENT: EquipmentId[] = [...EQUIPMENT_PRESETS.full_gym];
function screening(yes: string[] = []): ScreeningRecord {
  const d = h.clock.now();
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  const responses = { answers, clearanceAttested: false, birthDate: { year: 1982, month: 5, day: 4 }, answeredOn: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: d.toISOString() };
}

function programRecord(gymId: string, options: { yes?: string[]; goal?: ProgramInput['goals']['primary']; days?: number; equipment?: EquipmentId[] } = {}): ProgramRecord {
  const input: ProgramInput = {
    goals: { primary: options.goal ?? 'muscle_gain', secondary: null },
    experience: 'intermediate',
    daysPerWeek: options.days ?? 3,
    minutesPerSession: 45,
    trainingDays: null,
    startDate: '2026-09-28',
    safetyProfile: screening(options.yes).safetyProfile,
    locations: [{ equipmentProfileId: gymId, location: 'gym', equipment: options.equipment ?? GYM_EQUIPMENT }],
    defaultEquipmentProfileId: gymId,
    locationByWeekday: {},
    previousGoal: null,
  };
  const r = generateProgram(input, createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 42 }));
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
const chain = (s: Session) => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));

/** A signed-in user with health consent, a stored screening and a stored gym equipment profile. */
async function ready(yes: string[] = []) {
  const s = await session();
  await grantHealth(s);
  const gymId = randomUUID();
  expect(await push(s, [insert('screenings', screening(yes)), insert('equipment_profiles', { location: 'gym', equipment: GYM_EQUIPMENT }, gymId)])).toEqual(['applied', 'applied']);
  return { s, gymId };
}

describe('M08 program sync with server-side re-derivation', () => {
  it('stores a program and writes "program generated" with the engine and rules versions in the same transaction', async () => {
    const { s, gymId } = await ready();
    const record = programRecord(gymId);
    expect(await push(s, [insert('programs', record)])).toEqual(['applied']);
    const events = (await chain(s)).filter((e) => e.type === 'program.generated');
    expect(events.map((e) => e.payload)).toEqual([{ programId: record.program.programId, engineVersion: ENGINE_VERSION, rulesVersion: record.program.rulesVersion, templateId: 'muscle_gain.3d', reasonCodes: record.program.reasonCodes }]);
    expect((await chain(s)).filter((e) => e.type === 'safety.event' && (e.payload as { reasonCode: string }).reasonCode.startsWith('safety.s1.h'))).toEqual([]);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(s.userId))).toMatchObject({ ok: true });
  });

  it('S1: a flagged user’s program is stored with its S1 caps logged (RPE ceiling, no intervals)', async () => {
    const { s, gymId } = await ready(['heart_or_blood_pressure']);
    const record = programRecord(gymId, { yes: ['heart_or_blood_pressure'], goal: 'fat_loss', days: 4 });
    expect(await push(s, [insert('programs', record)])).toEqual(['applied']);
    const types = (await chain(s)).slice(-3).map((e) => [e.type, (e.payload as { reasonCode?: string }).reasonCode ?? null]);
    expect(types).toEqual([
      ['program.generated', null],
      ['safety.event', 'safety.s1.hiit_not_allowed'],
      ['safety.event', 'safety.s1.rpe_above_cap'],
    ]);
  });

  it('refuses a program that is not what the engine derives, or not for the stored SafetyProfile, places or engine', async () => {
    const { s, gymId } = await ready(['heart_or_blood_pressure']);
    const good = programRecord(gymId, { yes: ['heart_or_blood_pressure'] });
    const firstWeek = good.program.microcycles[0]!;
    const edited: Program = { ...good.program, microcycles: [{ ...firstWeek, sessions: firstWeek.sessions.map((x, i) => (i === 0 ? { ...x, targetRpe: 9 } : x)) }, ...good.program.microcycles.slice(1)] };
    const looser = programRecord(gymId); // built on a cleared profile, but the stored screening has an unresolved flag
    const otherPlace = programRecord(gymId, { yes: ['heart_or_blood_pressure'], equipment: ['dumbbell'] });
    const unknownPlace = programRecord(randomUUID(), { yes: ['heart_or_blood_pressure'] });
    const oldEngine = { ...good, program: { ...good.program, engineVersion: '0.0.9' } };
    expect(await push(s, [insert('programs', { ...good, program: edited }), insert('programs', looser), insert('programs', otherPlace), insert('programs', unknownPlace), insert('programs', oldEngine), insert('programs', { reason: 'first' })])).toEqual([
      'program.mismatch',
      'program.safety_profile_mismatch',
      'program.equipment_mismatch',
      'program.equipment_mismatch',
      'program.engine_version_unsupported',
      'programs.invalid',
    ]);
    expect((await chain(s)).some((e) => e.type === 'program.generated')).toBe(false);
  });

  it('S7: no automatic program for a user routed to professional guidance, and none without the health consent', async () => {
    const { s, gymId } = await ready(['pregnancy_or_recent_birth']);
    const cleared = programRecord(gymId);
    // The input names the stored (S7) profile, but the program was generated for a cleared one: the engine gives no program.
    expect(await push(s, [insert('programs', { ...cleared, input: { ...cleared.input, safetyProfile: screening(['pregnancy_or_recent_birth']).safetyProfile } })])).toEqual(['program.not_allowed']);
    const other = await session();
    // FIX-E × FIX-C: the sync server now checks the collection schema first, so the reflow is a well-formed one
    // (an empty object would be `program_reflows.invalid`, another refusal): without consent it is still refused for consent.
    const first = cleared.program.microcycles[0]!.sessions[0]!;
    const wellFormed = reflowRecord(cleared.program, [], first.id, first.date, createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 1 }))!;
    expect(await push(other, [insert('programs', cleared), insert('program_reflows', wellFormed)])).toEqual(['privacy.consent_required', 'privacy.consent_required']);
  });

  it('stores a reflow the engine decides (P3 misses Friday → Saturday) with its "reflowed" event, and refuses others', async () => {
    const { s, gymId } = await ready();
    const record = programRecord(gymId);
    expect(await push(s, [insert('programs', record)])).toEqual(['applied']);
    const friday = record.program.microcycles[0]!.sessions.find((x) => x.weekday === 'fri')!;
    const reflow = reflowRecord(record.program, [], friday.id, friday.date, createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 1 }))!;
    expect(reflow.outcome).toEqual({ kind: 'shifted', toDate: addDays(friday.date, 1) });
    const tampered = { ...reflow, outcome: { kind: 'shifted', toDate: addDays(friday.date, 2) } };
    const elsewhere = { ...reflow, programId: randomUUID() };
    expect(await push(s, [insert('program_reflows', tampered), insert('program_reflows', elsewhere), insert('program_reflows', { ...reflow, engineVersion: '0.0.9' }), insert('program_reflows', reflow), insert('program_reflows', reflow), insert('program_reflows', { nope: 1 })])).toEqual([
      'program.reflow_mismatch',
      'program.reflow_unknown_program',
      'program.engine_version_unsupported',
      'applied',
      // The same session again, now shifted to Saturday: a report on Friday would decide something else.
      'program.reflow_mismatch',
      'program_reflows.invalid',
    ]);
    const reflowed = (await chain(s)).filter((e) => e.type === 'program.reflowed');
    expect(reflowed.map((e) => e.payload)).toEqual([{ programId: record.program.programId, sessionId: friday.id, outcome: 'shifted', engineVersion: ENGINE_VERSION }]);
    // A session already skipped cannot be reflowed again.
    const skip = reflowRecord(record.program, [], record.program.microcycles[1]!.sessions[0]!.id, addDays(record.program.microcycles[1]!.endDate, 1), createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 2 }))!;
    expect(await push(s, [insert('program_reflows', skip), insert('program_reflows', skip)])).toEqual(['applied', 'program.reflow_not_applicable']);
  });

  it('stores a program and its event atomically: a failed log write persists neither, the client retries and then both exist (ADR-009)', async () => {
    const { s, gymId } = await ready();
    const fetchIntoApp: typeof fetch = async (url, init) => {
      const res = await h.app.inject({ method: 'POST', url: new URL(String(url)).pathname, headers: { ...(init?.headers as Record<string, string>) }, payload: String(init?.body) });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    };
    const client = new SyncClient({ deviceId: s.deviceId, store: new MemoryLocalStore(), transport: new HttpTransport({ baseUrl: 'http://api.test', getAccessToken: () => s.token, fetch: fetchIntoApp }), newId: randomUUID });
    const recordId = client.insert('programs', programRecord(gymId) as unknown as Record<string, unknown>);
    const stored = async () => (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.recordId, recordId)))).length;
    const generated = async () => (await chain(s)).filter((e) => e.type === 'program.generated');

    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_program_event() RETURNS trigger AS $$ BEGIN IF NEW.type = 'program.generated' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_program_event BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_program_event()`);
    try {
      await expect(client.sync()).rejects.toMatchObject({ name: 'HttpError', status: 500 });
      expect(await stored()).toBe(0);
      expect(await generated()).toEqual([]);
      expect(client.pendingCount()).toBe(1);
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_program_event ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_program_event()`);
    }
    expect((await client.sync()).push).toMatchObject({ acked: 1, rejected: 0 });
    expect(await stored()).toBe(1);
    expect(await generated()).toHaveLength(1);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(s.userId))).toMatchObject({ ok: true });
  });

  it('erases programs and reflows when the health consent is withdrawn; the log keeps the pseudonymous events', async () => {
    const { s, gymId } = await ready();
    const record = programRecord(gymId);
    const friday = record.program.microcycles[0]!.sessions.find((x) => x.weekday === 'fri')!;
    const reflow = reflowRecord(record.program, [], friday.id, friday.date, createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 1 }))!;
    expect(await push(s, [insert('programs', record), insert('program_reflows', reflow)])).toEqual(['applied', 'applied']);
    const withdraw = await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    expect(withdraw.statusCode).toBe(201);
    const left = await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(left.map((r) => r.collection)).toEqual(['equipment_profiles']);
    expect((await chain(s)).filter((e) => e.type.startsWith('program.')).map((e) => e.type)).toEqual(['program.generated', 'program.reflowed']);
  });
});
