import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Index from '../app/index';
import Library from '../app/library';
import Privacy from '../app/privacy';

let mockSql: SqlJsStatic;

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(new mockSql.Database());
  },
}));

// jest-expo stubs native modules; give the app a real UUID source.
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-GB' }],
}));

beforeAll(async () => {
  mockSql = await initSqlJs();
});

describe('app boot', () => {
  it('mounts the root layout and routes to the home screen', async () => {
    const router = renderRouter({ _layout: RootLayout, index: Index, 'age-gate': AgeGate, privacy: Privacy, library: Library }, { initialUrl: '/' });
    // M17: a fresh install opens on the S7 age gate (see age-gate.e2e.test.tsx); pass it as an adult.
    await screen.findByRole('header', { name: 'Before you start' });
    fireEvent.changeText(screen.getByTestId('age-gate-day'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-month'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-year'), '1990');
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
    expect(router.getPathname()).toBe('/');
  });
});
