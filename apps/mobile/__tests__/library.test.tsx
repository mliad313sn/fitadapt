import { SEED_EXERCISES, seedLibrary } from '@fitadapt/exercise-library';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { drizzle } from 'drizzle-orm/sql-js';
import { sql } from 'drizzle-orm';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Index from '../app/index';
import Library from '../app/library';
import Privacy from '../app/privacy';
import { AppProviders } from '../src/AppProviders';
import { LibraryStore } from '../src/library/library-store';
import { LibraryScreen } from '../src/screens/LibraryScreen';
import { SqliteKeyValueStore, wipeLocalDatabase } from '../src/storage/app-state';
import { createDeviceSyncClient } from '../src/sync/device';
import { memoryClient } from './helpers';
import { m01Routes } from './routes';

/**
 * Goal condition (5): the library is available offline in SQLite on the
 * device; search and filter by pattern, muscle and equipment work.
 * sql.js stands in for expo-sqlite (same SQL, same Drizzle driver family).
 */
let SQL: SqlJsStatic;
let mockSql: SqlJsStatic;

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle: d } = jest.requireActual('drizzle-orm/sql-js');
    return d(new mockSql.Database());
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-GB' }] }));

beforeAll(async () => {
  SQL = await initSqlJs();
  mockSql = SQL;
});

function freshStore() {
  const db = drizzle(new SQL.Database());
  const store = new LibraryStore(db, seedLibrary(), () => '2026-09-23T10:00:00.000Z');
  store.install();
  return { db, store };
}

function renderLibrary(locale: 'en' | 'fr', store: LibraryStore) {
  return render(
    <AppProviders syncClient={memoryClient().client} initialLocale={locale}>
      <LibraryScreen store={store} />
    </AppProviders>,
  );
}

const visibleIds = () =>
  screen
    .queryAllByTestId(/^exercise-/)
    .map((n) => String(n.props.testID).slice('exercise-'.length))
    .sort();

describe('offline library in SQLite', () => {
  it('installs the whole seed into the device database once, and reinstalls only when the content changes', () => {
    const { db, store } = freshStore();
    expect(store.count()).toBe(SEED_EXERCISES.length);
    expect(store.installedHash()).toBe(seedLibrary().contentHash);
    expect(store.install()).toBe(false);
    const edges = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM library_edge`)!.n;
    expect(edges).toBe(seedLibrary().edges.filter((e) => e.type !== 'REQUIRES').length);
    expect(store.getExercise('push_up')).toEqual(seedLibrary().byId.get('push_up'));
    expect(store.getExercise('nope')).toBeUndefined();
    // A stale copy is replaced; favourites survive the refresh.
    store.setFavourite('push_up', true);
    db.run(sql`UPDATE library_meta SET value = 'stale' WHERE key = 'content_hash'`);
    db.run(sql`DELETE FROM library_exercise WHERE id = 'pull_up'`);
    expect(store.install()).toBe(true);
    expect(store.count()).toBe(SEED_EXERCISES.length);
    expect(store.favourites()).toEqual(['push_up']);
  });

  it('reads from SQLite with no network at all (airplane mode)', () => {
    const fetchSpy = jest.fn(() => Promise.reject(new Error('offline')));
    const saved = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { db, store } = freshStore();
      renderLibrary('en', store);
      expect(visibleIds()).toHaveLength(SEED_EXERCISES.length);
      // The screen shows what is in the database, not the bundle.
      db.run(sql`DELETE FROM library_search WHERE exercise_id = 'push_up'`);
      expect(store.search({ locale: 'en' }).map((r) => r.id)).not.toContain('push_up');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = saved;
    }
  });

  it('searches by name in English and in French (accents ignored)', () => {
    const { store } = freshStore();
    renderLibrary('en', store);
    fireEvent.changeText(screen.getByLabelText('Search exercises'), 'incline push');
    expect(visibleIds()).toEqual(['incline_push_up_high', 'incline_push_up_low']);
    screen.unmount();
    renderLibrary('fr', store);
    fireEvent.changeText(screen.getByLabelText('Chercher un exercice'), 'pompe inclinee');
    expect(visibleIds()).toEqual(['incline_push_up_high', 'incline_push_up_low']);
    expect(screen.getByText('Pompe inclinée haute')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Chercher un exercice'), 'zzzz');
    expect(screen.getByText('Aucun exercice ne correspond à ces filtres. Essayez d’en retirer un.')).toBeTruthy();
    expect(screen.getByTestId('library-count')).toHaveTextContent('Aucun exercice ne correspond');
  });

  it('filters by movement pattern, muscle and equipment, and combines them', () => {
    const { store } = freshStore();
    const lib = seedLibrary();
    renderLibrary('en', store);

    fireEvent.press(screen.getByRole('togglebutton', { name: 'Vertical pull' }));
    const pulls = lib.exercises.filter((e) => e.pattern === 'vertical_pull').map((e) => e.id).sort();
    expect(visibleIds()).toEqual(pulls);
    expect(screen.getByRole('togglebutton', { name: 'Vertical pull' }).props.accessibilityState).toMatchObject({ selected: true });

    // Equipment: only what a pull-up bar and a band allow (P2 at home).
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Pull-up bar' }));
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Resistance band' }));
    const home = visibleIds();
    expect(home).toEqual(expect.arrayContaining(['band_assisted_pull_up', 'pull_up', 'dead_hang', 'prone_floor_pulldown', 'band_lat_pulldown']));
    expect(home).not.toContain('lat_pulldown');
    expect(home).not.toContain('ring_muscle_up');
    for (const id of home) expect(lib.byId.get(id)!.equipment.every((g) => g.anyOf.some((x) => x === 'pull_up_bar' || x === 'resistance_band'))).toBe(true);

    // Clear, then muscle only (primary or secondary).
    fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(visibleIds()).toHaveLength(SEED_EXERCISES.length);
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Hamstrings' }));
    const hamstrings = lib.exercises.filter((e) => e.primaryMuscles.includes('hamstrings') || e.secondaryMuscles.includes('hamstrings')).map((e) => e.id).sort();
    expect(visibleIds()).toEqual(hamstrings);
    // Pressing a selected chip removes that filter.
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Hamstrings' }));
    expect(visibleIds()).toHaveLength(SEED_EXERCISES.length);

    // Pattern + muscle + text together.
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Hip hinge' }));
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Glutes' }));
    fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bridge');
    expect(visibleIds()).toEqual(['glute_bridge', 'single_leg_glute_bridge']);

    // Equipment selected then deselected returns to "no equipment filter".
    fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Dumbbells' }));
    fireEvent.press(screen.getByRole('togglebutton', { name: 'Dumbbells' }));
    expect(visibleIds()).toHaveLength(SEED_EXERCISES.length);
  });

  it('bodyweight-only filter: an empty equipment list keeps only exercises without equipment', () => {
    const { store } = freshStore();
    const rows = store.search({ locale: 'en', equipment: [] }).map((r) => r.id);
    const expected = seedLibrary()
      .exercises.filter((e) => e.equipment.length === 0)
      .map((e) => e.id);
    expect(rows.sort()).toEqual(expected.sort());
    expect(store.search({ locale: 'en', pattern: 'balance', equipment: [] }).length).toBeGreaterThanOrEqual(5);
  });

  it('favourites persist in the device database and are labelled for screen readers', () => {
    const { store } = freshStore();
    renderLibrary('en', store);
    const row = screen.getByTestId('exercise-push_up');
    fireEvent.press(within(row).getByRole('button', { name: 'Add Push-up to favourites' }));
    expect(store.favourites()).toEqual(['push_up']);
    expect(within(screen.getByTestId('exercise-push_up')).getByRole('button', { name: 'Remove Push-up from favourites' })).toBeTruthy();
    expect(store.search({ locale: 'en', favouritesOnly: true }).map((r) => r.id)).toEqual(['push_up']);
    fireEvent.press(within(screen.getByTestId('exercise-push_up')).getByRole('button', { name: 'Remove Push-up from favourites' }));
    expect(store.favourites()).toEqual([]);
  });

  it('shows the draft notice: seed content is not presented as expert-validated', () => {
    const { store } = freshStore();
    renderLibrary('en', store);
    expect(screen.getByTestId('library-draft-notice')).toHaveTextContent('Draft content: these exercises have not yet been reviewed by a physiotherapist or strength coach.');
  });

  it('stores custom exercises as user data, removed by the account wipe; bundled content stays', () => {
    const { db, store } = freshStore();
    // The rest of the device database, as the app creates it.
    createDeviceSyncClient({ openDatabase: () => db, randomUUID: () => '00000000-0000-4000-8000-0000000000aa' });
    new SqliteKeyValueStore(db);
    store.addCustomExercise({ id: '00000000-0000-4000-8000-000000000001', name: 'Garden step routine', pattern: 'lunge', primaryMuscles: ['quads'], equipment: [], createdAt: '2026-09-23T10:00:00.000Z' });
    store.setFavourite('air_squat', true);
    expect(store.customExercises().map((c) => c.name)).toEqual(['Garden step routine']);
    expect(() => store.addCustomExercise({ id: 'bad', name: '', pattern: 'lunge', primaryMuscles: [], equipment: [], createdAt: 'x' } as never)).toThrow();
    wipeLocalDatabase(db);
    expect(store.customExercises()).toEqual([]);
    expect(store.favourites()).toEqual([]);
    expect(store.count()).toBe(SEED_EXERCISES.length);
    store.setFavourite('air_squat', true);
    store.wipeUserData();
    expect(store.favourites()).toEqual([]);
  });

  it('opens from the home screen through the real router, with the library installed at start', async () => {
    const router = renderRouter({ _layout: RootLayout, index: Index, 'age-gate': AgeGate, privacy: Privacy, library: Library, ...m01Routes }, { initialUrl: '/' });
    await screen.findByRole('header', { name: 'Before you start' });
    fireEvent.changeText(screen.getByTestId('age-gate-day'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-month'), '1');
    fireEvent.changeText(screen.getByTestId('age-gate-year'), '1990');
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Exercise library' }));
    expect(await screen.findByRole('header', { name: 'Exercise library' })).toBeTruthy();
    expect(router.getPathname()).toBe('/library');
    expect(screen.getByTestId('library-count')).toHaveTextContent(`${SEED_EXERCISES.length} exercises`);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('header', { name: 'Welcome' })).toBeTruthy();
  });
});
