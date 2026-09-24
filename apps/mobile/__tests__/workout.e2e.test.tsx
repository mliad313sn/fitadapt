import { ENGINE_VERSION, SESSION_RULES_VERSION } from '@fitadapt/engine';
import { guiltPhrases } from '@fitadapt/i18n';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import type { ExecutionLog, SetLog, WorkoutSessionRecord } from '@fitadapt/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr, visibleStrings } from './helpers';
import { appRoutes } from './routes';

/**
 * M02 end to end through the real root layout, router and on-device database
 * (sql.js stands in for expo-sqlite), with the network unavailable (goal
 * condition 6): P3 (David, fictional: intermediate, commercial gym, 3 × 45
 * min) builds his plan, then on Monday opens today's session from the home
 * screen, acknowledges the first-workout notice (L3), starts, logs sets in
 * two taps (reps, then reps in reserve), swaps an exercise, skips one, flags
 * pain and finishes. Every record lands in the on-device outbox (append-only
 * set logs), and the device defensibility buffer holds "prescription issued"
 * with the engine and rules versions (L11). Nothing touches the network.
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

const WED = '2026-09-23T10:00:00.000Z';
const MON = '2026-09-28T10:00:00.000Z';

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
});

interface Persona {
  goal: string;
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
  press(`goal-primary-${p.goal}`);
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
  // FIX-B: the country of residence is asked explicitly.
  press('residence-GB');
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
  // FIX-B: each exercise-risk statement is ticked on its own.
  for (const s of ['risk', 'stop', 'honest', 'control']) press(`risk-statement-${s}`);
  press('onboarding-next');
  await screen.findByRole('header', { name: t('firstWorkout.title') });
}

const rows = (sql: string) => mockDb.exec(sql)[0]?.values ?? [];
/** The records of a collection, in the order they were written (outbox order). */
const records = <T,>(collection: string) =>
  rows('SELECT mutation FROM sync_outbox ORDER BY seq')
    .map((r) => JSON.parse(String(r[0])) as { collection: string; data: T })
    .filter((m) => m.collection === collection)
    .map((m) => m.data);
const deviceLog = () => JSON.parse(String(rows("SELECT value FROM app_kv WHERE key = 'defensibility_device_log'")[0]?.[0] ?? '[]')) as { type: string; payload: Record<string, unknown> }[];

/** Two taps: reps (the top of the range, or the hold), then reps in reserve. */
function logSet(rir: number) {
  const target = screen.getByTestId('workout-target');
  const numbers = String(target.props.children[0] ?? target.props.children).match(/\d+/g)!.map(Number);
  press(`workout-reps-${numbers.length > 1 ? numbers[1] : numbers[0]}`);
  press(`workout-rir-${rir}`);
}

describe('P3 runs today’s session, offline', () => {
  it('opens, logs in two taps, swaps, skips, flags pain and finishes; all on the device', async () => {
    jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
    await onboard({ goal: 'muscle_gain', birthYear: '1982', minutes: '45', experience: 'intermediate', equipment: [{ location: 'gym', ids: ['barbell', 'squat_rack', 'flat_bench', 'dumbbell', 'lat_pulldown', 'cable_station'] }] });
    press('first-workout-home');
    await screen.findByRole('header', { name: t('home.title') });
    press('open-calendar');
    await screen.findByRole('header', { name: t('calendar.title') });
    press('calendar-create');
    await screen.findByTestId('calendar-week-1');
    press('calendar-back');
    await screen.findByRole('header', { name: t('home.title') });

    // Monday of week 1.
    jest.setSystemTime(new Date(MON));
    press('open-workout');
    await screen.findByRole('header', { name: t('workout.title') });
    expect(app.getPathname()).toBe('/workout');
    // L3: the first-workout notice before the first session.
    expect(screen.getByTestId('notice-first_workout')).toBeTruthy();
    press('notice-first_workout-ack');
    press('workout-start');
    await screen.findByTestId('workout-phase-set');

    const [record] = records<WorkoutSessionRecord>('workout_sessions');
    expect(record!.plan).toMatchObject({ kind: 'program_session', engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION });
    expect(record!.plan.exercises.every((e) => e.sets.every((s) => s.reasonCodes.length > 0))).toBe(true);
    expect(deviceLog().filter((e) => e.type === 'prescription.issued')).toMatchObject([{ payload: { prescriptionId: record!.plan.planId, engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION } }]);

    logSet(2);
    press('workout-skip'); // skip the rest
    press('workout-swap');
    fireEvent.press(screen.getAllByTestId(/^workout-swap-option-/)[0]!);
    logSet(3);
    press('workout-skip');
    press('workout-skip-exercise');
    press('workout-pain');
    press('workout-pain-joint-lumbar');
    press('workout-pain-score-7');
    press('workout-pain-save');
    expect(screen.getByTestId('workout-message')).toBeTruthy();
    logSet(2);
    for (let guard = 0; guard < 60 && !screen.queryByTestId('workout-done'); guard++) press('workout-skip');
    expect(screen.getByTestId('workout-done')).toBeTruthy();

    const sets = records<SetLog>('set_logs');
    expect(sets.filter((s) => s.set.status === 'done')).toHaveLength(3);
    expect(sets.every((s) => s.planId === record!.plan.planId)).toBe(true);
    const kinds = records<ExecutionLog>('execution_logs').map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['swapped', 'exercise_skipped', 'pain', 'ended']));
    expect(kinds.at(-1)).toBe('ended');
    // Append-only: nothing in the outbox is an update or a delete of a session record.
    expect(rows("SELECT count(*) FROM sync_records WHERE collection IN ('workout_sessions','set_logs','execution_logs')")[0]![0]).toBe(1 + sets.length + kinds.length);
    const mutations = rows('SELECT mutation FROM sync_outbox').map((r) => JSON.parse(String(r[0])) as { collection: string; op: string });
    const session = mutations.filter((m) => ['workout_sessions', 'set_logs', 'execution_logs'].includes(m.collection));
    expect(session.length).toBe(1 + sets.length + kinds.length);
    expect(new Set(session.map((m) => m.op))).toEqual(new Set(['insert']));
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'en')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    press('workout-back');
    await screen.findByRole('header', { name: t('home.title') });
  }, 60_000);
});
