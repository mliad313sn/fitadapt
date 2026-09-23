import { DEFAULT_REGISTRY, LegalRegistry, verifyChain, type LegalDocument } from '@fitadapt/legal';
import type { Locale } from '@fitadapt/shared';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import { tr } from './helpers';
import { appRoutes } from './routes';

/**
 * M01 end to end through the real root layout, router and on-device database
 * (sql.js stands in for expo-sqlite). Goal conditions 1, 5, 6 and 7 (device
 * side). The same flows are scripted for devices in e2e/onboarding-*.yaml.
 */
let mockSql: SqlJsStatic;
let mockDb: Database;
let mockLanguage = 'en-GB';
let mockRegistry: LegalRegistry | null = null;

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: mockLanguage, regionCode: mockLanguage.endsWith('SN') ? 'SN' : 'GB' }] }));
jest.mock('../src/legal/registry', () => ({
  currentLegalRegistry: () => mockRegistry ?? jest.requireActual('@fitadapt/legal').DEFAULT_REGISTRY,
}));

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database(); // a fresh install
  mockLanguage = 'en-GB';
  mockRegistry = null;
});

let app: ReturnType<typeof renderRouter>;
const launch = () => (app = renderRouter(appRoutes, { initialUrl: '/' }));
const pathname = () => app.getPathname();
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/** Goal condition 6: every interactive element on screen has an accessibility label. */
function expectEveryInputLabelled() {
  const unlabelled: string[] = [];
  const walk = (node: typeof screen.root) => {
    const p = node.props as Record<string, unknown>;
    // Host elements a user can operate: text inputs, and anything announced as a control or clickable.
    const host = typeof node.type === 'string';
    const control = ['button', 'switch', 'radio', 'togglebutton', 'checkbox', 'link'].includes(String(p.accessibilityRole));
    const interactive = host && (typeof p.onChangeText === 'function' || typeof p.onClick === 'function' || control);
    if (interactive && (typeof p.accessibilityLabel !== 'string' || p.accessibilityLabel.trim() === '')) unlabelled.push(String(p.testID ?? node.type));
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(screen.root);
  expect(unlabelled).toEqual([]);
}

interface Journey {
  screens: string[];
  t: ReturnType<typeof tr>;
}

/** Records each distinct screen reached (by route), checking its labels on the way. */
function journey(locale: Locale): Journey & { at: (header: string) => Promise<void> } {
  const j = { screens: [] as string[], t: tr(locale) };
  return {
    ...j,
    async at(header: string) {
      expect(await screen.findByRole('header', { name: header })).toBeTruthy();
      expectEveryInputLabelled();
      const path = pathname();
      const key = `${path}|${header}`;
      if (j.screens[j.screens.length - 1] !== key) j.screens.push(key);
    },
  };
}

async function passAgeGate(j: ReturnType<typeof journey>) {
  await j.at(j.t.t('ageGate.title'));
  fireEvent.changeText(screen.getByTestId('age-gate-day'), '14');
  fireEvent.changeText(screen.getByTestId('age-gate-month'), '3');
  fireEvent.changeText(screen.getByTestId('age-gate-year'), '1988');
  press('age-gate-continue');
  await j.at(j.t.t('home.title'));
}

interface Options {
  skipBiometrics?: boolean;
  birthYear?: string;
  yes?: string[];
  stopAt?: 'terms' | 'exercise-risk';
}

/** The whole onboarding, from the welcome screen, as a user would do it. */
async function onboard(j: ReturnType<typeof journey>, options: Options = {}) {
  const { t } = j.t;
  press('start-onboarding');
  await j.at(t('onboarding.goals.title'));
  press('goal-primary-fat_loss');
  press('goal-secondary-general_health');
  press('experience-none');
  press('onboarding-next');

  await j.at(t('onboarding.schedule.title'));
  press('schedule-days-3');
  press('schedule-minutes-40');
  press('time-evening');
  press('onboarding-next');

  await j.at(t('onboarding.equipment.title'));
  press('equipment-add-home');
  press('equipment-home-pull_up_bar');
  press('equipment-home-resistance_band');
  press('equipment-home-dumbbell');
  press('equipment-add-gym');
  for (const id of ['barbell', 'squat_rack', 'flat_bench', 'cable_station', 'lat_pulldown', 'dumbbell']) press(`equipment-gym-${id}`);
  press('equipment-add-park');
  press('equipment-park-pull_up_bar');
  press('equipment-park-parallel_bars');
  press('onboarding-next');

  await j.at(t('onboarding.healthConsent.title'));
  expect(screen.getByText(t('legal.consent.health.v1.body'))).toBeTruthy();
  press('health-consent-agree');

  await j.at(t('onboarding.about.title'));
  fireEvent.changeText(screen.getByTestId('about-birth-day'), '14');
  fireEvent.changeText(screen.getByTestId('about-birth-month'), '3');
  fireEvent.changeText(screen.getByTestId('about-birth-year'), options.birthYear ?? '1988');
  if (options.skipBiometrics) {
    press('about-skip-measurements');
  } else {
    fireEvent.changeText(screen.getByTestId('about-height'), '178');
    fireEvent.changeText(screen.getByTestId('about-weight'), '120');
    press('limitation-knee');
    fireEvent.changeText(screen.getByTestId('about-motivation'), 'Keep up with my kids');
    press('onboarding-next');
  }

  await j.at(t('screening.title'));
  for (const q of SCREENING_QUESTIONS) press(`screening-${q}-${options.yes?.includes(q) ? 'yes' : 'no'}`);
  press('onboarding-next');

  await screen.findByTestId(/^onboarding-result-/);
  const outcome = String(screen.getByTestId(/^onboarding-result-/).props.testID).replace('onboarding-result-', '');
  await j.at(t(`onboarding.result.title.${outcome}` as Parameters<typeof t>[0]));
  press('onboarding-next');

  await j.at(t('onboarding.terms.title'));
  if (options.stopAt === 'terms') return;
  for (const doc of ['terms', 'privacy']) {
    press(`legal-${doc}-read`);
    press(`legal-${doc}-accept`);
  }
  press('onboarding-next');

  await j.at(t('legal.exerciseRisk.v1.title'));
  if (options.stopAt === 'exercise-risk') return;
  press('onboarding-next');
  await j.at(t('firstWorkout.title'));
}

describe.each<[Locale, string]>([
  ['en', 'en-GB'],
  ['fr', 'fr-SN'],
])('onboarding in %s (goal condition 1)', (locale, language) => {
  it('follows the spec order and lands on the first-workout screen in ≤ 12 screens', async () => {
    mockLanguage = language;
    launch();
    const j = journey(locale);
    await passAgeGate(j);
    await onboard(j);
    expect(j.screens.map((s) => s.split('|')[1])).toEqual([
      j.t.t('ageGate.title'),
      j.t.t('home.title'),
      j.t.t('onboarding.goals.title'),
      j.t.t('onboarding.schedule.title'),
      j.t.t('onboarding.equipment.title'),
      j.t.t('onboarding.healthConsent.title'),
      j.t.t('onboarding.about.title'),
      j.t.t('screening.title'),
      j.t.t('onboarding.result.title.cleared_with_restrictions'),
      j.t.t('onboarding.terms.title'),
      j.t.t('legal.exerciseRisk.v1.title'),
      j.t.t('firstWorkout.title'),
    ]);
    expect(j.screens.length).toBeLessThanOrEqual(12);
    expect(pathname()).toBe('/first-workout');
    // L3: the first-workout notice is shown there and can be acknowledged.
    expect(screen.getByText(j.t.t('legal.notice.firstWorkout.v1.body'))).toBeTruthy();
    press('notice-first_workout-ack');
    expect(screen.queryByTestId('notice-first_workout')).toBeNull();
  });
});

describe('skipping measurements (goal condition 5)', () => {
  it.each<[Locale, string]>([
    ['en', 'en-GB'],
    ['fr', 'fr-SN'],
  ])('skipping weight and body fat never blocks progress (%s)', async (locale, language) => {
    mockLanguage = language;
    launch();
    const j = journey(locale);
    await passAgeGate(j);
    await onboard(j, { skipBiometrics: true });
    expect(pathname()).toBe('/first-workout');
    const profile = JSON.parse(String(mockDb.exec("SELECT data FROM sync_records WHERE collection = 'profile'")[0]!.values[0]![0]));
    expect(profile.biometrics).toEqual({ heightCm: null, weightKg: null, bodyFatPercent: null });
  });
});

describe('equipment profiles change the exercise pool (goal condition 4, on screen)', () => {
  it('switching the place at session start changes the exercises available', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    await onboard(j);
    const count = () => Number(/\d+/.exec(String(screen.getByTestId('first-workout-pool').props.children))?.[0] ?? 0);
    press('first-workout-location-home');
    const home = count();
    press('first-workout-location-gym');
    const gym = count();
    press('first-workout-location-park');
    const park = count();
    expect(new Set([home, gym, park]).size).toBe(3);
    expect(Math.min(home, gym, park)).toBeGreaterThan(0);
  });
});

describe('L2: first workout gated by recorded acceptance (goal condition 7, device)', () => {
  it('the first workout is unreachable until Terms, Privacy, health consent and exercise risk are accepted', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    act(() => router.push('/first-workout'));
    expect(screen.queryByRole('header', { name: j.t.t('firstWorkout.title') })).toBeNull();
    await onboard(j, { stopAt: 'terms' });
    act(() => router.push('/first-workout'));
    expect(screen.queryByRole('header', { name: j.t.t('firstWorkout.title') })).toBeNull();
    // Continue without accepting: refused.
    press('onboarding-next');
    expect(screen.getByText(j.t.t('onboarding.terms.required'))).toBeTruthy();
    // "I accept" appears only once the text has been opened (informed acceptance).
    expect(screen.queryByTestId('legal-terms-accept')).toBeNull();
    press('legal-terms-read');
    press('legal-terms-accept');
    press('legal-privacy-read');
    press('legal-privacy-accept');
    act(() => router.push('/first-workout'));
    expect(screen.queryByRole('header', { name: j.t.t('firstWorkout.title') })).toBeNull();
    press('onboarding-next');
    await j.at(j.t.t('legal.exerciseRisk.v1.title'));
    press('onboarding-next');
    await j.at(j.t.t('firstWorkout.title'));

    // Each acceptance stores version, locale, jurisdiction, timestamp and the hash of the text shown.
    const acceptances = JSON.parse(String(mockDb.exec("SELECT value FROM app_kv WHERE key = 'legal_acceptances'")[0]!.values[0]![0])) as Array<Record<string, unknown>>;
    expect(acceptances.map((a) => a.documentId)).toEqual(['terms', 'privacy', 'exercise_risk']);
    for (const a of acceptances) {
      expect(a).toMatchObject({ version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' });
      expect(Number.isNaN(Date.parse(String(a.acceptedAt)))).toBe(false);
      expect(String(a.contentHash)).toMatch(/^[0-9a-f]{64}$/);
    }
    // ...and each goes to the device defensibility buffer, hash-chained (L11).
    const log = JSON.parse(String(mockDb.exec("SELECT value FROM app_kv WHERE key = 'defensibility_device_log'")[0]!.values[0]![0]));
    expect(verifyChain(log)).toMatchObject({ ok: true });
    expect(log.map((e: { type: string }) => e.type)).toEqual(['consent.recorded', 'acceptance.recorded', 'acceptance.recorded', 'acceptance.recorded', 'notice.shown']);
  });

  it('declining health-data consent keeps the first workout locked', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    press('start-onboarding');
    await j.at(j.t.t('onboarding.goals.title'));
    press('goal-primary-strength');
    press('experience-beginner');
    press('onboarding-next');
    await j.at(j.t.t('onboarding.schedule.title'));
    press('onboarding-next');
    await j.at(j.t.t('onboarding.equipment.title'));
    press('onboarding-next');
    expect(screen.getByText(j.t.t('onboarding.equipment.required'))).toBeTruthy();
    press('equipment-add-travel');
    press('onboarding-next');
    await j.at(j.t.t('onboarding.healthConsent.title'));
    press('health-consent-decline');
    expect(screen.getByText(j.t.t('onboarding.healthConsent.declined'))).toBeTruthy();
    press('health-consent-home');
    await j.at(j.t.t('home.title'));
    expect(screen.queryByTestId('open-first-workout')).toBeNull();
    act(() => router.push('/first-workout'));
    expect(screen.queryByRole('header', { name: j.t.t('firstWorkout.title') })).toBeNull();
  });

  it('publishing a new material version forces re-acceptance before the next workout', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    await onboard(j);
    press('first-workout-home');
    await j.at(j.t.t('home.title'));
    expect(screen.getByTestId('open-first-workout')).toBeTruthy();

    // An app update ships Terms v2, a material change now in force.
    const today = new Date().toISOString().slice(0, 10);
    const base = DEFAULT_REGISTRY.get('terms')!;
    const terms: LegalDocument = { ...base, versions: [...base.versions, { ...base.versions[0]!, version: 2, material: true, publishedOn: today, effectiveFrom: today, changeSummary: 'fixture: material change' }] };
    mockRegistry = new LegalRegistry(DEFAULT_REGISTRY.documents.map((d) => (d.id === 'terms' ? terms : d)));
    screen.unmount();
    launch();
    await j.at(j.t.t('home.title'));
    expect(screen.queryByTestId('open-first-workout')).toBeNull();
    expect(screen.getByTestId('legal-review')).toBeTruthy();
    act(() => router.push('/first-workout'));
    expect(screen.queryByRole('header', { name: j.t.t('firstWorkout.title') })).toBeNull();

    press('review-legal');
    await j.at(j.t.t('onboarding.terms.title'));
    expect(screen.getByTestId('legal-terms-status').props.children).toBe(j.t.t('legal.status.needsReacceptance'));
    expect(screen.getByTestId('legal-privacy-status').props.children).toBe(j.t.t('onboarding.terms.accepted', { version: 1 }));
    press('legal-terms-read');
    press('legal-terms-accept');
    expect(screen.getByTestId('legal-terms-status').props.children).toBe(j.t.t('onboarding.terms.accepted', { version: 2 }));
    press('onboarding-next');
    await j.at(j.t.t('home.title'));
    press('open-first-workout');
    await j.at(j.t.t('firstWorkout.title'));
  });
});

describe('S1/S7 routing in onboarding', () => {
  it('a screening flag shows "talk to a professional" with the S1 reason and the clearance path', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    await onboard(j, { yes: ['chest_discomfort'], stopAt: 'terms' });
    act(() => router.back());
    await j.at(j.t.t('onboarding.result.title.consult_professional'));
    expect(screen.getByText(j.t.t('reason.safety_profile.s1.unresolved_flag'))).toBeTruthy();
    expect(screen.getByText(j.t.t('onboarding.result.clearanceLater'))).toBeTruthy();
  });

  it('pregnancy routes to professional guidance and the low-intensity library', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    await onboard(j, { yes: ['pregnancy_or_recent_birth'] });
    expect(screen.getByText(j.t.t('firstWorkout.lowIntensity'))).toBeTruthy();
  });

  it('a date of birth under 16 in the profile locks the app on the S7 gate', async () => {
    launch();
    const j = journey('en');
    await passAgeGate(j);
    const year = String(new Date().getFullYear() - 14);
    await expect(onboard(j, { birthYear: year })).rejects.toThrow();
    expect(await screen.findByRole('header', { name: j.t.t('ageGate.blocked.title') })).toBeTruthy();
  });
});
