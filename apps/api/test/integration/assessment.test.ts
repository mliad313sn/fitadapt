import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { buildCapacityModel } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type AssessmentRecord, type AssessmentResult, type ScreeningRecord } from '@fitadapt/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M07 on the server: assessment records sync as an append-only health
 * collection. The server re-computes the CapacityModel from the result,
 * checks the engine version and re-checks the S1 reserve against the user's
 * latest stored screening; an S1-capped assessment writes its safety event
 * in the sync transaction (L11).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const today = () => {
  const d = h.clock.now();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
function screening(yes: string[] = []): ScreeningRecord {
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  const responses = { answers, clearanceAttested: false, birthDate: { year: 1988, month: 5, day: 4 }, answeredOn: today(), limitations: [], excludedExerciseIds: [] } as ScreeningRecord['responses'];
  return { reason: 'onboarding', responses, safetyProfile: evaluateScreening(responses), completedAt: h.clock.now().toISOString() };
}
const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number }) => ({ status: 'done' as const, testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: null, rir: null });
function record(stopRir = 2): AssessmentRecord {
  const result: AssessmentResult = {
    protocolId: 'home',
    protocolVersion: 1,
    stopRir,
    startedAt: new Date(h.clock.now().getTime() - 15 * 60_000).toISOString(),
    completedAt: h.clock.now().toISOString(),
    tests: [
      done('push_reps', 'knee_push_up', { reps: 6 }),
      done('dead_hang_hold', 'dead_hang', { seconds: 15 }),
      done('row_reps', 'pull_up', { reps: 0 }),
      done('squat_reps', 'air_squat', { reps: 12 }),
      done('plank_hold', 'knee_plank', { seconds: 30 }),
    ],
  };
  return { reason: 'first', result, capacity: buildCapacityModel(result), cappedByS1: stopRir > 2 };
}

async function session() {
  const dev = device();
  const auth = await signIn(h, uniqueEmail(), dev);
  return { token: auth.tokens.accessToken, userId: auth.user.id, deviceId: dev.id };
}
type Session = Awaited<ReturnType<typeof session>>;
const insert = (collection: string, data: unknown) => ({ mutationId: randomUUID(), collection, recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() });
async function push(s: Session, mutations: ReturnType<typeof insert>[]) {
  const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(s.token), payload: { deviceId: s.deviceId, mutations } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { results: { status: string; reason?: string }[] }).results.map((r) => (r.status === 'rejected' ? r.reason : r.status));
}
const grantHealth = (s: Session) =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
const safetyEvents = async (s: Session) => (await h.app.services.legal.log.chain(h.app.services.legal.subjectRef(s.userId))).filter((e) => e.type === 'safety.event').map((e) => e.payload);

describe('M07 assessment records on the server', () => {
  it('needs the health consent and a stored screening; then a genuine record is stored', async () => {
    const s = await session();
    expect(await push(s, [insert('assessments', record())])).toEqual(['privacy.consent_required']);
    await grantHealth(s);
    expect(await push(s, [insert('assessments', record())])).toEqual(['assessment.not_allowed']);
    expect(await push(s, [insert('screenings', screening()), insert('assessments', record())])).toEqual(['applied', 'applied']);
    const rows = await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, s.userId), eq(syncChanges.collection, 'assessments')));
    expect(rows).toHaveLength(1);
    expect(await safetyEvents(s)).toEqual([]);
  });

  it('refuses a CapacityModel that is not what the engine derives, another engine version, or malformed data', async () => {
    const s = await session();
    await grantHealth(s);
    await push(s, [insert('screenings', screening())]);
    const genuine = record();
    const inflated = { ...genuine, capacity: { ...genuine.capacity, slots: genuine.capacity.slots.map((x) => (x.slot === 'horizontal_push' ? { ...x, exerciseId: 'archer_push_up', stepIndex: 6 } : x)) } };
    const otherEngine = { ...genuine, capacity: { ...genuine.capacity, engineVersion: '9.9.9' } };
    const inconsistent = { ...genuine, cappedByS1: true };
    const badVariant = { ...genuine, result: { ...genuine.result, tests: [done('push_reps', 'archer_push_up', { reps: 3 }), ...genuine.result.tests.slice(1)] } };
    expect(await push(s, [insert('assessments', inflated), insert('assessments', otherEngine), insert('assessments', inconsistent), insert('assessments', badVariant), insert('assessments', { nonsense: true })])).toEqual([
      'assessment.capacity_mismatch',
      'assessment.engine_version_unsupported',
      'assessment.invalid',
      'assessment.invalid',
      'assessment.invalid',
    ]);
  });

  it('S1: with an unresolved flag, a record stopped at RIR 2 is refused; at RIR 3 it is stored with its S1 safety event, in one transaction', async () => {
    const s = await session();
    await grantHealth(s);
    await push(s, [insert('screenings', screening(['heart_or_blood_pressure']))]);
    const before = (await safetyEvents(s)).length;
    expect(await push(s, [insert('assessments', record(2))])).toEqual(['safety.s1.assessment_reserve_too_low']);
    expect(await push(s, [insert('assessments', record(3))])).toEqual(['applied']);
    const events = (await safetyEvents(s)).slice(before);
    expect(events).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION }]);
  });

  it('no assessment for users the screening routes to professional guidance (S7)', async () => {
    const s = await session();
    await grantHealth(s);
    await push(s, [insert('screenings', screening(['pregnancy_or_recent_birth']))]);
    expect(await push(s, [insert('assessments', record(3))])).toEqual(['assessment.not_allowed']);
  });

  it('is erased with the other health collections when the health consent is withdrawn', async () => {
    const s = await session();
    await grantHealth(s);
    await push(s, [insert('screenings', screening()), insert('assessments', record())]);
    await h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(s.token), payload: { dataType: 'health', decision: 'withdrawn', version: 1, locale: 'en', jurisdiction: 'GB' } });
    const left = await h.database.db.select().from(syncChanges).where(eq(syncChanges.userId, s.userId));
    expect(left.filter((r) => r.collection === 'assessments')).toEqual([]);
  });
});
