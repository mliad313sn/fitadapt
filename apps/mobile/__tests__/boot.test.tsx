import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import RootLayout from '../app/_layout';
import Index from '../app/index';

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
    const router = renderRouter({ _layout: RootLayout, index: Index }, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
    expect(router.getPathname()).toBe('/');
  });
});
