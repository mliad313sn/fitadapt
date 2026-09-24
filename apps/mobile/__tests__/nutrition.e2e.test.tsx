import { FOOD_SEED } from '@fitadapt/food-library';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import type { IntakeLog, NutritionPlanRecord } from '@fitadapt/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr } from './helpers';
import { appRoutes } from './routes';

/**
 * M10 end to end through the real root layout, router and on-device
 * database (sql.js stands in for expo-sqlite), with the network down
 * (goal condition 4): a fictional adult onboards (skipping measurements),
 * opens Nutrition from Home, sets it up (height and weight asked there),
 * then — counting every tap from the home screen — logs a hand portion in
 * three taps (Nutrition, the portion, how many), and finds a regional dish
 * in the offline food seed. Records land in the on-device outbox.
 * Maestro flow for a device: e2e/nutrition-quick-log.yaml (not executed here).
 */
let mockSql: SqlJsStatic;
let mockDb: Database;

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID(), getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('node:crypto').randomBytes(n)) }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-GB', regionCode: 'GB' }] }));

const t = tr('en').t;
let taps = 0;
const press = (testID: string) => {
  taps += 1;
  fireEvent.press(screen.getByTestId(testID));
};
let fetchSpy: jest.SpyInstance;

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  jest.useFakeTimers({ now: new Date('2026-09-24T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
});

async function onboard() {
  renderRouter(appRoutes, { initialUrl: '/' });
  await screen.findByRole('header', { name: t('ageGate.title') });
  fireEvent.changeText(screen.getByTestId('age-gate-day'), '14');
  fireEvent.changeText(screen.getByTestId('age-gate-month'), '3');
  fireEvent.changeText(screen.getByTestId('age-gate-year'), '1988');
  press('age-gate-continue');
  await screen.findByRole('header', { name: t('home.title') });
  press('start-onboarding');
  await screen.findByRole('header', { name: t('onboarding.goals.title') });
  press('goal-primary-fat_loss');
  press('experience-beginner');
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.schedule.title') });
  press('schedule-minutes-40');
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.equipment.title') });
  press('equipment-add-home');
  press('equipment-home-dumbbell');
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.healthConsent.title') });
  // FIX-B: the country of residence is asked explicitly.
  press('residence-GB');
  press('health-consent-agree');
  await screen.findByRole('header', { name: t('onboarding.about.title') });
  fireEvent.changeText(screen.getByTestId('about-birth-day'), '14');
  fireEvent.changeText(screen.getByTestId('about-birth-month'), '3');
  fireEvent.changeText(screen.getByTestId('about-birth-year'), '1988');
  press('about-skip-measurements');
  await screen.findByRole('header', { name: t('screening.title') });
  for (const q of SCREENING_QUESTIONS) press(`screening-${q}-no`);
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
  press('first-workout-home');
  await screen.findByRole('header', { name: t('home.title') });
}

const rows = (sql: string) => mockDb.exec(sql)[0]?.values ?? [];
const records = <T,>(collection: string) =>
  rows('SELECT mutation FROM sync_outbox ORDER BY seq')
    .map((r) => JSON.parse(String(r[0])) as { collection: string; data: T })
    .filter((m) => m.collection === collection)
    .map((m) => m.data);

describe('goal condition 4: hand-portion quick log in ≤ 3 taps, food search on the offline seed', () => {
  it('sets up nutrition, then logs a palm of protein in 3 taps from Home and a regional dish from the search, offline', async () => {
    await onboard();
    // Set-up (once): maintenance with numbers; the profile has no measurements, so they are asked here.
    press('open-nutrition');
    await screen.findByRole('header', { name: t('nutrition.title') });
    fireEvent.changeText(screen.getByTestId('nutrition-height'), '170');
    fireEvent.changeText(screen.getByTestId('nutrition-weight'), '72');
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-target-energy')).toBeTruthy();
    expect(records<NutritionPlanRecord>('nutrition_plans').map((p) => [p.reason, p.target.mode])).toEqual([['setup', 'numeric']]);
    press('nutrition-back');
    await screen.findByRole('header', { name: t('home.title') });

    // The quick log, counted from the home screen.
    taps = 0;
    press('open-nutrition');
    await screen.findByTestId('nutrition-quick');
    press('quick-protein_palm');
    press('quick-count-1');
    expect(taps).toBeLessThanOrEqual(3);
    expect(screen.getByTestId('quick-logged')).toBeTruthy();
    const quick = records<IntakeLog>('intake_logs');
    expect(quick).toEqual([expect.objectContaining({ loggedOn: '2026-09-24', entry: { kind: 'hand_portion', portion: 'protein_palm', count: 1 }, estimate: { energyKcal: 150, proteinG: 25 }, removed: false })]);
    expect(screen.getByTestId('nutrition-logged-today').props.children).toBe(t('nutrition.today.logged', { kcal: '150', protein: '25' }));

    // Food search on the bundled seed (≥ 200 foods), by the dish's local name, then a typical portion.
    expect(FOOD_SEED.length).toBeGreaterThanOrEqual(200);
    fireEvent.changeText(screen.getByTestId('nutrition-search'), 'ceebu jen');
    expect(screen.getByTestId('food-thieboudienne').props.accessibilityLabel).toBe(t('nutrition.search.withLocal', { name: t('food.thieboudienne.name'), local: 'Ceebu jën' }));
    fireEvent.press(screen.getByTestId('food-thieboudienne'));
    fireEvent.press(screen.getByTestId('food-thieboudienne-portion-plate'));
    expect(records<IntakeLog>('intake_logs')[1]).toMatchObject({ entry: { kind: 'food', foodId: 'thieboudienne', portionId: 'plate', count: 1 }, estimate: { energyKcal: 640, proteinG: 32 } });
    fireEvent.changeText(screen.getByTestId('nutrition-search'), 'zzzz');
    expect(screen.getByTestId('nutrition-search-none')).toBeTruthy();

    // Nothing touched the network; everything waits in the outbox.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
