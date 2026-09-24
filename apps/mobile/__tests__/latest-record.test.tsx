import { EQUIPMENT_PRESETS } from '@fitadapt/exercise-library';
import { hasConsent } from '@fitadapt/privacy';
import { evaluateScreening, isAtLeastAsStrict } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type ConsentRecord, type ScreeningQuestionId, type ScreeningResponses } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { runAccountSync, UploadLedger, type AccountApi } from '../src/account/account-sync';
import { buildNutritionInput } from '../src/nutrition/nutrition-input';
import { currentNutrition } from '../src/nutrition/NutritionProvider';
import { createNutritionStore, latestPlan, orderPlans, type NutritionSettings, type StoredPlan } from '../src/nutrition/nutrition-store';
import { createConsentStore } from '../src/privacy/consents';
import { latestAssessment, latestProgram } from '../src/profile/history';
import { createProfileStore, type StoredAssessment, type StoredProgram } from '../src/profile/profile-store';
import { selectIntensityLock, selectJointFlags, selectReadiness, selectRescreen, selectSafetyProfile } from '../src/profile/selectors';
import { MemoryKeyValueStore } from '../src/storage/app-state';

/**
 * FIX-latest-record-ordering (ADR-023) on the device: a device clock that
 * goes backwards, two saves in one millisecond, records from a second device
 * and shuffled arrival never make an older, looser record the latest.
 * Fictional users only.
 */

// Property runs are CPU-bound; the whole workspace runs in parallel (fresh-clone gate).
jest.setTimeout(120_000);

const START = Date.parse('2026-09-24T12:00:00.000Z');
const TODAY = '2026-09-24';

function answers(yes: ScreeningQuestionId[] = []) {
  return Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])) as ScreeningResponses['answers'];
}

/** A device whose clock the test moves (forwards, backwards or not at all). */
function device(server = new SyncServer({ store: new MemoryServerStore() })) {
  let clock = START;
  const now = () => new Date(clock);
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(server, 'user-1'), newId: randomUUID, now });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB', now });
  const profile = createProfileStore({ sync: client, kv, now });
  let seed = 0;
  const nutrition = createNutritionStore({ sync: client, kv, now, newSeed: () => ++seed });
  return {
    server,
    client,
    consents,
    profile,
    nutrition,
    setClock: (ms: number) => {
      clock = ms;
    },
    screen(yes: ScreeningQuestionId[]) {
      profile.getState().updateDraft({ answers: answers(yes) });
      profile.getState().saveScreening('annual', { year: 2026, month: 9, day: 24 });
    },
  };
}

function onboard(d: ReturnType<typeof device>) {
  d.consents.getState().decide('health', true, 'en');
  d.profile.getState().saveEquipment('home', [...EQUIPMENT_PRESETS.home_basic]);
  d.profile.getState().updateDraft({
    primaryGoal: 'fat_loss',
    experience: 'beginner',
    schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1988, month: 3, day: 14 },
    biometrics: { heightCm: 178, weightKg: 120, bodyFatPercent: null },
    answers: answers(),
  });
  d.profile.getState().saveProfileFromDraft();
}

const idOf = (x: { id: string } | null) => x?.id;
const safety = (d: ReturnType<typeof device>) => selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records);

describe('screenings on the device (S1/S4/S7)', () => {
  it('the PO case: a re-screen in the same millisecond that advises against calorie restriction switches deficit features off', () => {
    const d = device();
    onboard(d);
    d.screen([]);
    d.screen(['advised_against_calorie_restriction']);
    expect(safety(d).deficitNutritionAllowed).toBe(false);
    const [first, second] = d.profile.getState().screenings;
    expect(first!.data.supersedes).toEqual([]);
    expect(second!.data.supersedes).toEqual([first!.id]);
  });

  it('a clock moved back: the newer, stricter screening dated earlier still counts; the re-screen falls due from it', () => {
    const d = device();
    onboard(d);
    d.screen([]);
    d.setClock(START - 30 * 86_400_000);
    d.screen(['pregnancy_or_recent_birth']);
    const p = safety(d);
    expect(p.specialPopulation).toBe('pregnancy_postpartum');
    expect(p.automaticProgrammingAllowed).toBe(false);
    expect(d.profile.getState().screenings.map((s) => s.data.responses.answers.pregnancy_or_recent_birth)).toEqual(['no', 'yes']);
    expect(selectRescreen(d.profile.getState().screenings, null, new Date(START))).toMatchObject({ status: 'current', dueAt: '2027-08-25T12:00:00.000Z' });
  });

  it('two devices re-screening offline: after sync both devices derive the same profile, never looser than either; the next screening settles it', async () => {
    const server = new SyncServer({ store: new MemoryServerStore() });
    const a = device(server);
    onboard(a);
    a.screen([]);
    await a.client.sync();
    const b = device(server);
    b.consents.getState().decide('health', true, 'en');
    await b.client.sync();
    b.profile.getState().reload();
    b.profile.getState().updateDraft({ birthDate: { year: 1988, month: 3, day: 14 } });
    // Both offline: A reports being advised against calorie restriction, B a bone/joint problem.
    a.screen(['advised_against_calorie_restriction']);
    b.screen(['bone_joint_back']);
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();
    a.profile.getState().reload();
    b.profile.getState().reload();
    const pa = safety(a);
    expect(safety(b)).toEqual(pa);
    expect(pa.deficitNutritionAllowed).toBe(false);
    expect(pa.impactCeiling).not.toBe('high');
    expect(pa.reasonCodes).toContain('safety_profile.ambiguous_latest');
    expect(isAtLeastAsStrict(pa, evaluateScreening(a.profile.getState().screenings.at(-1)!.data.responses))).toBe(true);
    a.screen([]);
    expect(a.profile.getState().screenings.at(-1)!.data.supersedes).toHaveLength(2);
    expect(safety(a).reasonCodes).toEqual(['safety_profile.cleared']);
  });
});

describe('consents on the device', () => {
  it('a withdrawal made with the clock moved back is never overtaken by the older grant, on the device or once uploaded in order', async () => {
    let t = START;
    const consents = createConsentStore({ kv: new MemoryKeyValueStore(), newId: randomUUID, jurisdiction: 'GB', now: () => new Date(t) });
    const grant = consents.getState().decide('health', true, 'en');
    t = START - 3_600_000;
    const withdrawal = consents.getState().decide('health', false, 'en');
    expect(withdrawal.supersedes).toEqual([grant.id]);
    expect(hasConsent(consents.getState().records, 'health')).toBe(false);
    const sent: ConsentRecord[] = [];
    const api: AccountApi = { postConsent: async (r) => void sent.push(r), postAcceptance: async () => undefined, postNotice: async () => undefined };
    const sync = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'u'), newId: randomUUID });
    await runAccountSync({ api, ledger: new UploadLedger(new MemoryKeyValueStore()), consents: consents.getState().records, acceptances: [], notices: [], sync });
    expect(sent.map((r) => r.id)).toEqual([grant.id, withdrawal.id]);
  });
});

describe('execution events and readiness checks carry their links (S2, S3)', () => {
  it('S3: a red flag logged with the clock moved back behind an older attestation stays locked until an attestation names it', () => {
    const d = device();
    onboard(d);
    const log = d.profile.getState().logExecution;
    log({ kind: 'red_flag', planId: null, symptom: 'fainting', at: new Date(START).toISOString() });
    log({ kind: 'medical_review_attested', at: new Date(START + 10_000).toISOString(), statementVersion: 1 });
    expect(selectIntensityLock(d.profile.getState().executionLogs).locked).toBe(false);
    log({ kind: 'red_flag', planId: null, symptom: 'palpitations', at: new Date(START + 5_000).toISOString() });
    const events = d.profile.getState().executionLogs;
    expect(events.map((e) => e.data.kind)).toEqual(['red_flag', 'red_flag', 'medical_review_attested']);
    expect(selectIntensityLock(events)).toEqual({ locked: true, since: new Date(START + 5_000).toISOString() });
    log({ kind: 'medical_review_attested', at: new Date(START + 1_000).toISOString(), statementVersion: 1 });
    const flags = d.profile.getState().executionLogs.filter((e) => e.data.kind === 'red_flag').map((e) => e.id);
    expect(d.profile.getState().executionLogs.every((e) => e.data.kind !== 'red_flag' || (e.data as { eventId?: string }).eventId === e.id)).toBe(true);
    const last = d.profile.getState().executionLogs.find((e) => e.data.kind === 'medical_review_attested' && e.data.at === new Date(START + 1_000).toISOString())!;
    expect((last.data as { attests?: string[] }).attests).toEqual([flags.find((id) => id !== flags[0])]);
    expect(selectIntensityLock(d.profile.getState().executionLogs)).toEqual({ locked: false, since: null });
  });

  it('S2: a red knee logged with the clock moved back is not cleared by an older green report of another session', () => {
    const d = device();
    onboard(d);
    const log = d.profile.getState().logExecution;
    log({ kind: 'pain', planId: randomUUID(), joint: 'knee', score: 1, at: new Date(START + 10_000).toISOString(), phase: 'during' });
    log({ kind: 'pain', planId: randomUUID(), joint: 'knee', score: 7, at: new Date(START).toISOString(), phase: 'during' });
    expect(selectJointFlags(d.profile.getState().executionLogs).knee).toBe('red');
    const [red, green] = d.profile.getState().executionLogs;
    expect(red!.data).toMatchObject({ score: 7, after: [green!.id], eventId: red!.id });
  });

  it('readiness: a re-check with the clock moved back replaces the earlier check of the day', () => {
    const d = device();
    onboard(d);
    const check = (at: number, low: boolean) =>
      d.profile.getState().logReadiness({ schemaVersion: 1, date: TODAY, at: new Date(at).toISOString(), ...(low ? { sleep: 1, soreness: 5, stress: 5, energy: 1 } : { sleep: 5, soreness: 1, stress: 1, energy: 5 }), wearable: null });
    check(START, true);
    check(START - 60_000, false);
    expect(selectReadiness(d.profile.getState().readinessChecks.map((c) => c.data), TODAY)).toBe('normal');
    check(START - 120_000, true);
    expect(selectReadiness(d.profile.getState().readinessChecks.map((c) => c.data), TODAY)).toBe('reduced');
  });
});

describe('programs and assessments: chain heads, fail closed on a fork', () => {
  it('a fork of assessments picks the most conservative starting point; a fork of programs the one made on the strictest profile', () => {
    const slot = (stepIndex: number, loadKg: number | null) => ({ slot: 'squat', ladderId: 'l', exerciseId: 'e', stepIndex, testId: null, e1rmKg: null, loadKg, target: { kind: 'reps', min: 8, max: 12 }, reasonCodes: ['x'] });
    const assessment = (id: string, slots: ReturnType<typeof slot>[], supersedes: string[]) => ({ id, data: { capacity: { assessedAt: new Date(START).toISOString(), slots }, supersedes } }) as unknown as StoredAssessment;
    const heavy = assessment('b', [slot(3, 40)], ['root']);
    const light = assessment('c', [slot(3, 20)], ['root']);
    const lower = assessment('d', [slot(1, 60)], ['root']);
    const root = assessment('root', [slot(0, 0)], []);
    expect(idOf(latestAssessment([root, heavy, light]))).toBe('c');
    expect(idOf(latestAssessment([lower, root, heavy, light]))).toBe('d');
    expect(idOf(latestAssessment([root]))).toBe('root');
    expect(latestAssessment([])).toBeNull();
    const open = evaluateScreening({ answers: answers(), clearanceAttested: false, birthDate: { year: 1988, month: 3, day: 14 }, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });
    const strict = evaluateScreening({ answers: answers(['chest_discomfort']), clearanceAttested: false, birthDate: { year: 1988, month: 3, day: 14 }, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });
    const program = (id: string, profile: typeof open, at: number) => ({ id, data: { input: { safetyProfile: profile }, program: { generatedAt: new Date(START + at).toISOString() }, supersedes: [] } }) as unknown as StoredProgram;
    for (const list of [
      [program('p1', strict, 0), program('p2', open, 5000)],
      [program('p2', open, 5000), program('p1', strict, 0)],
    ])
      expect(idOf(latestProgram(list))).toBe('p1');
  });
});

// --------------------------------------------------------------------------- S4: nutrition plans

const NUMERIC: NutritionSettings = { schemaVersion: 1, goal: 'fat_loss', trackingStyle: 'numbers', activityLevel: 'light', sexForEstimate: 'unspecified', plannedLossPercentPerWeek: 0.5, goalWeightKg: null, heightCm: null };
const OPEN = evaluateScreening({ answers: answers(), clearanceAttested: false, birthDate: { year: 1988, month: 3, day: 14 }, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });
const NO_DEFICIT = evaluateScreening({ answers: answers(['advised_against_calorie_restriction']), clearanceAttested: false, birthDate: { year: 1988, month: 3, day: 14 }, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });

function recordPlans(d: ReturnType<typeof device>, steps: readonly { deficitOff: boolean; clock: number }[]) {
  const profile = d.profile.getState().profile!;
  for (const s of steps) {
    d.setClock(START + s.clock);
    const input = buildNutritionInput({ settings: NUMERIC, profile, safetyProfile: s.deficitOff ? NO_DEFICIT : OPEN, bodyMetrics: [], intakeLogs: [], guardrailEvents: [], previous: latestPlan(d.nutrition.getState().plans)?.data ?? null, today: TODAY });
    d.nutrition.getState().recordPlan(input, 'settings_changed');
  }
  return d.nutrition.getState().plans;
}
const shown = (d: ReturnType<typeof device>, plans: readonly StoredPlan[], safetyProfile: typeof OPEN) =>
  currentNutrition({ profile: d.profile.getState().profile, safetyProfile, bodyMetrics: [], settings: NUMERIC, plans: [...plans], intakeLogs: [], guardrailEvents: [], today: TODAY, now: () => START });
const noDeficit = (r: ReturnType<typeof shown>) => r.result!.target.energy === null || r.result!.target.energy.deficitKcal === 0;

describe('S4: nutrition plans follow their chain, never the clock (fast-check)', () => {
  const arbSteps = fc.array(fc.record({ deficitOff: fc.boolean(), clock: fc.integer({ min: -3, max: 3 }).map((s) => s * 1000) }), { minLength: 1, maxLength: 5 });

  it('any clock (equal or backwards), any arrival order: the plan written last counts, and the screen never shows a deficit the current SafetyProfile forbids', () => {
    fc.assert(
      fc.property(arbSteps, fc.infiniteStream(fc.nat()), (steps, seeds) => {
        const d = device();
        onboard(d);
        const plans = recordPlans(d, steps);
        const last = plans.find((p) => !plans.some((o) => o.data.supersedes === p.data.target.targetId))!;
        const shuffled = plans.map((p) => ({ p, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((x) => x.p);
        expect(latestPlan(shuffled)?.data.target.targetId).toBe(last.data.target.targetId);
        expect(orderPlans(shuffled).map((p) => p.data.target.targetId)).toEqual(plans.map((p) => p.data.target.targetId));
        const current = steps.at(-1)!.deficitOff ? NO_DEFICIT : OPEN;
        const view = shown(d, shuffled, current);
        expect(view.stored).toBe(true);
        if (current.deficitNutritionAllowed === false) expect(noDeficit(view)).toBe(true);
        // A stricter profile than the stored plan's is never outrun by it.
        const stricter = shown(d, shuffled, NO_DEFICIT);
        expect(noDeficit(stricter)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('two devices planning without knowing each other: no stored plan is shown; a new plan names both', async () => {
    const server = new SyncServer({ store: new MemoryServerStore() });
    const a = device(server);
    onboard(a);
    const b = device(server);
    onboard(b);
    recordPlans(a, [{ deficitOff: false, clock: 0 }]);
    recordPlans(b, [{ deficitOff: true, clock: -5000 }]);
    const both = [...a.nutrition.getState().plans, ...b.nutrition.getState().plans];
    expect(latestPlan(both)).toBeNull();
    const view = shown(a, both, NO_DEFICIT);
    expect(view.stored).toBe(false);
    expect(noDeficit(view)).toBe(true);
    await b.client.sync();
    await a.client.sync();
    a.nutrition.getState().reload();
    expect(a.nutrition.getState().plans).toHaveLength(2);
    recordPlans(a, [{ deficitOff: true, clock: -9000 }]);
    const merged = a.nutrition.getState().plans;
    expect(merged.at(-1)!.data.supersedes).toHaveLength(2);
    expect(latestPlan(merged)?.data.target.targetId).toBe(merged.at(-1)!.data.target.targetId);
  });
});
