import { ENGINE_VERSION } from '@fitadapt/engine';
import { guiltPhrases } from '@fitadapt/i18n';
import { verifyChain } from '@fitadapt/legal';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import type { ExecutionLog } from '@fitadapt/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderRouter } from 'expo-router/testing-library';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr, visibleStrings } from './helpers';
import { appRoutes } from './routes';

/**
 * M05 goal condition 4, end to end through the real root layout, router and
 * on-device database (sql.js stands in for expo-sqlite), in airplane mode
 * (every fetch fails): P3 (David, fictional) reports chest pain in the
 * middle of a session. The session ends, the seek-care guidance appears
 * with the emergency number of the jurisdiction (packages/legal: GB 999,
 * FR 112; generic guidance where no number is confirmed), and the intensity
 * lock persists — across an app restart — until the medical review is
 * attested in two steps; the next session is then deloaded. The S3 events
 * and the attestation are in the device's hash-chained defensibility log
 * immediately, and the red flag, the end and the attestation are in the
 * outbox for the server's sync transaction. The Maestro flow
 * e2e/red-flag-stop.yaml drives the same journey on a device.
 */
let mockSql: SqlJsStatic;
let mockDb: Database;
let mockRegion = 'GB';

jest.mock('../src/sync/expo-db', () => ({
  openExpoDatabase: () => {
    const { drizzle } = jest.requireActual('drizzle-orm/sql-js');
    return drizzle(mockDb);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: `en-${mockRegion}`, regionCode: mockRegion }] }));

const t = tr('en').t;
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
let app: ReturnType<typeof renderRouter>;
let fetchSpy: jest.SpyInstance;

const WED = '2026-09-23T10:00:00.000Z';
const MON = '2026-09-28T10:00:00.000Z';
const WED2 = '2026-09-30T10:00:00.000Z';

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
/** The records of a collection, in the order they were written (outbox order). */
const records = <T,>(collection: string) =>
  rows('SELECT mutation FROM sync_outbox ORDER BY seq')
    .map((r) => JSON.parse(String(r[0])) as { collection: string; data: T })
    .filter((m) => m.collection === collection)
    .map((m) => m.data);
const deviceLog = () => JSON.parse(String(rows("SELECT value FROM app_kv WHERE key = 'defensibility_device_log'")[0]?.[0] ?? '[]')) as { type: string; payload: Record<string, unknown> }[];


function logSet(rir: number) {
  const target = screen.getByTestId('workout-target');
  const numbers = String(target.props.children[0] ?? target.props.children).match(/\d+/g)!.map(Number);
  press(`workout-reps-${numbers.length > 1 ? numbers[1] : numbers[0]}`);
  press(`workout-rir-${rir}`);
}

async function openWorkout() {
  press('open-workout');
  await screen.findByRole('header', { name: t('workout.title') });
}

// FIX-B (CS-2, CS-6): an unconditional emergency line; France adds 15 (SAMU); Senegal's unconfirmed SAMU numbers come with the generic line.
describe.each([
  ['GB', 'Emergency number: call 999.'],
  ['FR', 'Emergency number: call 15 (medical emergencies) or 112.'],
  ['SN', 'Emergency number: call 1515 or 15 (medical emergencies). If you cannot get through, call your local emergency number.'],
])('S3 red-flag stop, offline (jurisdiction %s)', (region, emergency) => {
  it('chest pain mid-session: the session ends, seek-care guidance appears, and intensity stays locked (even after a restart) until the review is attested', async () => {
    mockRegion = region;
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

    // Monday: the optional readiness check is skipped (it never blocks), the session starts.
    jest.setSystemTime(new Date(MON));
    await openWorkout();
    expect(screen.getByTestId('recovery-readiness')).toBeTruthy();
    press('recovery-readiness-skip');
    expect(screen.getByTestId('recovery-warmup')).toBeTruthy();
    press('notice-first_workout-ack');
    press('workout-start');
    await screen.findByTestId('workout-phase-set');
    logSet(2);
    press('workout-skip');

    // Mid-session: chest pain → stop.
    press('workout-stop');
    press('workout-stop-symptom-chest_pain_pressure');
    expect(screen.getByTestId('workout-red_flag')).toBeTruthy();
    expect(screen.getByRole('header', { name: t('workout.redFlag.title') })).toBeTruthy();
    expect(screen.getByTestId('notice-seek_care')).toBeTruthy();
    expect(screen.getByTestId('notice-seek_care-emergency').props.children).toBe(emergency);
    expect(screen.queryByTestId('workout-phase-set')).toBeNull();
    press('notice-seek_care-ack');

    const logs = records<ExecutionLog>('execution_logs');
    expect(logs.slice(-2)).toMatchObject([{ kind: 'red_flag', symptom: 'chest_pain_pressure' }, { kind: 'ended', reason: 'red_flag' }]);
    // L11 on the device, immediately: S3 "session ended" and "intensity locked", the seek-care notice shown and acknowledged in this jurisdiction.
    const s3 = deviceLog().filter((e) => e.type === 'safety.event' && e.payload.invariant === 'S3');
    expect(s3.map((e) => e.payload)).toEqual([
      { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_pressure', action: 'session_ended', engineVersion: ENGINE_VERSION },
      { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: ENGINE_VERSION },
    ]);
    expect(deviceLog().filter((e) => e.type.startsWith('notice.') && e.payload.noticeId === 'seek_care').map((e) => [e.type, e.payload.jurisdiction])).toEqual([
      ['notice.shown', region],
      ['notice.acknowledged', region],
    ]);
    press('workout-back');
    await screen.findByRole('header', { name: t('home.title') });

    // The app is closed and reopened two days later: still locked, no session offered.
    app.unmount();
    jest.setSystemTime(new Date(WED2));
    app = renderRouter(appRoutes, { initialUrl: '/' });
    await screen.findByRole('header', { name: t('home.title') });
    await openWorkout();
    expect(screen.getByTestId('workout-locked')).toBeTruthy();
    expect(screen.getByText(t('engine.reason.session.unavailable.s3_intensity_locked'))).toBeTruthy();
    expect(screen.queryByTestId('workout-start')).toBeNull();
    expect(screen.queryByTestId('recovery-readiness')).toBeNull();
    // Changing to the mobility session does not get around the lock either.
    press('workout-mode-mobility_balance');
    expect(screen.queryByTestId('workout-start')).toBeNull();
    press('workout-mode-training');

    // Attestation, two steps: the statement, "Not yet" keeps the lock; "I confirm" lifts it.
    press('workout-attest');
    expect(screen.getByText(t('recovery.s3.attest.statement'))).toBeTruthy();
    press('workout-attest-cancel');
    expect(screen.getByTestId('workout-locked')).toBeTruthy();
    press('workout-attest');
    press('workout-attest-confirm');
    expect(screen.queryByTestId('workout-locked')).toBeNull();
    expect(records<ExecutionLog>('execution_logs').at(-1)).toMatchObject({ kind: 'medical_review_attested', statementVersion: 1 });
    expect(deviceLog().at(-1)).toMatchObject({ type: 'safety.attested', payload: { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: ENGINE_VERSION } });
    expect(verifyChain(deviceLog() as never).ok).toBe(true);
    // Sessions are back, lighter for a week (triggered deload after the red flag).
    expect(await screen.findByTestId('workout-start')).toBeTruthy();
    expect(screen.getByTestId('recovery-deload')).toBeTruthy();
    expect(screen.getAllByText(t('engine.reason.session.deload.triggered.red_flag')).length).toBeGreaterThan(0);
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'en')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 90_000);
});

describe('the Maestro flow e2e/red-flag-stop.yaml (not executed here: no device)', () => {
  it('only uses testIDs the app renders (literal ids, or the static prefix of a template id)', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'app'));
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const literal = new Set([...source.matchAll(/testID="([^"]+)"/g)].map((m) => m[1]!));
    const prefixes = [...source.matchAll(/testID=\{`([^`$]*)\$\{/g)].map((m) => m[1]!);
    const flow = readFileSync(join(root, 'e2e', 'red-flag-stop.yaml'), 'utf8');
    const ids = [...flow.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]!.replace(/\.\*$/, ''));
    expect(ids.length).toBeGreaterThan(20);
    const unknown = ids.filter((id) => !literal.has(id) && !prefixes.some((p) => p.length > 0 && id.startsWith(p)));
    expect(unknown).toEqual([]);
  });
});
