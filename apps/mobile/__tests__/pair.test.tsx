import { EQUIPMENT_PRESETS } from '@fitadapt/exercise-library';
import { guiltPhrases, judgementalBodyTerms, pairPressurePhrases, type Locale } from '@fitadapt/i18n';
import { verifyChain } from '@fitadapt/legal';
import { intensityLockStatus } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type PairSharingScope, type SetLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createPairStore, guestFacts, guestSafetyProfile, sharedScopes } from '../src/pair/pair-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { expoProgressDeviceIo } from '../src/progress/device-io';
import { CalendarScreen } from '../src/screens/CalendarScreen';
import { PairScreen } from '../src/screens/PairScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr } from './helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID(), getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('node:crypto').randomBytes(n)) }));

/**
 * M09 on the device, screen level (goal conditions 6 and 7, and S2/S3 per
 * person): P1 (Ibrahima, 120 kg) owns the phone; P2 (Awa, 60 kg) is a guest
 * with her own ledgers. Both fictional. The network is down throughout.
 */
const WED = '2026-09-23T10:00:00.000Z';
const MON = '2026-09-28T10:00:00.000Z';
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  jest.useRealTimers();
});

interface Options {
  ownerScopes?: PairSharingScope[];
  guestScopes?: PairSharingScope[];
  ownerSharingConsent?: boolean;
  guestAccepts?: readonly ('terms' | 'privacy' | 'exercise_risk')[];
  guestConsents?: readonly ('health' | 'partner_sharing')[];
}

function device(o: Options = {}) {
  jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  const pair = createPairStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  if (o.ownerSharingConsent !== false) consents.getState().decide('partner_sharing', true, 'en');
  profile.getState().saveEquipment('home', [...EQUIPMENT_PRESETS.home_basic]);
  profile.getState().updateDraft({
    primaryGoal: 'fat_loss',
    experience: 'beginner',
    schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1988, month: 6, day: 1 },
    biometrics: { heightCm: 178, weightKg: 120, bodyFatPercent: null },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  pair.getState().setOwnerName('Ibrahima');
  pair.getState().recordSharing('owner', o.ownerScopes ?? []);
  // Awa, on Ibrahima's phone, with her own ledgers.
  const awa = pair.getState().addGuest('Awa', { year: 1994, month: 6, day: 1 });
  const ledgers = pair.getState().ledgers(awa.id);
  for (const doc of o.guestAccepts ?? ['terms', 'privacy', 'exercise_risk']) ledgers.legal.getState().accept(doc, 'en');
  for (const type of o.guestConsents ?? ['health', 'partner_sharing']) ledgers.consents.getState().decide(type, true, 'en');
  pair.getState().saveGuestScreening(awa.id, { answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])), clearanceAttested: false, birthDate: { year: 1994, month: 6, day: 1 }, answeredOn: { year: 2026, month: 9, day: 23 }, limitations: [], excludedExerciseIds: [] });
  pair.getState().setGuestBodyweight(awa.id, 60);
  pair.getState().recordSharing(awa.id, o.guestScopes ?? []);
  const d = { client, kv, consents, profile, legal, pair, awa };
  // A plan (built on Wednesday); it is now Monday of week 1.
  renderWith(d, <CalendarScreen onExit={() => undefined} />);
  fireEvent.press(screen.getByTestId('calendar-create'));
  screen.unmount();
  jest.setSystemTime(new Date(MON));
  return d;
}
type Device = ReturnType<typeof device>;

function renderWith(d: Pick<Device, 'client' | 'kv' | 'consents' | 'profile' | 'legal' | 'pair'>, ui: React.ReactElement, locale: Locale = 'en') {
  return render(
    <AppProviders syncClient={d.client} initialLocale={locale} profile={d.profile} legal={d.legal} pair={d.pair} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      {ui}
    </AppProviders>,
  );
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const text = () => JSON.stringify(screen.toJSON());

function openPreview(d: Device, locale: Locale = 'en') {
  renderWith(d, <PairScreen onExit={() => undefined} />, locale);
  press('pair-choose-Awa');
  press('pair-preview');
  for (const who of ['a', 'b'] as const) for (const id of ['first_workout', 'pair_challenge']) if (screen.queryByTestId(`pair-notice-${who}-${id}-ack`)) press(`pair-notice-${who}-${id}-ack`);
}
function start(d: Device, locale: Locale = 'en') {
  openPreview(d, locale);
  press('pair-start');
  press('pair-together-done');
}
function logTurn(rir = 2) {
  const target = screen.getByTestId('pair-target');
  const numbers = String(target.props.children[0] ?? target.props.children).match(/\d+/g)!.map(Number);
  press(`pair-reps-${numbers.length > 1 ? numbers[1] : numbers[0]}`);
  press(`pair-rir-${rir}`);
}
const turnOf = () => (screen.queryByTestId('pair-turn-a') ? 'a' : screen.queryByTestId('pair-turn-b') ? 'b' : null);
const outbox = (d: Device, collection: string) => d.client.outbox('pending').filter((o) => o.mutation.collection === collection).map((o) => o.mutation.data);

function expectEveryControlLabelled() {
  const unlabelled: string[] = [];
  const walk = (node: typeof screen.root) => {
    const p = node.props as Record<string, unknown>;
    const control = ['button', 'switch', 'radio', 'togglebutton', 'checkbox', 'link'].includes(String(p.accessibilityRole));
    if (typeof node.type === 'string' && control && (typeof p.accessibilityLabel !== 'string' || p.accessibilityLabel.trim() === '')) unlabelled.push(String(p.testID ?? node.type));
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(screen.root);
  expect(unlabelled).toEqual([]);
}

describe('body weight is hidden from the partner view unless its owner opts in (goal condition 6)', () => {
  it('by default neither body weight is shown, in any state of the session', () => {
    const d = device();
    start(d);
    for (let i = 0; i < 6; i++) {
      expect(screen.queryByTestId('pair-card-a-bodyweight')).toBeNull();
      expect(screen.queryByTestId('pair-card-b-bodyweight')).toBeNull();
      expect(text()).not.toMatch(/120\s?kg|60\s?kg/);
      logTurn();
    }
  });

  it('when Ibrahima opts in, his body weight appears on his card for Awa; Awa’s stays hidden (she did not opt in)', () => {
    const d = device({ ownerScopes: ['bodyweight'] });
    start(d);
    expect(turnOf()).toBe('a');
    logTurn(); // now Awa's turn: Ibrahima's card is the partner card.
    expect(turnOf()).toBe('b');
    expect(screen.getByTestId('pair-card-a-bodyweight').props.children).toBe(tr('en').t('pair.card.bodyweight', { weight: '120 kg' }));
    expect(screen.queryByTestId('pair-card-b-bodyweight')).toBeNull();
    expect(text()).not.toMatch(/60\s?kg/);
  });

  it('a withdrawn partner-sharing consent hides it again at once (nothing is shared without consent)', () => {
    const d = device({ ownerScopes: ['bodyweight', 'performance'] });
    d.consents.getState().decide('partner_sharing', false, 'en');
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-choose-Awa');
    press('pair-preview');
    // The owner must consent again before any pair session.
    expect(screen.getByTestId('pair-error').props.children).toBe(tr('en').t('pair.consent.required'));
    expect(screen.getByTestId('pair-owner-consent')).toBeTruthy();
  });
});

describe('consent (goal condition 7): each person’s own L2 documents and sharing consent; the challenge is off by default', () => {
  it('a partner who has not accepted her own Terms, Privacy and exercise risk cannot be chosen for a session', () => {
    const d = device({ guestAccepts: ['terms'] });
    renderWith(d, <PairScreen onExit={() => undefined} />);
    expect(screen.getByText(tr('en').t('pair.partner.incomplete'))).toBeTruthy();
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-error').props.children).toBe(tr('en').t('pair.partner.needed'));
    expect(screen.queryByTestId('pair-preview')).toBeTruthy(); // still the set-up button, no preview screen
    expect(screen.queryByTestId('pair-start')).toBeNull();
  });

  it('the owner’s acceptances never count for the partner: without her own health consent there is no session for her', () => {
    const d = device({ guestConsents: ['partner_sharing'] });
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-error')).toBeTruthy();
    expect(screen.queryByTestId('pair-start')).toBeNull();
  });

  it('without her own partner-sharing consent, the partner is not ready either (her data is not shared)', () => {
    const d = device({ guestConsents: ['health'] });
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-error').props.children).toBe(tr('en').t('pair.partner.needed'));
  });

  it('the Fair Challenge is off by default, and off when only one of them chose it; no score is shown', () => {
    for (const o of [{}, { ownerScopes: ['challenge'] as PairSharingScope[] }, { guestScopes: ['challenge'] as PairSharingScope[] }]) {
      const d = device(o);
      openPreview(d);
      expect(screen.getByTestId('pair-challenge-status').props.children).toBe(tr('en').t('pair.challenge.off'));
      expect(screen.queryByTestId('pair-notice-a-pair_challenge')).toBeNull();
      press('pair-start');
      screen.unmount();
      const [session] = d.pair.getState().sessions;
      expect(session!.challenge).toBe(false);
    }
  });

  it('when both choose it: each acknowledges the challenge notice in their own ledger (L3) before the start, and both chains log it', () => {
    const d = device({ ownerScopes: ['challenge'], guestScopes: ['challenge'] });
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-challenge-status').props.children).toBe(tr('en').t('pair.challenge.on'));
    expect(screen.getByTestId('pair-notice-a-pair_challenge')).toBeTruthy();
    expect(screen.getByTestId('pair-notice-b-pair_challenge')).toBeTruthy();
    for (const id of ['first_workout', 'pair_challenge']) press(`pair-notice-a-${id}-ack`);
    press('pair-notice-b-first_workout-ack');
    // One notice still pending (Awa's): the start waits.
    expect(screen.getByTestId('pair-start').props.accessibilityState.disabled).toBe(true);
    press('pair-notice-b-pair_challenge-ack');
    press('pair-start');
    const guestLegal = d.pair.getState().ledgers(d.awa.id).legal.getState();
    expect(guestLegal.notices.filter((n) => n.noticeId === 'pair_challenge').map((n) => n.kind)).toEqual(['shown', 'acknowledged']);
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'pair_challenge').map((n) => n.kind)).toEqual(['shown', 'acknowledged']);
    for (const events of [guestLegal.events, d.legal.getState().events]) expect(events.map((e) => e.type)).toContain('pair.challenge_started');
    // Both finish their plans: the scores are shown, each against their own plan.
    press('pair-together-done');
    for (let guard = 0; guard < 80 && !screen.queryByTestId('pair-done'); guard++) {
      if (screen.queryByTestId('pair-together')) press('pair-together-done');
      else logTurn();
    }
    expect(screen.getByTestId('pair-score-a').props.children).toBe(tr('en').t('pair.done.score', { name: 'Ibrahima', points: 100 }));
    expect(screen.getByTestId('pair-score-b').props.children).toBe(tr('en').t('pair.done.score', { name: 'Awa', points: 100 }));
  });

  it('A6: the end of a session shows a cooperative summary by default; each person’s count only on request', () => {
    const d = device();
    start(d);
    for (let guard = 0; guard < 80 && !screen.queryByTestId('pair-done'); guard++) {
      if (screen.queryByTestId('pair-together')) press('pair-together-done');
      else logTurn();
    }
    const done = d.pair.getState().guest(d.awa.id)!.setLogs.length + outbox(d, 'set_logs').length;
    expect(screen.getByTestId('pair-done-together').props.children).toBe(tr('en').t('pair.done.together', { count: done }));
    expect(screen.queryByTestId('pair-done-a')).toBeNull();
    expect(screen.queryByTestId('pair-done-b')).toBeNull();
    press('pair-done-show-each');
    expect(screen.getByTestId('pair-done-a')).toBeTruthy();
    expect(screen.getByTestId('pair-done-b')).toBeTruthy();
  });
});

describe('the S7 / M17 age gate applies to the partner too', () => {
  it.each([
    ['2011', true], // 15 on Monday 28 September 2026: blocked, nothing kept
    ['2010', false], // 16: allowed
  ])('a partner born in 1 June %s → blocked: %s', (year, blocked) => {
    const d = device();
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-add-partner');
    fireEvent.changeText(screen.getByTestId('pair-guest-name'), 'Nour');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-day'), '1');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-month'), '6');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-year'), year);
    press('pair-guest-next');
    if (blocked) {
      expect(screen.getByTestId('pair-guest-error').props.children).toBe(tr('en').t('pair.guest.notAvailable'));
      expect(screen.queryByTestId('pair-guest-legal')).toBeNull();
      // Nothing about the minor is kept: no guest record, no ledger.
      expect(d.pair.getState().guests.map((g) => g.displayName)).toEqual(['Awa']);
      expect(text()).not.toMatch(/\b(15|16) years?\b/i);
    } else {
      // MOB-10: Nour first confirms it is her holding the phone.
      expect(screen.getByTestId('pair-guest-handover')).toBeTruthy();
      press('pair-guest-confirm');
      press('pair-guest-next');
      expect(screen.getByTestId('pair-guest-legal')).toBeTruthy();
      expect(d.pair.getState().guests.map((g) => g.displayName)).toEqual(['Awa', 'Nour']);
    }
  });

  it('an invalid or future date is refused', () => {
    const d = device();
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-add-partner');
    fireEvent.changeText(screen.getByTestId('pair-guest-name'), 'Nour');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-day'), '31');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-month'), '2');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-year'), '1990');
    press('pair-guest-next');
    expect(screen.getByTestId('pair-guest-error').props.children).toBe(tr('en').t('pair.guest.birthInvalid'));
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-day'), '1');
    fireEvent.changeText(screen.getByTestId('pair-guest-birth-year'), '2030');
    press('pair-guest-next');
    expect(screen.getByTestId('pair-guest-error').props.children).toBe(tr('en').t('pair.guest.birthInvalid'));
  });
});

describe('each person’s safety applies on its own (S2, S3) and logs stay per person', () => {
  it('S3: Awa reports chest pain — her session ends, she sees seek-care, her intensity locks; Ibrahima goes on alone and is not told why', () => {
    const d = device({ ownerScopes: ['challenge'], guestScopes: ['challenge'] });
    start(d);
    logTurn(); // Ibrahima
    press('pair-stop-b');
    press('pair-stop-symptom-chest_pain_pressure');
    expect(screen.getByTestId('pair-seek-care')).toBeTruthy();
    expect(screen.getByTestId('pair-seek-care-emergency').props.children).toContain('999');
    expect(screen.getByTestId('pair-message').props.children).toBe(tr('en').t('pair.left', { name: 'Awa', other: 'Ibrahima' }));
    // Ibrahima goes on alone.
    expect(turnOf()).toBe('a');
    logTurn();
    expect(turnOf()).toBe('a');
    // Awa's own records: red flag, ended, S3 events and the notice in HER ledger; her intensity is locked.
    const guest = d.pair.getState().guest(d.awa.id)!;
    expect(guest.executionLogs.map((e) => e.kind)).toEqual(['red_flag', 'ended']);
    expect(intensityLockStatus(guest.executionLogs).locked).toBe(true);
    const guestLegal = d.pair.getState().ledgers(d.awa.id).legal.getState();
    expect(guestLegal.events.filter((e) => e.type === 'safety.event').map((e) => (e.payload as { invariant: string; action: string }).action)).toEqual(expect.arrayContaining(['session_ended', 'intensity_locked']));
    expect(guestLegal.events.find((e) => e.type === 'pair.left')!.payload).toMatchObject({ reason: 'safety_stop' });
    expect(guestLegal.notices.map((n) => n.noticeId)).toContain('seek_care');
    expect(verifyChain(guestLegal.events).ok).toBe(true);
    // Ibrahima's records: nothing about Awa's symptom, only that his partner left (no reason).
    const owner = d.legal.getState().events;
    expect(owner.find((e) => e.type === 'pair.partner_left')!.payload).toEqual({ pairSessionId: expect.any(String) });
    expect(owner.some((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S3')).toBe(false);
    expect(JSON.stringify(d.client.outbox('pending'))).not.toMatch(/chest_pain|red_flag/);
    expect(d.profile.getState().executionLogs.map((e) => e.data.kind)).toEqual([]);
    // The next time, Awa gets no session until she attests a medical review (S3 is hers, the pair cannot bypass it).
    for (let guard = 0; guard < 60 && !screen.queryByTestId('pair-done'); guard++) press('pair-skip');
    expect(screen.getByTestId('pair-score-hidden')).toBeTruthy(); // the challenge ended without saying why
    screen.unmount();
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-unavailable')).toBeTruthy();
    expect(text()).not.toMatch(/chest|intensity|medical/i);
  });

  it('S2: Awa rates her knee 7 — only her plan changes; Ibrahima’s exercises stay as prescribed', () => {
    const d = device();
    start(d);
    const before = (outbox(d, 'workout_sessions')[0] as WorkoutSessionRecord).plan.exercises.map((e) => e.exerciseId);
    press('pair-pain-b');
    press('pair-pain-joint-knee');
    press('pair-pain-score-7');
    press('pair-pain-save');
    expect(screen.getByTestId('pair-message').props.children).toBe(tr('en').t('pair.pain.saved', { name: 'Awa' }));
    const guest = d.pair.getState().guest(d.awa.id)!;
    expect(guest.executionLogs[0]).toMatchObject({ kind: 'pain', joint: 'knee', score: 7 });
    // Ibrahima: no pain log, no swap; his remaining turns use his own prescription.
    expect(d.profile.getState().executionLogs).toEqual([]);
    for (let guard = 0; guard < 80 && !screen.queryByTestId('pair-done'); guard++) {
      if (screen.queryByTestId('pair-together')) press('pair-together-done');
      else logTurn();
    }
    const ownerSets = outbox(d, 'set_logs') as SetLog[];
    expect([...new Set(ownerSets.map((s) => s.exerciseId))].every((id) => before.includes(id))).toBe(true);
    // Awa's plan changed for her knee (S2 now: swapped or dropped), in her own logs only.
    const after = d.pair.getState().guest(d.awa.id)!.executionLogs.map((e) => e.kind);
    expect(after.some((k) => k === 'swapped' || k === 'exercise_skipped')).toBe(true);
    expect(d.profile.getState().executionLogs.map((e) => e.data.kind)).toEqual(['ended']);
  });

  it('integration FIX-B CS-5 in Fair Pair: after a pain rating of 6 or more, the urgent-signs step for that person; a sign ends HER session with the urgent-care notice', () => {
    const d = device();
    start(d);
    // A rating below S2 red asks nothing more.
    press('pair-pain-b');
    press('pair-pain-joint-knee');
    press('pair-pain-score-5');
    press('pair-pain-save');
    expect(screen.queryByTestId('workout-urgent-check')).toBeNull();
    // Red (≥ 6): the step appears, naming Awa.
    press('pair-pain-b');
    press('pair-pain-joint-knee');
    press('pair-pain-score-6');
    press('pair-pain-save');
    expect(screen.getByTestId('workout-urgent-check')).toBeTruthy();
    expect(text()).toContain(tr('en').t('pair.urgent.for', { name: 'Awa', title: tr('en').t('workout.urgent.title') }));
    press('workout-urgent-msk_cannot_bear_weight');
    expect(screen.queryByTestId('workout-urgent-check')).toBeNull();
    expect(screen.getByTestId('pair-seek-care')).toBeTruthy();
    const guest = d.pair.getState().guest(d.awa.id)!;
    // (S2 swaps and skips for the red knee are logged too, as before.)
    expect(guest.executionLogs.map((e) => e.kind).filter((k) => k !== 'swapped' && k !== 'exercise_skipped')).toEqual(['pain', 'pain', 'red_flag', 'ended']);
    expect(guest.executionLogs.find((e) => e.kind === 'red_flag')).toMatchObject({ kind: 'red_flag', symptom: 'msk_cannot_bear_weight' });
    expect(intensityLockStatus(guest.executionLogs).locked).toBe(true);
    const guestLegal = d.pair.getState().ledgers(d.awa.id).legal.getState();
    expect(guestLegal.notices.map((n) => n.noticeId)).toContain('urgent_care');
    expect(guestLegal.notices.map((n) => n.noticeId)).not.toContain('seek_care');
    // Ibrahima goes on alone; nothing about Awa's sign reaches his records.
    expect(turnOf()).toBe('a');
    expect(JSON.stringify(d.client.outbox('pending'))).not.toMatch(/msk_|red_flag/);
    expect(d.profile.getState().executionLogs).toEqual([]);
  });

  it('integration FIX-B CS-5 in Fair Pair: "none of these" closes the step and the pair goes on as before', () => {
    const d = device();
    start(d);
    press('pair-pain-a');
    press('pair-pain-joint-knee');
    press('pair-pain-score-8');
    press('pair-pain-save');
    expect(text()).toContain(tr('en').t('pair.urgent.for', { name: 'Ibrahima', title: tr('en').t('workout.urgent.title') }));
    press('workout-urgent-none');
    expect(screen.queryByTestId('workout-urgent-check')).toBeNull();
    expect(screen.queryByTestId('pair-seek-care')).toBeNull();
    expect(d.profile.getState().executionLogs.map((e) => e.data.kind).filter((k) => k !== 'swapped' && k !== 'exercise_skipped')).toEqual(['pain']);
    expect(d.profile.getState().executionLogs.some((e) => e.data.kind === 'red_flag')).toBe(false);
    expect(d.pair.getState().guest(d.awa.id)!.executionLogs).toEqual([]);
  });

  it('logs stay per person: the owner’s in his sync outbox, Awa’s in her own namespace, never mixed', () => {
    const d = device();
    start(d);
    for (let i = 0; i < 6; i++) logTurn();
    const ownerPlan = (outbox(d, 'workout_sessions')[0] as WorkoutSessionRecord).plan.planId;
    const guest = d.pair.getState().guest(d.awa.id)!;
    expect((outbox(d, 'set_logs') as SetLog[]).every((s) => s.planId === ownerPlan)).toBe(true);
    expect(outbox(d, 'set_logs')).toHaveLength(3);
    expect(guest.setLogs.map((s) => s.data.planId)).toEqual([guest.workouts[0]!.plan.planId, guest.workouts[0]!.plan.planId, guest.workouts[0]!.plan.planId]);
    expect(JSON.stringify(d.client.outbox('pending'))).not.toContain(guest.workouts[0]!.plan.planId);
  });
});

describe('the partner’s data is theirs: export and delete', () => {
  it('exports everything this phone holds about Awa, then deletes it all (ledgers, logs and the pair sessions naming her)', async () => {
    const d = device();
    start(d);
    logTurn();
    logTurn();
    screen.unmount();
    const exported = JSON.parse(d.pair.getState().exportGuest(d.awa.id)) as Record<string, unknown[] | unknown>;
    expect(exported).toMatchObject({ format: 'pair-partner-export', profile: { displayName: 'Awa', bodyweightKg: 60 } });
    expect((exported.acceptances as unknown[]).length).toBe(3);
    expect((exported.consents as unknown[]).length).toBe(2);
    expect((exported.setLogs as unknown[]).length).toBe(1);
    expect((exported.pairSessions as unknown[]).length).toBe(1);
    // MOB-06: the export is actually handed to the share sheet (to save or send), and only then reported as done.
    const share = jest.spyOn(expoProgressDeviceIo, 'shareFile');
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-export-Awa');
    await waitFor(() => expect(screen.getByTestId('pair-message').props.children).toBe(tr('en').t('pair.partner.exported', { name: 'Awa' })));
    expect(share).toHaveBeenCalledTimes(1);
    const [fileName, content, mimeType] = share.mock.calls[0]!;
    expect(fileName).toMatch(/^partner-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mimeType).toBe('application/json');
    expect(JSON.parse(content)).toMatchObject({ format: 'pair-partner-export', profile: { displayName: 'Awa', bodyweightKg: 60 } });
    expect(JSON.parse(content).setLogs).toEqual(exported.setLogs);
    share.mockRestore();
    press('pair-delete-Awa');
    expect(screen.queryByTestId('pair-choose-Awa')).toBeNull();
    expect(d.pair.getState().guest(d.awa.id)).toBeNull();
    expect(d.pair.getState().sessions).toEqual([]);
    expect([...d.kv.data.keys()].filter((k) => k.includes(d.awa.id))).toEqual([]);
    // The owner's own records are untouched.
    expect(outbox(d, 'set_logs')).toHaveLength(1);
  });

  it('MOB-09: Awa withdraws her partner-sharing consent herself, keeping her history: nothing is shared and she cannot be chosen', () => {
    const d = device({ guestScopes: ['performance'] });
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-edit-Awa');
    press('pair-guest-confirm');
    press('pair-guest-next');
    press('pair-guest-consent-partner_sharing-withdraw');
    expect(screen.getByTestId('pair-guest-consent-partner_sharing-withdrawn')).toBeTruthy();
    const ledgers = d.pair.getState().ledgers(d.awa.id);
    const guest = d.pair.getState().guest(d.awa.id)!;
    expect(sharedScopes(ledgers.consents.getState().records, guest.sharing)).toBeNull();
    // The withdrawal is in HER ledger and her defensibility buffer, never the owner's.
    expect(ledgers.consents.getState().records.at(-1)).toMatchObject({ dataType: 'partner_sharing', decision: 'withdrawn' });
    expect(ledgers.legal.getState().events.at(-1)).toMatchObject({ type: 'consent.recorded', payload: { dataType: 'partner_sharing', decision: 'withdrawn' } });
    expect(d.consents.getState().records.filter((r) => r.decision === 'withdrawn')).toEqual([]);
    // Her history stays; she is no longer ready for a pair session.
    expect(guest.profile.screening).not.toBeNull();
    press('pair-guest-cancel');
    press('pair-choose-Awa');
    press('pair-preview');
    expect(screen.getByTestId('pair-error').props.children).toBe(tr('en').t('pair.partner.needed'));
  });

  it('MOB-09 / MOB-08: withdrawing her health consent forgets her answers and body weight, but never her S3 intensity lock', () => {
    const d = device();
    d.pair.getState().guestLogExecution(d.awa.id, { kind: 'red_flag', planId: randomUUID(), symptom: 'chest_pain_pressure', at: '2026-09-27T10:00:00.000Z' });
    expect(guestFacts(d.pair.getState().guest(d.awa.id)!, Date.parse(MON)).intensityLock.locked).toBe(true);
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-edit-Awa');
    press('pair-guest-confirm');
    press('pair-guest-next');
    press('pair-guest-consent-health-withdraw');
    const guest = d.pair.getState().guest(d.awa.id)!;
    expect(guest.profile.screening).toBeNull();
    expect(guest.profile.bodyweightKg).toBeNull();
    expect(guestSafetyProfile(guest, d.pair.getState().ledgers(d.awa.id))).toMatchObject({ screeningOutcome: 'not_screened', reasonCodes: ['safety_profile.not_screened.no_consent'] });
    expect(guestFacts(guest, Date.parse(MON)).intensityLock.locked).toBe(true);
  });

  it('MOB-10: nothing goes into the partner’s ledgers until she confirms it is her, and her earlier health answers are not shown again', () => {
    const d = device();
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-edit-Awa');
    expect(screen.getByTestId('pair-guest-handover')).toBeTruthy();
    expect(screen.queryByTestId('pair-guest-consent-health')).toBeNull();
    press('pair-guest-next');
    expect(screen.getByTestId('pair-guest-error').props.children).toBe(tr('en').t('pair.guest.confirm.required', { name: 'Awa' }));
    expect(screen.queryByTestId('pair-guest-legal')).toBeNull();
    press('pair-guest-confirm');
    press('pair-guest-next');
    press('pair-guest-next');
    expect(screen.getByTestId('pair-guest-screening')).toBeTruthy();
    expect(screen.getByText(tr('en').t('pair.guest.screening.again'))).toBeTruthy();
    // Every answer is unset: "Continue" asks for all of them again.
    press('pair-guest-next');
    expect(screen.getByTestId('pair-guest-error').props.children).toBe(tr('en').t('screening.incomplete'));
  });

  it('MOB-06: when the share sheet fails, the partner is told nothing was exported', async () => {
    const d = device();
    const share = jest.spyOn(expoProgressDeviceIo, 'shareFile').mockRejectedValue(new Error('share sheet unavailable'));
    renderWith(d, <PairScreen onExit={() => undefined} />);
    press('pair-export-Awa');
    await waitFor(() => expect(screen.getByTestId('pair-message').props.children).toBe(tr('en').t('pair.partner.exportFailed', { name: 'Awa' })));
    share.mockRestore();
  });
});

describe('the pair screen in French and English', () => {
  it.each(['en', 'fr'] as const)('%s: every control is labelled; no rivalry, age, pressure, guilt or body wording', (locale) => {
    const d = device({ ownerScopes: ['performance', 'challenge'], guestScopes: ['performance', 'challenge'] });
    renderWith(d, <PairScreen onExit={() => undefined} />, locale);
    expectEveryControlLabelled();
    press('pair-choose-Awa');
    press('pair-preview');
    expectEveryControlLabelled();
    for (const who of ['a', 'b'] as const) for (const id of ['first_workout', 'pair_challenge']) press(`pair-notice-${who}-${id}-ack`);
    press('pair-start');
    press('pair-together-done');
    for (let i = 0; i < 4; i++) {
      expectEveryControlLabelled();
      const all = JSON.stringify(screen.toJSON());
      for (const s of all.match(/"[^"]{6,}"/g) ?? []) {
        expect(pairPressurePhrases(s, locale)).toEqual([]);
        expect(guiltPhrases(s, locale)).toEqual([]);
        expect(judgementalBodyTerms(s, locale)).toEqual([]);
      }
      logTurn();
    }
    expect(screen.getByTestId('pair-turn').props.children).toBe(tr(locale).t('pair.turn.title', { name: 'Ibrahima' }));
  });
});
