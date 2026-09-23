import { act, fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Index from '../app/index';
import Library from '../app/library';
import Privacy from '../app/privacy';

/**
 * Goal condition 6: the age gate blocks users under 16, end to end through the
 * real root layout and router, with the on-device database (sql.js stands in
 * for expo-sqlite). The same flow is scripted for devices in e2e/age-gate.yaml.
 */
let mockSql: SqlJsStatic;
let mockDb: Database;
let mockLanguage = 'en-GB';

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: mockLanguage, regionCode: 'SN' }] }));

const routes = { _layout: RootLayout, index: Index, 'age-gate': AgeGate, privacy: Privacy, library: Library };

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database(); // a fresh install
  mockLanguage = 'en-GB';
});

/** Local calendar date `years` years before today, shifted by `days`. */
function birthDate(years: number, days = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear() - years, now.getMonth(), now.getDate() + days);
  return { day: String(d.getDate()), month: String(d.getMonth() + 1), year: String(d.getFullYear()) };
}

function enter(date: { day: string; month: string; year: string }, button = 'Continue') {
  fireEvent.changeText(screen.getByTestId('age-gate-day'), date.day);
  fireEvent.changeText(screen.getByTestId('age-gate-month'), date.month);
  fireEvent.changeText(screen.getByTestId('age-gate-year'), date.year);
  fireEvent.press(screen.getByRole('button', { name: button }));
}

const launch = (url = '/') => renderRouter(routes, { initialUrl: url });

describe('age gate at 16 (E2E, goal condition 6)', () => {
  it('opens on the age gate: nothing else is reachable before it', async () => {
    launch('/');
    expect(await screen.findByRole('header', { name: 'Before you start' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Welcome' })).toBeNull();
    act(() => router.push('/privacy'));
    expect(screen.queryByRole('header', { name: 'Privacy' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Before you start' })).toBeTruthy();
  });

  it('blocks a user who turns 16 tomorrow, and keeps blocking after a relaunch', async () => {
    launch('/');
    await screen.findByRole('header', { name: 'Before you start' });
    enter(birthDate(16, 1));
    expect(await screen.findByRole('header', { name: 'This app is not available to you yet' })).toBeTruthy();
    expect(screen.getByText('You need to be 16 or older to use this app. Thank you for your interest.')).toBeTruthy();
    // No way forward: no form, no button, and navigation cannot reach the app.
    expect(screen.queryByRole('button')).toBeNull();
    act(() => router.push('/'));
    act(() => router.push('/privacy'));
    expect(screen.queryByRole('header', { name: 'Welcome' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Privacy' })).toBeNull();

    screen.unmount();
    launch('/');
    expect(await screen.findByRole('header', { name: 'This app is not available to you yet' })).toBeTruthy();
    expect(screen.queryByTestId('age-gate-year')).toBeNull();
  });

  it('blocks a 13-year-old', async () => {
    launch('/');
    await screen.findByRole('header', { name: 'Before you start' });
    enter(birthDate(13));
    expect(await screen.findByRole('header', { name: 'This app is not available to you yet' })).toBeTruthy();
  });

  it('lets a user in on their 16th birthday, and remembers it on the next launch', async () => {
    const router = launch('/');
    await screen.findByRole('header', { name: 'Before you start' });
    enter(birthDate(16));
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
    expect(router.getPathname()).toBe('/');

    screen.unmount();
    launch('/');
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
  });

  it('rejects impossible and future dates without deciding', async () => {
    launch('/');
    await screen.findByRole('header', { name: 'Before you start' });
    enter({ day: '31', month: '2', year: '2000' });
    expect(screen.getByText('Please enter a real date.')).toBeTruthy();
    enter({ day: 'x', month: '1', year: '2000' });
    expect(screen.getByText('Please enter a real date.')).toBeTruthy();
    const future = birthDate(-1);
    enter(future);
    expect(screen.getByText('This date is in the future.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Before you start' })).toBeTruthy();
    // Still undecided: an adult can then pass.
    enter(birthDate(40));
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
  });

  it('never stores the date of birth, only the outcome', async () => {
    launch('/');
    await screen.findByRole('header', { name: 'Before you start' });
    const dob = birthDate(30);
    enter(dob);
    await screen.findByRole('header', { name: 'Welcome' });
    const rows = mockDb.exec('SELECT key, value FROM app_kv')[0]?.values ?? [];
    expect(rows).toEqual([['age_gate_status', 'allowed']]);
    const dump = JSON.stringify(mockDb.exec("SELECT * FROM sqlite_master WHERE type = 'table'"));
    expect(dump).not.toContain(dob.year);
  });

  it('is shown in French on a French device', async () => {
    mockLanguage = 'fr-SN';
    launch('/');
    expect(await screen.findByRole('header', { name: 'Avant de commencer' })).toBeTruthy();
    enter(birthDate(15), 'Continuer');
    expect(await screen.findByRole('header', { name: 'Cette application ne vous est pas encore accessible' })).toBeTruthy();
  });
});
