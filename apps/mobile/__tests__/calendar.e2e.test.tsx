import { addDays } from '@fitadapt/engine';
import type { ProgramRecord, ReflowRecord } from '@fitadapt/shared';
import { guiltPhrases } from '@fitadapt/i18n';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr, visibleStrings } from './helpers';
import { appRoutes } from './routes';

/**
 * M08 end to end through the real root layout, router and on-device database
 * (sql.js stands in for expo-sqlite), with the network unavailable (goal
 * condition 5): P3 (David, fictional: intermediate, commercial gym, 3 × 45 min,
 * hypertrophy, often misses Fridays) builds his plan on the calendar screen,
 * sees the week, and reports that he cannot do Friday's session; the engine
 * moves it to Saturday on the device and the copy has no guilt language.
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

const programs = () => rows("SELECT data FROM sync_records WHERE collection = 'programs'").map((r) => JSON.parse(String(r[0])) as ProgramRecord);
const reflows = () => rows("SELECT data FROM sync_records WHERE collection = 'program_reflows'").map((r) => JSON.parse(String(r[0])) as ReflowRecord);

describe('P3 on the calendar, offline', () => {
  it('builds the plan, shows the week and moves the missed Friday session to Saturday on the device', async () => {
    await onboard({ goal: 'muscle_gain', birthYear: '1982', minutes: '45', experience: 'intermediate', equipment: [{ location: 'gym', ids: ['barbell', 'squat_rack', 'flat_bench', 'dumbbell', 'lat_pulldown', 'cable_station'] }] });
    press('first-workout-home');
    await screen.findByRole('header', { name: t('home.title') });
    press('open-calendar');
    await screen.findByRole('header', { name: t('calendar.title') });
    expect(app.getPathname()).toBe('/calendar');
    press('calendar-create');
    await screen.findByTestId('calendar-week-1');
    const [record] = programs();
    expect(record).toMatchObject({ reason: 'first', program: { goal: 'muscle_gain', trainingAge: 'intermediate', split: 'full_body', trainingDays: ['mon', 'wed', 'fri'] } });
    const week = record!.program.microcycles[0]!;
    for (const s of week.sessions) expect(screen.getByTestId(`calendar-session-${s.id}`)).toBeTruthy();
    const friday = week.sessions.find((s) => s.weekday === 'fri')!;

    press(`calendar-cant-${friday.id}`);
    expect(screen.getByTestId('calendar-message').props.children).toBe(t('calendar.reflow.shifted', { session: t('calendar.focus.full_body'), day: t('weekday.sat') }));
    const [reflow] = reflows();
    expect(reflow).toMatchObject({ programId: record!.program.programId, sessionId: friday.id, outcome: { kind: 'shifted' } });
    expect(reflow!.outcome).toEqual({ kind: 'shifted', toDate: addDays(friday.date, 1) });
    expect(screen.getByTestId(`calendar-day-${addDays(friday.date, 1)}`)).toBeTruthy();
    expect(screen.getByText(t('calendar.movedFrom', { day: t('weekday.fri') }))).toBeTruthy();
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'en')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
