import { ENGINE_VERSION, PAIR_RULES_VERSION } from '@fitadapt/engine';
import { guiltPhrases, judgementalBodyTerms, pairPressurePhrases } from '@fitadapt/i18n';
import { verifyChain, type DefensibilityEvent } from '@fitadapt/legal';
import { SCREENING_QUESTIONS } from '@fitadapt/safety';
import type { ExecutionLog, PairSession, SetLog, WorkoutSessionRecord } from '@fitadapt/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { tr } from './helpers';
import { appRoutes } from './routes';

/**
 * M09 goal condition 4, in jest-expo through the real root layout, router
 * and on-device database (sql.js stands in for expo-sqlite), with the network
 * unavailable (airplane mode: every fetch fails, and no WebSocket may be
 * opened). P1 (Ibrahima, fictional: 120 kg, home with a pull-up bar, a band
 * and one pair of 10 kg dumbbells) and P2 (Awa, fictional: 60 kg) train one
 * pair session on one phone: Awa answers her own age check, accepts her own
 * texts and consents, answers her own health questions; they take
 * alternating turns; each set is logged for the person who did it. The same
 * journey is the Maestro flow apps/mobile/e2e/pair-single-device.yaml (not
 * executed here: no device).
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
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
let fetchSpy: jest.SpyInstance;
let sockets: number;
const RealWebSocket = globalThis.WebSocket;

const WED = '2026-09-23T10:00:00.000Z';
const MON = '2026-09-28T10:00:00.000Z';

beforeAll(async () => {
  mockSql = await initSqlJs();
});
beforeEach(() => {
  mockDb = new mockSql.Database();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  sockets = 0;
  // Single-device mode needs no network at all: opening a WebSocket would be a defect.
  (globalThis as { WebSocket: unknown }).WebSocket = class {
    constructor() {
      sockets += 1;
      throw new Error('offline');
    }
  };
});
afterEach(() => {
  fetchSpy.mockRestore();
  (globalThis as { WebSocket: unknown }).WebSocket = RealWebSocket;
  jest.useRealTimers();
});

async function onboardP1() {
  renderRouter(appRoutes, { initialUrl: '/' });
  await screen.findByRole('header', { name: t('ageGate.title') });
  fireEvent.changeText(screen.getByTestId('age-gate-day'), '1');
  fireEvent.changeText(screen.getByTestId('age-gate-month'), '6');
  fireEvent.changeText(screen.getByTestId('age-gate-year'), '1988');
  press('age-gate-continue');
  await screen.findByRole('header', { name: t('home.title') });
  press('start-onboarding');
  await screen.findByRole('header', { name: t('onboarding.goals.title') });
  press('goal-primary-fat_loss');
  press('experience-beginner');
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.schedule.title') });
  press('schedule-minutes-45');
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.equipment.title') });
  press('equipment-add-home');
  for (const id of ['pull_up_bar', 'resistance_band', 'dumbbell']) press(`equipment-home-${id}`);
  press('onboarding-next');
  await screen.findByRole('header', { name: t('onboarding.healthConsent.title') });
  press('health-consent-agree');
  await screen.findByRole('header', { name: t('onboarding.about.title') });
  fireEvent.changeText(screen.getByTestId('about-birth-day'), '1');
  fireEvent.changeText(screen.getByTestId('about-birth-month'), '6');
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
  press('onboarding-next');
  await screen.findByRole('header', { name: t('firstWorkout.title') });
  press('first-workout-home');
  await screen.findByRole('header', { name: t('home.title') });
  press('open-calendar');
  await screen.findByRole('header', { name: t('calendar.title') });
  press('calendar-create');
  await screen.findByTestId('calendar-week-1');
  press('calendar-back');
  await screen.findByRole('header', { name: t('home.title') });
}

/** Awa answers for herself: name and date of birth, her own texts and consents, her own health questions. */
async function awaSetsUp() {
  press('pair-add-partner');
  await screen.findByTestId('pair-guest-identity');
  fireEvent.changeText(screen.getByTestId('pair-guest-name'), 'Awa');
  fireEvent.changeText(screen.getByTestId('pair-guest-birth-day'), '1');
  fireEvent.changeText(screen.getByTestId('pair-guest-birth-month'), '6');
  fireEvent.changeText(screen.getByTestId('pair-guest-birth-year'), '1994');
  press('pair-guest-next');
  await screen.findByTestId('pair-guest-legal');
  // L2: going on before accepting is refused.
  press('pair-guest-next');
  expect(screen.getByTestId('pair-guest-error')).toBeTruthy();
  for (const doc of ['terms', 'privacy', 'exercise_risk']) {
    press(`pair-guest-legal-${doc}-read`);
    press(`pair-guest-legal-${doc}-accept`);
  }
  press('pair-guest-consent-health-agree');
  press('pair-guest-consent-partner_sharing-agree');
  press('pair-guest-next');
  await screen.findByTestId('pair-guest-screening');
  for (const q of SCREENING_QUESTIONS) press(`pair-guest-screening-${q}-no`);
  fireEvent.changeText(screen.getByTestId('pair-guest-weight'), '60');
  press('pair-guest-next');
  await screen.findByTestId('pair-guest-sharing');
  press('pair-guest-sharing-performance');
  press('pair-guest-next');
  await screen.findByTestId('pair-setup');
}

const rows = (sql: string) => mockDb.exec(sql)[0]?.values ?? [];
const kv = (key: string) => {
  const raw = rows(`SELECT value FROM app_kv WHERE key = '${key}'`)[0]?.[0];
  return raw === undefined ? undefined : (JSON.parse(String(raw)) as unknown);
};
const outbox = <T,>(collection: string) =>
  rows('SELECT mutation FROM sync_outbox ORDER BY seq')
    .map((r) => JSON.parse(String(r[0])) as { collection: string; data: T })
    .filter((m) => m.collection === collection)
    .map((m) => m.data);

/** The strings of the pair screen only (the stack keeps earlier screens mounted, hidden). */
function stringsUnder(testID: RegExp): string[] {
  const out = new Set<string>();
  const walk = (node: typeof screen.root, inside: boolean) => {
    const p = node.props as { testID?: unknown; accessibilityLabel?: unknown; accessibilityHint?: unknown };
    const here = inside || (typeof p.testID === 'string' && testID.test(p.testID));
    if (here && typeof p.accessibilityLabel === 'string') out.add(p.accessibilityLabel);
    if (here && typeof p.accessibilityHint === 'string') out.add(p.accessibilityHint);
    for (const child of node.children) {
      if (typeof child === 'string') {
        if (here && child.trim()) out.add(child);
      } else walk(child, here);
    }
  };
  walk(screen.root, false);
  expect(out.size).toBeGreaterThan(5);
  return [...out];
}

/** Two taps for the person whose turn it is: reps (the top of the range, or the hold), then reps in reserve. */
function logTurn(rir = 2) {
  const target = screen.getByTestId('pair-target');
  const numbers = String(target.props.children[0] ?? target.props.children).match(/\d+/g)!.map(Number);
  press(`pair-reps-${numbers.length > 1 ? numbers[1] : numbers[0]}`);
  press(`pair-rir-${rir}`);
}

describe('P1 + P2 train one pair session on one phone, offline (goal condition 4)', () => {
  it('each answers for themselves, they alternate turns, and every set is logged for the person who did it', async () => {
    jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
    await onboardP1();
    jest.setSystemTime(new Date(MON));
    press('open-pair');
    await screen.findByTestId('pair-setup');

    // The owner: a first name, their own partner-sharing consent (M17), their own choices (nothing extra by default).
    fireEvent.changeText(screen.getByTestId('pair-owner-name'), 'Ibrahima');
    press('pair-preview');
    expect(screen.getByTestId('pair-error')).toBeTruthy(); // no consent yet: nothing is shared
    press('pair-owner-consent-agree');
    await awaSetsUp();
    press('pair-choose-Awa');
    press('pair-preview');
    await screen.findByTestId('pair-preview');

    // The Fair Challenge is off by default (neither chose it).
    expect(screen.getByTestId('pair-challenge-status').props.children).toBe(t('pair.challenge.off'));
    // L3: each person's own first-workout notice, in their own ledger; start waits for both.
    expect(screen.getByTestId('pair-notice-a-first_workout')).toBeTruthy();
    expect(screen.getByTestId('pair-notice-b-first_workout')).toBeTruthy();
    expect(screen.getByTestId('pair-start').props.accessibilityState.disabled).toBe(true);
    press('pair-notice-a-first_workout-ack');
    press('pair-notice-b-first_workout-ack');
    press('pair-start');

    // Warm-up together, then turns.
    await screen.findByTestId('pair-together');
    press('pair-together-done');
    const turns: string[] = [];
    for (let guard = 0; guard < 120 && !screen.queryByTestId('pair-done'); guard++) {
      if (screen.queryByTestId('pair-together')) {
        press('pair-together-done');
        continue;
      }
      turns.push(String(screen.getByTestId('pair-turn').props.children));
      // Every string on screen during the session: no rivalry, age, pressure, guilt or body judgement.
      for (const text of stringsUnder(/^pair-(turn|together)/)) expect({ text, p: pairPressurePhrases(text, 'en'), g: guiltPhrases(text, 'en'), b: judgementalBodyTerms(text, 'en') }).toEqual({ text, p: [], g: [], b: [] });
      // L4: each person can stop, and the current person can skip, in every state.
      expect(screen.getByTestId('pair-stop-a')).toBeTruthy();
      expect(screen.getByTestId('pair-stop-b')).toBeTruthy();
      expect(screen.getByTestId('pair-skip')).toBeTruthy();
      logTurn(2);
    }
    await screen.findByTestId('pair-done');

    // Alternating turns: I go / you go.
    const ib = t('pair.turn.title', { name: 'Ibrahima' });
    const awa = t('pair.turn.title', { name: 'Awa' });
    expect(turns.slice(0, 4)).toEqual([ib, awa, ib, awa]);
    expect(turns.filter((x) => x === ib).length).toBeGreaterThan(4);
    expect(turns.filter((x) => x === awa).length).toBeGreaterThan(4);

    // Per-person logging. The owner's records are in the owner's sync outbox…
    const [ownerRecord] = outbox<WorkoutSessionRecord>('workout_sessions');
    const ownerSets = outbox<SetLog>('set_logs');
    expect(ownerSets.length).toBe(turns.filter((x) => x === ib).length);
    expect(ownerSets.every((s) => s.planId === ownerRecord!.plan.planId)).toBe(true);
    expect(ownerRecord!.plan).toMatchObject({ engineVersion: ENGINE_VERSION });
    expect(outbox<ExecutionLog>('execution_logs').map((e) => e.kind)).toEqual(['ended']);
    // …Awa's are in her own namespace on this phone, and never in the owner's outbox or account.
    const guestId = (kv('pair.guests') as string[])[0]!;
    const guestSets = (kv(`pair.guest.${guestId}.set_logs`) as { data: SetLog }[]).map((s) => s.data);
    const [guestRecord] = kv(`pair.guest.${guestId}.workouts`) as WorkoutSessionRecord[];
    expect(guestSets.length).toBe(turns.filter((x) => x === awa).length);
    expect(guestSets.every((s) => s.planId === guestRecord!.plan.planId)).toBe(true);
    expect(guestRecord!.plan.planId).not.toBe(ownerRecord!.plan.planId);
    const outboxText = JSON.stringify(rows('SELECT mutation FROM sync_outbox'));
    expect(outboxText).not.toContain(guestRecord!.plan.planId);
    expect(outboxText).not.toContain('Awa');
    expect(outboxText).not.toContain(guestId);
    // Each plan is the person's own (their own SafetyProfile and input), both at the shared place.
    expect(guestRecord!.input.bodyweightKg).toBe(60);
    expect(guestRecord!.input.equipmentProfileId).toBe(ownerRecord!.input.equipmentProfileId);
    expect(guestRecord!.input.safetyProfile).not.toBe(ownerRecord!.input.safetyProfile);

    // L2 and L11 in each person's own ledger: Awa's acceptances and consents are hers, and her chain verifies.
    const guestAcceptances = kv(`pair.guest.${guestId}.legal_acceptances`) as { documentId: string }[];
    expect(guestAcceptances.map((a) => a.documentId).sort()).toEqual(['exercise_risk', 'privacy', 'terms']);
    const guestConsents = kv(`pair.guest.${guestId}.consent_records`) as { dataType: string; decision: string }[];
    expect(guestConsents.map((c) => [c.dataType, c.decision])).toEqual([
      ['health', 'granted'],
      ['partner_sharing', 'granted'],
    ]);
    const ownerConsents = kv('consent_records') as { dataType: string }[];
    expect(ownerConsents.map((c) => c.dataType)).toEqual(['health', 'partner_sharing']);
    const guestChain = kv(`pair.guest.${guestId}.defensibility_device_log`) as DefensibilityEvent[];
    const ownerChain = kv('defensibility_device_log') as DefensibilityEvent[];
    expect(verifyChain(guestChain).ok).toBe(true);
    expect(verifyChain(ownerChain).ok).toBe(true);
    for (const chain of [guestChain, ownerChain]) {
      expect(chain.map((e) => e.type)).toEqual(expect.arrayContaining(['prescription.issued', 'pair.joined', 'pair.timeline_built', 'pair.left']));
      expect(chain.find((e) => e.type === 'pair.timeline_built')!.payload).toMatchObject({ rulesVersion: PAIR_RULES_VERSION });
    }
    expect(guestChain.filter((e) => e.type === 'acceptance.recorded')).toHaveLength(3);
    expect(ownerChain.filter((e) => e.type === 'acceptance.recorded')).toHaveLength(3);
    // The pair session record stays on this phone: the challenge was off.
    const [pairRecord] = kv('pair.sessions') as PairSession[];
    expect(pairRecord).toMatchObject({ mode: 'single_device', challenge: false });

    // Airplane mode: no request and no socket, ever.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sockets).toBe(0);
    press('pair-exit');
    await screen.findByRole('header', { name: t('home.title') });
  }, 120_000);

  it('the Maestro flow e2e/pair-single-device.yaml only uses testIDs the app renders (literal ids, or the static prefix of a template id)', () => {
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
    // The pair screen passes each state's testID to its shell(): shell('pair-setup', …) or shell(`pair-turn-${who}`, …).
    for (const m of source.matchAll(/shell\(\s*'([^']+)'/g)) literal.add(m[1]!);
    const prefixes = [...source.matchAll(/testID=\{`([^`$]*)\$\{/g), ...source.matchAll(/shell\(\s*`([^`$]*)\$\{/g)].map((m) => m[1]!);
    const flow = readFileSync(join(root, 'e2e', 'pair-single-device.yaml'), 'utf8');
    const ids = [...flow.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]!.replace(/\.\*.*$/, ''));
    expect(ids.length).toBeGreaterThan(40);
    const unknown = ids.filter((id) => !literal.has(id) && !prefixes.some((p) => p.length > 0 && id.startsWith(p)));
    expect(unknown).toEqual([]);
  });
});
