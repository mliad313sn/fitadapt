import { ENGINE_VERSION, createEngineContext } from '@fitadapt/engine';
import { buildCapacityModel, generateSession } from '@fitadapt/exercise-library';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import type { AssessmentRecord } from '@fitadapt/shared';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr } from './helpers';
import { appRoutes } from './routes';

/**
 * M07 end to end through the real root layout, router and on-device database
 * (sql.js stands in for expo-sqlite), with the network unavailable: the
 * guided assessment runs offline (goal condition 1), shows and records the
 * L3 assessment notice, stops every test at the engine's reserve (goal
 * condition 3), stores the CapacityModel, and the first session shown is the
 * one generateSession() builds from it (goal condition 4, P1 and P5).
 * Personas are fictional (docs/specs/00-product-vision.md).
 */
let mockSql: SqlJsStatic;
let mockDb: Database;

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-GB', regionCode: 'GB' }] }));

const t = tr('en').t;
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
let app: ReturnType<typeof renderRouter>;
let fetchSpy: jest.SpyInstance;

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database();
  // Airplane mode: any network call fails (and is counted).
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => fetchSpy.mockRestore());

interface Persona {
  birthYear: string;
  minutes: string;
  experience: string;
  equipment: { location: 'home' | 'gym'; ids: string[] }[];
  yes?: string[];
}

async function onboard(p: Persona) {
  app = renderRouter(appRoutes, { initialUrl: '/' });
  await screen.findByRole('header', { name: t('ageGate.title') });
  fireEvent.changeText(screen.getByTestId('age-gate-day'), '14');
  fireEvent.changeText(screen.getByTestId('age-gate-month'), '3');
  fireEvent.changeText(screen.getByTestId('age-gate-year'), p.birthYear);
  press('age-gate-continue');
  await screen.findByRole('header', { name: t('home.title') });
  press('start-onboarding');
  await screen.findByRole('header', { name: t('onboarding.goals.title') });
  press('goal-primary-strength');
  press(`experience-${p.experience}`);
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.schedule.title') });
  press(`schedule-minutes-${p.minutes}`);
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.equipment.title') });
  for (const place of p.equipment) {
    press(`equipment-add-${place.location}`);
    for (const id of place.ids) press(`equipment-${place.location}-${id}`);
  }
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.healthConsent.title') });
  press('health-consent-agree');
  await screen.findByRole('header', { name: t('onboarding.about.title') });
  fireEvent.changeText(screen.getByTestId('about-birth-day'), '14');
  fireEvent.changeText(screen.getByTestId('about-birth-month'), '3');
  fireEvent.changeText(screen.getByTestId('about-birth-year'), p.birthYear);
  press('about-skip-measurements');
  await screen.findByRole('header', { name: t('screening.title') });
  for (const q of SCREENING_QUESTIONS) press(`screening-${q}-${p.yes?.includes(q) ? 'yes' : 'no'}`);
  press('onboarding-next');
  await screen.findByTestId(/^onboarding-result-/);
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.terms.title') });
  for (const doc of ['terms', 'privacy']) {
    press(`legal-${doc}-read`);
    press(`legal-${doc}-accept`);
  }
  press('onboarding-next');
  await screen.findByRole('header', { name: t('legal.exerciseRisk.v1.title') });
  press('onboarding-next');
  await screen.findByRole('header', { name: t('firstWorkout.title') });
}

const rows = (sql: string) => mockDb.exec(sql)[0]?.values ?? [];
const storedAssessments = () => rows("SELECT data FROM sync_records WHERE collection = 'assessments'").map((r) => JSON.parse(String(r[0])) as AssessmentRecord);
const kv = (key: string) => {
  const found = rows(`SELECT value FROM app_kv WHERE key = '${key}'`);
  return found.length ? JSON.parse(String(found[0]![0])) : [];
};

/** Opens the assessment from the first-workout screen and acknowledges the L3 notice. */
async function startAssessment(expectedProtocol: string) {
  press('first-workout-assess');
  await screen.findByRole('header', { name: t('assessment.title') });
  expect(app.getPathname()).toBe('/assessment');
  expect(screen.getByTestId(`assessment-protocol-${expectedProtocol}`).props.accessibilityState).toMatchObject({ checked: true });
  press('assessment-start');
  expect(screen.getByText(t('legal.notice.assessment.v1.body'))).toBeTruthy();
  press('notice-assessment-ack');
}

function enter(testId: string, m: { level?: string; value: string; load?: string; rir?: string }) {
  expect(screen.getByTestId(`assessment-test-${testId}`)).toBeTruthy();
  if (m.level) press(`assessment-level-${m.level}`);
  if (m.load) fireEvent.changeText(screen.getByTestId('assessment-load'), m.load);
  if (m.rir) press(`assessment-rir-${m.rir}`);
  fireEvent.changeText(screen.getByTestId('assessment-measure'), m.value);
  press('assessment-next');
}

describe('P1 (home, 120 kg beginner, 3 × 40 min): guided home assessment offline → CapacityModel → first session', () => {
  it('runs every test at RIR 2, records the notice, stores the capacity and builds the first session from it', async () => {
    await onboard({ birthYear: '1988', minutes: '40', experience: 'none', equipment: [{ location: 'home', ids: ['pull_up_bar', 'resistance_band', 'dumbbell'] }] });
    expect(screen.getByTestId('first-session-needs-assessment')).toBeTruthy();
    await startAssessment('home');

    // Every instruction stops at the reserve (never at failure); no S1 note for a cleared user.
    enter('push_reps', { level: 'incline_push_up_high', value: '8' });
    expect(screen.getByTestId('assessment-stop-reserve').props.children).toBe(t('assessment.stopRule.hold', { rpe: 8 }));
    expect(screen.queryByTestId('assessment-s1-note')).toBeNull();
    enter('dead_hang_hold', { value: '12' });
    enter('row_reps', { value: '0' }); // "0 pull-ups" is a result, not a failure
    enter('squat_reps', { value: '12' });
    enter('plank_hold', { level: 'knee_plank', value: '20' });

    await screen.findByRole('header', { name: t('assessment.result.title') });
    const [record] = storedAssessments();
    expect(record).toMatchObject({ reason: 'first', cappedByS1: false, result: { protocolId: 'home', stopRir: 2 }, capacity: { engineVersion: ENGINE_VERSION } });
    expect(record!.capacity).toEqual(buildCapacityModel(record!.result));
    expect(Object.fromEntries(record!.capacity.slots.map((s) => [s.slot, s.exerciseId]))).toMatchObject({ vertical_pull: 'dead_hang', horizontal_push: 'incline_push_up_high', squat: 'air_squat', core: 'knee_plank' });
    expect(within(screen.getByTestId('assessment-result-vertical_pull')).getByText(t('engine.reason.assessment.mapping.in_range'))).toBeTruthy();
    // L3: the assessment notice was shown and acknowledged, both in the device ledger and the defensibility buffer.
    expect(kv('legal_notice_impressions').filter((n: { noticeId: string }) => n.noticeId === 'assessment').map((n: { kind: string }) => n.kind)).toEqual(['shown', 'acknowledged']);

    press('assessment-to-session');
    await screen.findByTestId('first-session-plan');
    expect(app.getPathname()).toBe('/first-workout');
    const session = generateSession(
      { jointFlags: {}, history: [], recentLoads: [], birthDate: null, localDate: null, intensityLock: { locked: false, since: null }, capacity: record!.capacity, safetyProfile: evaluateStoredProfile(), equipment: ['pull_up_bar', 'resistance_band', 'dumbbell'], minutesAvailable: 40 },
      createEngineContext({ clock: { now: () => Date.now() }, seed: 1 }),
    );
    if (session.status !== 'ok') throw new Error('expected a plan');
    for (const e of session.plan.exercises) {
      expect(within(screen.getByTestId(`first-session-${e.slot}`)).getByText(t(`exercise.${e.exerciseId}.name` as never))).toBeTruthy();
    }
    expect(session.plan.exercises.map((e) => e.exerciseId)).toEqual(record!.capacity.slots.map((s) => s.exerciseId));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/** The SafetyProfile the device re-derives from its stored screening (M01 selector). */
function evaluateStoredProfile() {
  const { evaluateScreening } = jest.requireActual('@fitadapt/safety');
  const [screening] = rows("SELECT data FROM sync_records WHERE collection = 'screenings'").map((r) => JSON.parse(String(r[0])));
  return evaluateScreening(screening.responses);
}

describe('P5 (advanced powerlifter, gym, 4 × 75 min): submaximal load tests → e1RM → first-session loads', () => {
  it('stores RIR-adjusted Epley e1RMs and shows the loads generateSession derives from them', async () => {
    await onboard({ birthYear: '1997', minutes: '75', experience: 'advanced', equipment: [{ location: 'gym', ids: ['barbell', 'squat_rack', 'flat_bench', 'lat_pulldown', 'dumbbell'] }] });
    await startAssessment('gym');
    enter('squat_load', { level: 'barbell_back_squat', load: '160', value: '8', rir: '2' });
    enter('press_load', { level: 'barbell_bench_press', load: '110', value: '8', rir: '2' });
    enter('pulldown_load', { load: '80', value: '10', rir: '2' });
    enter('row_load', { level: 'barbell_row', load: '100', value: '8', rir: '2' });
    enter('hinge_load', { level: 'barbell_romanian_deadlift', load: '140', value: '6', rir: '2' });
    enter('plank_hold', { level: 'front_plank', value: '50' });

    await screen.findByRole('header', { name: t('assessment.result.title') });
    const [record] = storedAssessments();
    expect(record!.capacity.slots.find((s) => s.slot === 'squat')).toMatchObject({ exerciseId: 'barbell_back_squat', e1rmKg: 213.3, loadKg: 142.5 });
    expect(within(screen.getByTestId('assessment-result-squat')).getByText(t('assessment.result.load', { load: '142.5 kg' }))).toBeTruthy();

    press('assessment-to-session');
    await screen.findByTestId('first-session-plan');
    const session = generateSession(
      { jointFlags: {}, history: [], recentLoads: [], birthDate: null, localDate: null, intensityLock: { locked: false, since: null }, capacity: record!.capacity, safetyProfile: evaluateStoredProfile(), equipment: ['barbell', 'squat_rack', 'flat_bench', 'lat_pulldown', 'dumbbell'], minutesAvailable: 75 },
      createEngineContext({ clock: { now: () => Date.now() }, seed: 1 }),
    );
    if (session.status !== 'ok') throw new Error('expected a plan');
    const squat = session.plan.exercises.find((e) => e.slot === 'squat')!;
    expect(squat.sets[0]!.loadKg).toBe(132.5); // 213.3 / (1 + 13/30) × 0.9 = 133.9 → 132.5 (2.5 kg steps)
    expect(within(screen.getByTestId('first-session-squat')).getByText(`${t('firstWorkout.plan.reps', { sets: 2, min: 6, max: 10 })} ${t('firstWorkout.plan.load', { load: '132.5 kg' })}`)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('S1 on screen: a user with an unresolved screening flag (goal condition 3)', () => {
  it('sees every test stop at RIR 3 with the S1 note, and the S1 cap is logged', async () => {
    await onboard({ birthYear: '1988', minutes: '40', experience: 'beginner', equipment: [{ location: 'home', ids: ['pull_up_bar'] }], yes: ['chest_discomfort'] });
    await startAssessment('home');
    const reserveTexts: string[] = [];
    for (const [testId, value] of [
      ['push_reps', '5'],
      ['dead_hang_hold', '10'],
      ['row_reps', '0'],
      ['squat_reps', '10'],
      ['plank_hold', '15'],
    ] as const) {
      expect(screen.getByTestId('assessment-s1-note')).toBeTruthy();
      reserveTexts.push(String(screen.getByTestId('assessment-stop-reserve').props.children));
      enter(testId, { level: testId === 'push_reps' ? 'wall_push_up' : testId === 'plank_hold' ? 'knee_plank' : undefined, value });
    }
    expect(reserveTexts).toEqual([
      t('assessment.stopRule.reps', { rir: 3 }),
      t('assessment.stopRule.hold', { rpe: 7 }),
      t('assessment.stopRule.reps', { rir: 3 }),
      t('assessment.stopRule.reps', { rir: 3 }),
      t('assessment.stopRule.hold', { rpe: 7 }),
    ]);
    await screen.findByRole('header', { name: t('assessment.result.title') });
    expect(storedAssessments()[0]).toMatchObject({ cappedByS1: true, result: { stopRir: 3 } });
    const events = kv('defensibility_device_log') as { type: string; payload: { invariant?: string; reasonCode?: string } }[];
    expect(events.filter((e) => e.type === 'safety.event').map((e) => e.payload)).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION }]);
  });

  it('the stop control is always visible and leaves without saving (L4)', async () => {
    await onboard({ birthYear: '1988', minutes: '40', experience: 'beginner', equipment: [{ location: 'home', ids: ['pull_up_bar'] }] });
    await startAssessment('home');
    expect(screen.getByTestId('assessment-stop')).toBeTruthy();
    press('assessment-discomfort');
    expect(screen.getByTestId('assessment-discomfort-note')).toBeTruthy();
    press('assessment-next');
    expect(screen.getByTestId('assessment-test-dead_hang_hold')).toBeTruthy();
    press('assessment-stop');
    await screen.findByRole('header', { name: t('home.title') });
    expect(storedAssessments()).toEqual([]);
    act(() => router.push('/assessment'));
    await screen.findByRole('header', { name: t('assessment.title') });
  });
});
