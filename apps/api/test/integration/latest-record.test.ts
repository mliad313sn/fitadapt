import { randomUUID } from 'node:crypto';
import { evaluateScreening } from '@fitadapt/safety';
import { PROFILE_RECORD_ID, SCREENING_QUESTION_IDS, type ConsentState, type ScreeningRecord } from '@fitadapt/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consentRecords } from '../../src/db/schema.js';
import { latestSafetyProfile } from '../../src/profile/sync-hooks.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * FIX-latest-record-ordering (ADR-023) on the server: the SafetyProfile the
 * server re-derives and the consent in force follow the records' chains,
 * never the push order or a device timestamp, so the server picks the same
 * "latest" as the device. Fictional users only.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const answers = (yes: string[]) => Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
function screening(yes: string[], completedAt: string, supersedes?: string[]): ScreeningRecord {
  const d = h.clock.now();
  const responses = { answers: answers(yes), clearanceAttested: false, birthDate: { year: 1990, month: 5, day: 4 }, answeredOn: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'annual', responses, safetyProfile: evaluateScreening(responses), completedAt, ...(supersedes ? { supersedes } : {}) };
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
const decide = (s: Session, decision: 'granted' | 'withdrawn', extra: object = {}) =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile', ...extra } });
const health = async (s: Session) => ((await h.app.inject({ method: 'GET', url: '/v1/privacy/consents', headers: bearer(s.token) })).json() as { consents: ConsentState[] }).consents.find((c) => c.dataType === 'health')!;
const ago = (ms: number) => new Date(h.clock.now().getTime() - ms).toISOString();

describe('the server picks the same latest screening as the device', () => {
  it('a newer, stricter screening pushed FIRST and dated EARLIER (clock moved back) still counts; the older one pushed last does not', async () => {
    const s = await session();
    await decide(s, 'granted');
    const oldId = randomUUID();
    const newId = randomUUID();
    const older = screening([], ago(60_000), []);
    const newer = screening(['advised_against_calorie_restriction'], ago(3_600_000), [oldId]);
    expect(await push(s, [insert('screenings', newer, newId)])).toEqual(['applied']);
    expect(await push(s, [insert('screenings', older, oldId)])).toEqual(['applied']);
    const profile = await latestSafetyProfile(h.database.db, s.userId);
    expect(profile).toEqual(evaluateScreening(newer.responses));
    expect(profile.deficitNutritionAllowed).toBe(false);
  });

  it('two screenings in the same instant without links (stored before ADR-023): the stricter combination, never the looser one', async () => {
    const s = await session();
    await decide(s, 'granted');
    const at = ago(1000);
    expect(await push(s, [insert('screenings', screening(['advised_against_calorie_restriction'], at)), insert('screenings', screening([], at))])).toEqual(['applied', 'applied']);
    const profile = await latestSafetyProfile(h.database.db, s.userId);
    expect(profile.deficitNutritionAllowed).toBe(false);
    expect(profile.reasonCodes).toContain('safety_profile.ambiguous_latest');
    // A profile built on the looser screening is refused (the server re-derives the stricter one).
    const other = await session();
    expect(await latestSafetyProfile(h.database.db, other.userId)).toMatchObject({ screeningOutcome: 'not_screened' });
  });
});

describe('a withdrawal is never overtaken by an older grant on the server', () => {
  it('a withdrawal dated before the grant it names (clock moved back): withdrawn, uploaded in either order; health data is refused', async () => {
    for (const order of ['grant-first', 'withdrawal-first'] as const) {
      await truncateAll(h);
      const s = await session();
      const grantId = randomUUID();
      const grant = () => decide(s, 'granted', { id: grantId, recordedAt: ago(60_000), supersedes: [] });
      const withdrawal = () => decide(s, 'withdrawn', { id: randomUUID(), recordedAt: ago(3_600_000), supersedes: [grantId] });
      if (order === 'grant-first') {
        expect((await grant()).statusCode).toBe(201);
        expect((await withdrawal()).statusCode).toBe(201);
      } else {
        expect((await withdrawal()).statusCode).toBe(201);
        expect((await grant()).statusCode).toBe(201);
      }
      expect(await health(s)).toMatchObject({ granted: false });
      expect(await push(s, [insert('profile', { nonsense: true }, PROFILE_RECORD_ID)])).toEqual(['profile.invalid']);
      expect(await push(s, [insert('screenings', screening([], ago(0), []))])).toEqual(['privacy.consent_required']);
      const rows = await h.database.db.select().from(consentRecords).where(eq(consentRecords.userId, s.userId));
      expect(rows.find((r) => r.decision === 'withdrawn')!.supersedes).toEqual([grantId]);
    }
  });

  it('a decision made on the server (web/API) names what the server holds; a legacy mobile decision names nothing', async () => {
    const s = await session();
    expect((await decide(s, 'granted')).statusCode).toBe(201);
    expect((await decide(s, 'withdrawn', { source: 'web' })).statusCode).toBe(201);
    const rows = await h.database.db.select().from(consentRecords).where(eq(consentRecords.userId, s.userId));
    const grant = rows.find((r) => r.decision === 'granted')!;
    expect(grant.supersedes).toBeNull();
    expect(rows.find((r) => r.decision === 'withdrawn')!.supersedes).toEqual([grant.id]);
    expect(await health(s)).toMatchObject({ granted: false });
    // The export shows the links (GDPR Art. 15/20): nothing is hidden.
    const exported = (await h.app.inject({ method: 'GET', url: '/v1/privacy/export', headers: bearer(s.token) })).json() as { consents: { supersedes?: string[] }[] };
    expect(exported.consents.map((c) => c.supersedes ?? null)).toEqual(expect.arrayContaining([null, [grant.id]]));
  });
});
