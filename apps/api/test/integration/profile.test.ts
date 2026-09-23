import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { DEFAULT_REGISTRY, LegalRegistry, type LegalDocument } from '@fitadapt/legal';
import { evaluateScreening } from '@fitadapt/safety';
import { HttpTransport, MemoryLocalStore, SyncClient } from '@fitadapt/sync';
import { EMPTY_BIOMETRICS, PROFILE_RECORD_ID, SCREENING_QUESTION_IDS, type ScreeningRecord } from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consentRecords, legalAcceptances, syncChanges } from '../../src/db/schema.js';
import { latestCalendarDate } from '../../src/profile/sync-hooks.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M01 on the server: the profile, equipment profiles and screenings sync
 * through /v1/sync with server-side validation (schema, health consent, S7
 * age check, SafetyProfile re-evaluation); consents, acceptances and notices
 * given offline keep their device time and are idempotent.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const allNo = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no']));
const today = () => {
  const d = h.clock.now();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const yearsAgo = (years: number, days = 0) => {
  const d = new Date(h.clock.now().getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

function screening(yes: string[] = [], birthDate = yearsAgo(30)): ScreeningRecord {
  const responses = { answers: { ...allNo, ...Object.fromEntries(yes.map((q) => [q, 'yes'])) }, clearanceAttested: false, birthDate, answeredOn: today(), limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: h.clock.now().toISOString() };
}

function profile(birthDate = yearsAgo(30)) {
  return {
    schemaVersion: 1,
    goals: { primary: 'strength', secondary: null },
    experience: 'beginner',
    schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false },
    birthDate,
    biometrics: EMPTY_BIOMETRICS,
    limitations: [],
    excludedExerciseIds: [],
    motivation: null,
    activeEquipmentProfileId: null,
    onboardingCompletedAt: h.clock.now().toISOString(),
  };
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
const grantHealth = (s: Session, extra: object = {}) =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', ...extra } });

describe('M01 profile sync with server-side validation', () => {
  it('refuses health collections (profile, screenings) without the health consent; equipment profiles need none', async () => {
    const s = await session();
    expect(await push(s, [insert('screenings', screening()), insert('profile', profile(), PROFILE_RECORD_ID), insert('equipment_profiles', { location: 'home', equipment: ['dumbbell'] })])).toEqual([
      'privacy.consent_required',
      'privacy.consent_required',
      'applied',
    ]);
    expect((await grantHealth(s)).statusCode).toBe(201);
    expect(await push(s, [insert('screenings', screening()), insert('profile', profile(), PROFILE_RECORD_ID)])).toEqual(['applied', 'applied']);
  });

  it('re-evaluates the SafetyProfile: a looser profile than the answers give is refused', async () => {
    const s = await session();
    await grantHealth(s);
    const flagged = screening(['chest_discomfort']);
    expect(flagged.safetyProfile).toMatchObject({ maxRPE: 7, allowHIIT: false, unresolvedFlags: ['chest_discomfort'] });
    const tampered = { ...flagged, safetyProfile: { ...flagged.safetyProfile, maxRPE: 10, allowHIIT: true, unresolvedFlags: [] } };
    expect(await push(s, [insert('screenings', tampered), insert('screenings', { ...flagged, responses: { ...flagged.responses, answers: { chest_discomfort: 'yes' } } }), insert('screenings', flagged)])).toEqual([
      'screening.profile_mismatch',
      'screening.profile_mismatch',
      'applied',
    ]);
    expect(await push(s, [insert('screenings', { nonsense: true }), insert('equipment_profiles', { location: 'moon', equipment: [] }), insert('profile', { ...profile(), schemaVersion: 2 })])).toEqual([
      'screening.invalid',
      'equipment_profile.invalid',
      'profile.invalid',
    ]);
  });

  it('checks age on the server (S7): under 16 is refused, 16 is accepted', async () => {
    const s = await session();
    await grantHealth(s);
    // One day before the 16th birthday even at the latest date on Earth (UTC+14).
    const latest = latestCalendarDate(h.clock.now());
    const fifteen = { year: latest.year - 16, month: latest.month, day: latest.day };
    const tomorrow = new Date(Date.UTC(fifteen.year, fifteen.month - 1, fifteen.day + 1));
    const almost16 = { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() };
    expect(await push(s, [insert('profile', profile(almost16), PROFILE_RECORD_ID)])).toEqual(['safety.s7.under_minimum_age']);
    const underage = screening([], yearsAgo(14));
    expect(underage.safetyProfile.screeningOutcome).toBe('blocked');
    expect(await push(s, [insert('screenings', underage)])).toEqual(['safety.s7.under_minimum_age']);
    expect(await push(s, [insert('profile', profile(yearsAgo(16, -1)), PROFILE_RECORD_ID), insert('screenings', screening([], yearsAgo(17)))])).toEqual(['applied', 'applied']);
    // An answer date in the future is refused.
    const future = screening();
    const later = { ...future.responses, answeredOn: { ...latest, year: latest.year + 1 } };
    expect(await push(s, [insert('screenings', { ...future, responses: later, safetyProfile: evaluateScreening(later) })])).toEqual(['screening.invalid']);
  });

  it('keeps at least three equipment profiles and syncs them to a second device', async () => {
    const s = await session();
    const rows = [
      { location: 'home', equipment: ['pull_up_bar', 'resistance_band', 'dumbbell'] },
      { location: 'gym', equipment: ['barbell', 'squat_rack', 'flat_bench', 'cable_station'] },
      { location: 'park', equipment: ['pull_up_bar', 'parallel_bars'] },
      { location: 'travel', equipment: [] },
    ];
    expect(await push(s, rows.map((r) => insert('equipment_profiles', r)))).toEqual(['applied', 'applied', 'applied', 'applied']);
    const pull = await h.app.inject({ method: 'POST', url: '/v1/sync/pull', headers: bearer(s.token), payload: { deviceId: s.deviceId, since: 0 } });
    const changes = (pull.json() as { changes: { collection: string; data: { location: string } }[] }).changes;
    expect(changes.filter((c) => c.collection === 'equipment_profiles').map((c) => c.data.location)).toEqual(['home', 'gym', 'park', 'travel']);
  });

  it('writes the safety gates a screening switches on to the defensibility log (S1, S4, S7)', async () => {
    const s = await session();
    await grantHealth(s);
    expect(await push(s, [insert('screenings', screening(['fainting_or_dizziness', 'pregnancy_or_recent_birth', 'advised_against_calorie_restriction']))])).toEqual(['applied']);
    const chain = await h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));
    const safety = chain.filter((e) => e.type === 'safety.event').map((e) => e.payload);
    expect(safety).toEqual([
      { invariant: 'S1', reasonCode: 'safety.s1.unresolved_flag', action: 'capped', engineVersion: ENGINE_VERSION },
      { invariant: 'S7', reasonCode: 'safety.s7.pregnancy_postpartum', action: 'capped', engineVersion: ENGINE_VERSION },
      { invariant: 'S4', reasonCode: 'safety.s4.deficit_disabled', action: 'blocked', engineVersion: ENGINE_VERSION },
    ]);
  });

  it('stores a screening and its safety events atomically: a failed log write persists neither, the client retries and then both exist (L11, M01 deviation 14 fixed)', async () => {
    const s = await session();
    await grantHealth(s);
    // A real device client over HTTP (fetch routed into the app), so the retry is the client's own.
    const fetchIntoApp: typeof fetch = async (url, init) => {
      const res = await h.app.inject({ method: 'POST', url: new URL(String(url)).pathname, headers: { ...(init?.headers as Record<string, string>) }, payload: String(init?.body) });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    };
    const client = new SyncClient({ deviceId: s.deviceId, store: new MemoryLocalStore(), transport: new HttpTransport({ baseUrl: 'http://api.test', getAccessToken: () => s.token, fetch: fetchIntoApp }), newId: randomUUID });
    const recordId = client.insert('screenings', screening(['chest_discomfort']) as unknown as Record<string, unknown>);
    const stored = async () => (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.recordId, recordId)))).length;
    const safetyEvents = async () => (await h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId))).filter((e) => e.type === 'safety.event');

    // Inject a failure in the defensibility-log write, in the database itself.
    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_safety_event() RETURNS trigger AS $$ BEGIN IF NEW.type = 'safety.event' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_safety_event BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_safety_event()`);
    try {
      await expect(client.sync()).rejects.toMatchObject({ name: 'HttpError', status: 500 });
      // Neither the screening nor its safety event, and the mutation is still waiting in the outbox.
      expect(await stored()).toBe(0);
      expect(await safetyEvents()).toEqual([]);
      expect(client.pendingCount()).toBe(1);
      const ledger = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sync_mutations WHERE user_id = ${s.userId}`);
      expect(ledger.rows[0]!.n).toBe(0); // no idempotency record: the retry is applied, not answered "duplicate"
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_safety_event ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_safety_event()`);
    }

    // The log works again: the client's retry stores both.
    const retry = await client.sync();
    expect(retry.push).toMatchObject({ acked: 1, rejected: 0 });
    expect(client.pendingCount()).toBe(0);
    expect(await stored()).toBe(1);
    expect((await safetyEvents()).map((e) => e.payload)).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.unresolved_flag', action: 'capped', engineVersion: ENGINE_VERSION }]);
    expect(await h.app.services.legal.log.verify(h.app.services.legal.subjectRef(s.userId))).toMatchObject({ ok: true });
  });

  it('erases the synced health collections when health consent is withdrawn, and keeps equipment profiles', async () => {
    const s = await session();
    await grantHealth(s);
    await push(s, [insert('screenings', screening()), insert('profile', profile(), PROFILE_RECORD_ID), insert('equipment_profiles', { location: 'home', equipment: [] })]);
    const withdraw = await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    expect(withdraw.statusCode).toBe(201);
    const left = await h.database.db.select({ collection: syncChanges.collection }).from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(left.map((r) => r.collection)).toEqual(['equipment_profiles']);
    expect(await push(s, [insert('screenings', screening())])).toEqual(['privacy.consent_required']);
  });
});

describe('offline consents and acceptances (device time, idempotent upload)', () => {
  it('records a consent made offline with its device time, once, even when the upload is retried', async () => {
    const s = await session();
    const id = randomUUID();
    const recordedAt = new Date(h.clock.now().getTime() - 3 * 86_400_000).toISOString();
    expect((await grantHealth(s, { id, recordedAt })).statusCode).toBe(201);
    expect((await grantHealth(s, { id, recordedAt })).statusCode).toBe(201);
    const rows = await h.database.db.select().from(consentRecords).where(eq(consentRecords.userId, s.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.recordedAt.toISOString()).toBe(recordedAt);
    expect(rows[0]!.receivedAt.toISOString()).toBe(h.clock.now().toISOString());
    const chain = await h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId));
    expect(chain.filter((e) => e.type === 'consent.recorded')).toHaveLength(1);
    // Device times too far in the past or in the future are refused.
    const old = new Date(h.clock.now().getTime() - 31 * 86_400_000).toISOString();
    const ahead = new Date(h.clock.now().getTime() + 3_600_000).toISOString();
    expect((await grantHealth(s, { recordedAt: old })).json()).toEqual({ error: { code: 'privacy.client_time_out_of_range' } });
    expect((await grantHealth(s, { recordedAt: ahead })).statusCode).toBe(400);
  });

  it('stores an offline acceptance with version, locale, jurisdiction and device timestamp (L2), once', async () => {
    const s = await session();
    const d = (await h.app.inject({ method: 'GET', url: '/v1/legal/documents/exercise_risk?locale=fr&jurisdiction=SN' })).json() as { version: number; contentHash: string };
    const id = randomUUID();
    const acceptedAt = new Date(h.clock.now().getTime() - 3_600_000).toISOString();
    const body = { id, documentId: 'exercise_risk', version: d.version, locale: 'fr', jurisdiction: 'SN', source: 'mobile', contentHash: d.contentHash, acceptedAt };
    for (let i = 0; i < 2; i++) expect((await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(s.token), payload: body })).statusCode).toBe(201);
    const rows = await h.database.db.select().from(legalAcceptances).where(and(eq(legalAcceptances.userId, s.userId), eq(legalAcceptances.documentId, 'exercise_risk')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, version: 1, locale: 'fr', jurisdiction: 'SN', source: 'mobile', contentHash: d.contentHash });
    expect(rows[0]!.acceptedAt.toISOString()).toBe(acceptedAt);
    const events = (await h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId))).filter((e) => e.type === 'acceptance.recorded');
    expect(events.map((e) => [e.occurredAt, e.payload])).toEqual([[acceptedAt, { documentId: 'exercise_risk', version: 1, locale: 'fr', jurisdiction: 'SN', contentHash: d.contentHash, source: 'mobile' }]]);
    // Notices shown offline keep their time too.
    const notice = await h.app.inject({ method: 'POST', url: '/v1/legal/notices', headers: bearer(s.token), payload: { noticeId: 'first_workout', version: 1, kind: 'shown', locale: 'fr', jurisdiction: 'SN', contentHash: '0'.repeat(64), occurredAt: acceptedAt } });
    expect(notice.statusCode).toBe(409); // wrong hash is still refused
  });

  it('publishing a new material version forces re-acceptance, even of an acceptance uploaded later from the device', async () => {
    const now = h.clock.now();
    const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const base = DEFAULT_REGISTRY.get('exercise_risk')!;
    const v1 = base.versions[0]!;
    const risk: LegalDocument = { ...base, versions: [{ ...v1, publishedOn: day(-20), effectiveFrom: day(-20) }, { ...v1, version: 2, material: true, publishedOn: day(-1), effectiveFrom: day(-1), changeSummary: 'fixture: material change in force' }] };
    const registry = new LegalRegistry(DEFAULT_REGISTRY.documents.map((doc) => (doc.id === 'exercise_risk' ? risk : doc)));
    const h2 = await createHarness({ legalRegistry: registry });
    try {
      const dev = device();
      const { tokens } = await signIn(h2, uniqueEmail(), dev);
      const { renderDocument } = await import('@fitadapt/legal');
      const oldText = renderDocument(risk, risk.versions[0]!, 'en', 'GB');
      const accepted2DaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      // Accepted offline two days ago (v1 was in force then): recorded, but it no longer counts.
      const res = await h2.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(tokens.accessToken), payload: { documentId: 'exercise_risk', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: oldText.contentHash, acceptedAt: accepted2DaysAgo } });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { acceptance: { status: string } }).acceptance.status).toBe('needs_reacceptance');
      // A v1 acceptance made now is refused: v1 is no longer acceptable.
      const late = await h2.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(tokens.accessToken), payload: { documentId: 'exercise_risk', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: oldText.contentHash } });
      expect(late.json()).toEqual({ error: { code: 'legal.version_not_acceptable' } });
      const newText = renderDocument(risk, risk.versions[1]!, 'en', 'GB');
      const again = await h2.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(tokens.accessToken), payload: { documentId: 'exercise_risk', version: 2, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: newText.contentHash } });
      expect((again.json() as { acceptance: { status: string } }).acceptance.status).toBe('accepted');
    } finally {
      await h2.close();
    }
  });
});

describe('inventory', () => {
  it('stores the new receipt times on consents, acceptances and notices', async () => {
    const cols = await h.database.db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE column_name = 'received_at' ORDER BY table_name`);
    expect(cols.rows.map((r) => r.table_name)).toEqual(['consent_records', 'legal_acceptances', 'notice_impressions']);
  });
});
