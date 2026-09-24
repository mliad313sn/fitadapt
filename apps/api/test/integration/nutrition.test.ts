import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, NUTRITION_RULES_VERSION, computeNutritionTarget, createEngineContext, fixedClock } from '@fitadapt/engine';
import { evaluateScreening } from '@fitadapt/safety';
import { EMPTY_BIOMETRICS, PROFILE_RECORD_ID, SCREENING_QUESTION_IDS, type CalendarDateValue, type IntakeLog, type NutritionInput, type NutritionPlanRecord, type Profile, type ScreeningRecord } from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M10 on the server (ADR-022): nutrition plans, intake logs and habit ticks
 * are health collections (consent, schema, erasure on withdrawal). A plan is
 * re-derived with the engine for the SafetyProfile of the latest stored
 * screening and the stored birth date, and re-checked against S4 in
 * packages/safety; an intake estimate must be the engine's estimate on the
 * seed. "Nutrition target set" and the S4 events are written in the sync
 * transaction. Fictional users only.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const ADULT: CalendarDateValue = { year: 1988, month: 3, day: 14 };
const today = () => h.clock.now().toISOString().slice(0, 10);
function screening(yes: string[] = [], birthDate = ADULT): ScreeningRecord {
  const d = h.clock.now();
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  const responses = { answers, clearanceAttested: false, birthDate, answeredOn: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: d.toISOString() };
}
const profile = (birthDate = ADULT): Profile => ({ schemaVersion: 1, goals: { primary: 'fat_loss', secondary: null }, experience: 'beginner', schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: [], remindersEnabled: false }, birthDate, biometrics: EMPTY_BIOMETRICS, limitations: [], excludedExerciseIds: [], motivation: null, activeEquipmentProfileId: null, onboardingCompletedAt: h.clock.now().toISOString() });

function planRecord(over: Partial<NutritionInput> = {}, yes: string[] = [], birthDate = ADULT): NutritionPlanRecord {
  const input: NutritionInput = {
    schemaVersion: 1,
    goal: 'fat_loss',
    trackingStyle: 'numbers',
    activityLevel: 'moderate',
    sexForEstimate: 'male',
    weightKg: 120,
    heightCm: 178,
    birthDate,
    today: today(),
    plannedLossPercentPerWeek: 0.5,
    goalWeightKg: null,
    safetyProfile: screening(yes, birthDate).safetyProfile,
    guardrailEvents: [],
    adaptive: null,
    previousExpenditureKcal: null,
    ...over,
  };
  const { target } = computeNutritionTarget(input, createEngineContext({ clock: fixedClock(h.clock.now().getTime()), seed: 7 }));
  return { input, target, reason: 'setup', createdAt: h.clock.now().toISOString(), supersedes: null };
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
const consent = (s: Session, decision: 'granted' | 'withdrawn') => h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
const chain = (s: Session) => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));

async function ready(yes: string[] = [], birthDate = ADULT) {
  const s = await session();
  await consent(s, 'granted');
  expect(await push(s, [insert('profile', profile(birthDate), PROFILE_RECORD_ID), insert('screenings', screening(yes, birthDate))])).toEqual(['applied', 'applied']);
  return s;
}

const intake = (over: Partial<IntakeLog> = {}): IntakeLog => ({ schemaVersion: 1, loggedOn: today(), at: h.clock.now().toISOString(), meal: null, entry: { kind: 'food', foodId: 'thieboudienne', portionId: 'plate', count: 1 }, estimate: { energyKcal: 640, proteinG: 32 }, correctionOf: null, removed: false, ...over });

describe('M10 nutrition sync with server-side re-derivation and the S4 re-check', () => {
  it('needs the health consent; stores a plan the engine derives and writes "nutrition target set" and its S4 events in the same transaction', async () => {
    const s = await session();
    expect(await push(s, [insert('nutrition_plans', planRecord()), insert('intake_logs', intake()), insert('habit_checks', { schemaVersion: 1, habit: 'hydration', checkedOn: today(), done: true, at: h.clock.now().toISOString() })])).toEqual(['privacy.consent_required', 'privacy.consent_required', 'privacy.consent_required']);
    await consent(s, 'granted');
    expect(await push(s, [insert('profile', profile(), PROFILE_RECORD_ID), insert('screenings', screening())])).toEqual(['applied', 'applied']);
    // 1 %/week for a sedentary P1-like user would go below the estimated BMR: the engine keeps it at the floor (S4 capped).
    const record = planRecord({ activityLevel: 'sedentary', plannedLossPercentPerWeek: 1 });
    expect(record.target.reasonCodes).toContain('nutrition.s4.bmr_floor');
    expect(await push(s, [insert('nutrition_plans', record)])).toEqual(['applied']);
    const events = await chain(s);
    const target = events.filter((e) => e.type === 'nutrition.target_set');
    expect(target.map((e) => e.payload)).toEqual([{ targetId: record.target.targetId, engineVersion: ENGINE_VERSION, rulesVersion: NUTRITION_RULES_VERSION, mode: 'numeric', reason: 'setup', deficitAllowed: true, reasonCodes: record.target.reasonCodes }]);
    expect(events.filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S4').map((e) => e.payload)).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.bmr_floor', action: 'capped', engineVersion: ENGINE_VERSION }]);
    // No calorie, weight or intake value in the log.
    expect(Object.values(target[0]!.payload as Record<string, unknown>).filter((v) => typeof v === 'number')).toEqual([]);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(s.userId))).toMatchObject({ ok: true });
  });

  it('refuses a tampered target, an unsafe one, a looser SafetyProfile, another birth date, and another engine version', async () => {
    const s = await ready();
    const good = planRecord();
    const t = good.target;
    const unsafeTarget = { ...t, energy: { ...t.energy!, targetKcal: 1200, deficitKcal: Math.floor(t.energyModel!.expenditureKcal) - 1200 }, plannedLossPercentPerWeek: 1 };
    expect(
      await push(s, [
        insert('nutrition_plans', { ...good, target: { ...t, energy: { ...t.energy!, targetKcal: t.energy!.targetKcal - 200, deficitKcal: t.energy!.deficitKcal + 200 } } }),
        insert('nutrition_plans', { ...good, target: unsafeTarget }),
        insert('nutrition_plans', { ...good, target: { ...t, engineVersion: '0.0.1' } }),
        insert('nutrition_plans', planRecord({ birthDate: { year: 1990, month: 1, day: 1 } }, [], { year: 1990, month: 1, day: 1 })),
        insert('nutrition_plans', { ...good, input: { ...good.input, safetyProfile: { ...good.input.safetyProfile, reasonCodes: [] } } }),
        insert('nutrition_plans', { ...good, target: { ...t, mode: 'maybe' } }),
        insert('nutrition_plans', good),
      ]),
      // A target below its BMR floor is already refused by the schema (S4 refinement): 'nutrition.invalid'.
    ).toEqual(['nutrition.target_mismatch', 'nutrition.invalid', 'nutrition.engine_version_unsupported', 'nutrition.profile_mismatch', 'nutrition.safety_profile_mismatch', 'nutrition.invalid', 'applied']);
  });

  it('a user advised against calorie restriction, or under 18, cannot store a deficit: only the supportive plan is accepted', async () => {
    const advised = await ready(['advised_against_calorie_restriction']);
    const supportive = planRecord({}, ['advised_against_calorie_restriction']);
    expect(supportive.target).toMatchObject({ mode: 'supportive', energy: null, deficitAllowed: false });
    // A device that pretends deficit features are allowed is refused (its SafetyProfile is not the server's).
    const pretend = planRecord({ safetyProfile: screening().safetyProfile });
    expect(await push(advised, [insert('nutrition_plans', pretend), insert('nutrition_plans', supportive)])).toEqual(['nutrition.safety_profile_mismatch', 'applied']);
    expect((await chain(advised)).filter((e) => e.type === 'safety.event').map((e) => (e.payload as { reasonCode: string }).reasonCode)).toContain('safety.s4.deficit_disabled');

    const minorBirth = { year: new Date(h.clock.now()).getUTCFullYear() - 17, month: 1, day: 1 };
    const minor = await ready([], minorBirth);
    const plan = planRecord({}, [], minorBirth);
    expect(plan.target).toMatchObject({ mode: 'supportive', deficitAllowed: false, plannedLossPercentPerWeek: 0 });
    expect(await push(minor, [insert('nutrition_plans', plan)])).toEqual(['applied']);
    expect((await chain(minor)).filter((e) => e.type === 'safety.event').map((e) => (e.payload as { reasonCode: string }).reasonCode)).toEqual(expect.arrayContaining(['safety.s4.deficit_disabled', 'safety.s4.minor']));
  });

  it('API-5 / SAF-5: a minor cannot pass S4 with a future "today", a far clock, or a screening that states an adult date of birth', async () => {
    const minorBirth = { year: new Date(h.clock.now()).getUTCFullYear() - 17, month: 1, day: 1 };
    // The review's scenario: the profile holds the minor's date, the screening an adult's. The screening is refused.
    const s = await session();
    await consent(s, 'granted');
    expect(await push(s, [insert('profile', profile(minorBirth), PROFILE_RECORD_ID), insert('screenings', screening([], ADULT))])).toEqual(['applied', 'screening.profile_mismatch']);
    // "today" five years ahead would make the engine and the S4 re-check compute an adult's age: refused.
    expect(await push(s, [insert('screenings', screening([], minorBirth))])).toEqual(['applied']);
    const future = planRecord({ today: `${h.clock.now().getUTCFullYear() + 5}-01-01` }, [], minorBirth);
    expect(await push(s, [insert('nutrition_plans', future)])).toEqual(['nutrition.client_time_out_of_range']);
    // The engine clock (createdAt) is bounded too: eight days ahead, or older than the offline window.
    const ahead = { ...planRecord({}, [], minorBirth), createdAt: new Date(h.clock.now().getTime() + 8 * 86_400_000).toISOString() };
    const stale = { ...planRecord({}, [], minorBirth), createdAt: new Date(h.clock.now().getTime() - 31 * 86_400_000).toISOString() };
    expect(await push(s, [insert('nutrition_plans', ahead), insert('nutrition_plans', stale)])).toEqual(['nutrition.client_time_out_of_range', 'nutrition.client_time_out_of_range']);
    // The honest plan: supportive, stored.
    const honest = planRecord({}, [], minorBirth);
    expect(honest.target.deficitAllowed).toBe(false);
    expect(await push(s, [insert('nutrition_plans', honest)])).toEqual(['applied']);
  });

  it('API-5: a plan is refused while the latest screening states another date of birth than the profile (fail closed until re-screened)', async () => {
    const s = await ready();
    const corrected = { year: 1987, month: 3, day: 14 };
    // The profile's date of birth is corrected; the stored screening still states the old one.
    const current = (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.collection, 'profile'))))[0]!;
    const update = { ...insert('profile', profile(corrected), PROFILE_RECORD_ID), op: 'upsert' as const, baseRevision: current.revision };
    expect(await push(s, [update as unknown as ReturnType<typeof insert>])).toEqual(['applied']);
    expect(await push(s, [insert('nutrition_plans', planRecord({}, [], corrected))])).toEqual(['nutrition.profile_mismatch']);
    // A re-screen with the corrected date (replacing the old screening): plans are accepted again.
    const old = (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.collection, 'screenings'))))[0]!;
    expect(await push(s, [insert('screenings', { ...screening([], corrected), supersedes: [old.recordId] })])).toEqual(['applied']);
    expect(await push(s, [insert('nutrition_plans', planRecord({}, [], corrected))])).toEqual(['applied']);
  });

  it('intake logs carry the engine estimate on the seed; habit ticks are schema-checked', async () => {
    const s = await ready();
    expect(
      await push(s, [
        insert('intake_logs', intake()),
        insert('intake_logs', intake({ entry: { kind: 'hand_portion', portion: 'protein_palm', count: 2 }, estimate: { energyKcal: 300, proteinG: 50 } })),
        insert('intake_logs', intake({ estimate: { energyKcal: 100, proteinG: 32 } })),
        insert('intake_logs', intake({ entry: { kind: 'food', foodId: 'unknown_food', portionId: 'plate', count: 1 } })),
        insert('intake_logs', { nope: true }),
        insert('habit_checks', { schemaVersion: 1, habit: 'hydration', checkedOn: today(), done: true, at: h.clock.now().toISOString() }),
        insert('habit_checks', { schemaVersion: 1, habit: 'fasting', checkedOn: today(), done: true, at: h.clock.now().toISOString() }),
      ]),
    ).toEqual(['applied', 'applied', 'intake_log.estimate_mismatch', 'intake_log.invalid', 'intake_log.invalid', 'applied', 'habit_check.invalid']);
  });

  it('stores a plan and its events atomically: a failed log write persists neither', async () => {
    const s = await ready();
    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_nutrition_event() RETURNS trigger AS $$ BEGIN IF NEW.type = 'nutrition.target_set' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_nutrition_event BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_nutrition_event()`);
    const recordId = randomUUID();
    try {
      const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations: [insert('nutrition_plans', planRecord(), recordId)] } });
      expect(res.statusCode).toBe(500);
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_nutrition_event ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_nutrition_event()`);
    }
    expect(await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.recordId, recordId)))).toEqual([]);
    expect((await chain(s)).filter((e) => e.type === 'nutrition.target_set')).toEqual([]);
  });

  it('erases nutrition plans, intake logs and habit ticks when the health consent is withdrawn; the log keeps the pseudonymous events', async () => {
    const s = await ready();
    expect(await push(s, [insert('nutrition_plans', planRecord()), insert('intake_logs', intake()), insert('habit_checks', { schemaVersion: 1, habit: 'vegetables', checkedOn: today(), done: true, at: h.clock.now().toISOString() })])).toEqual(['applied', 'applied', 'applied']);
    expect((await consent(s, 'withdrawn')).statusCode).toBe(201);
    const left = await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(left).toEqual([]);
    expect((await chain(s)).filter((e) => e.type === 'nutrition.target_set')).toHaveLength(1);
  });
});
