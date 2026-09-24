import { ENGINE_VERSION, SESSION_RULES_VERSION } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, SEED_EXERCISES } from '@fitadapt/exercise-library';
import { guiltPhrases, type Locale } from '@fitadapt/i18n';
import { SCREENING_QUESTION_IDS, type SessionPlan, type SetLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppState, type AppStateStatus } from 'react-native';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { CalendarScreen } from '../src/screens/CalendarScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { setRestNotifier } from '../src/workout/rest-timer';
import { tr, visibleStrings } from './helpers';

/**
 * M02 on the device (goal conditions 6 and 8): today's session comes from the
 * engine on the device with the network down; sets are logged in two taps
 * (reps, then reps in reserve); swap, skip, pain flag and stop work; the rest
 * timer is an end time that stays right after the app was in the background
 * (fake timers); stop and skip are visible in every execution state (L4);
 * the first-workout notice gates the first start (L3); starting writes the
 * executed prescription with engine and rules versions and reason codes to
 * the device defensibility buffer (L11). P3 (David, fictional).
 */
const WED = '2026-09-23T10:00:00.000Z';
/** Monday of week 1 of the plan built on Wednesday 23 September. */
const MON = '2026-09-28T10:00:00.000Z';

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function device(options: { yes?: string[] } = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('gym', [...EQUIPMENT_PRESETS.full_gym]);
  profile.getState().updateDraft({
    primaryGoal: 'muscle_gain',
    experience: 'intermediate',
    schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1982, month: 3, day: 14 },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, options.yes?.includes(q) ? 'yes' : 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  return { client, kv, consents, profile, legal };
}
type Device = ReturnType<typeof device>;

function renderWith(d: Device, ui: React.ReactElement, locale: Locale = 'en') {
  return render(
    <AppProviders syncClient={d.client} initialLocale={locale} profile={d.profile} legal={d.legal} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      {ui}
    </AppProviders>,
  );
}

/** P3 builds his plan on Wednesday; it is now Monday of week 1 (a training day). */
function withPlan(options: { yes?: string[] } = {}) {
  jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
  const d = device(options);
  renderWith(d, <CalendarScreen onExit={() => undefined} />);
  fireEvent.press(screen.getByTestId('calendar-create'));
  screen.unmount();
  jest.setSystemTime(new Date(MON));
  return d;
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const outbox = (d: Device, collection: string) => d.client.outbox('pending').filter((o) => o.mutation.collection === collection).map((o) => o.mutation.data);
const plan = (d: Device): SessionPlan => (outbox(d, 'workout_sessions')[0] as WorkoutSessionRecord).plan;

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

/** L4: a stop control and a skip control are on screen. */
function expectStopAndSkip() {
  expect(screen.getByTestId('workout-stop')).toBeTruthy();
  expect(screen.getByTestId('workout-skip')).toBeTruthy();
}

function openAndStart(d: Device, locale: Locale = 'en') {
  renderWith(d, <WorkoutScreen onExit={() => undefined} />, locale);
  press('notice-first_workout-ack');
  press('workout-start');
}

/** Two taps: reps, then reps in reserve (the second tap logs the set). */
function logCurrentSet(rir = 2) {
  const target = screen.getByTestId('workout-target');
  // The target text starts with the range or the hold ("8–12 reps", "30 s"); pick the top (or the hold).
  const numbers = String(target.props.children[0] ?? target.props.children).match(/\d+/g)!.map(Number);
  press(`workout-reps-${numbers.length > 1 ? numbers[1] : numbers[0]}`);
  press(`workout-rir-${rir}`);
}

describe('today’s session on the device (offline)', () => {
  it('L3: the first-workout notice is shown and must be acknowledged before the first session starts', () => {
    const t = tr('en').t;
    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('notice-first_workout')).toBeTruthy();
    expect(screen.getByText(t('legal.notice.firstWorkout.v1.title'))).toBeTruthy();
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'first_workout').map((n) => n.kind)).toEqual(['shown']);
    expect(screen.getByTestId('workout-start').props.accessibilityState).toMatchObject({ disabled: true });
    press('workout-start');
    expect(outbox(d, 'workout_sessions')).toHaveLength(0);
    press('notice-first_workout-ack');
    expect(screen.queryByTestId('notice-first_workout')).toBeNull();
    press('workout-start');
    expect(outbox(d, 'workout_sessions')).toHaveLength(1);
    screen.unmount();
    // The second session: the notice is not shown again (once per version).
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.queryByTestId('notice-first_workout')).toBeNull();
    expect((outbox(d, 'workout_sessions')[0] as WorkoutSessionRecord).firstWorkout).toBe(true);
  });

  it('shows why behind every exercise, time-boxes to the minutes picked, and all copy is labelled (FR)', () => {
    const t = tr('fr').t;
    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />, 'fr');
    press('workout-minutes-30');
    const minutes = Number(String(screen.getByTestId('workout-minutes').props.children).match(/\d+/)![0]);
    expect(minutes).toBeLessThanOrEqual(30);
    press('workout-why-0');
    expect(screen.getAllByTestId(/^workout-why-0-/).length).toBeGreaterThan(0);
    for (const text of visibleStrings()) {
      expect(text).not.toMatch(/^(engine|workout|legal)\.[a-z]/);
      expect(guiltPhrases(text, 'fr')).toEqual([]);
    }
    expect(screen.getByText(t('workout.title'))).toBeTruthy();
    expectEveryControlLabelled();
  });

  it('runs a full session: 2-tap logging, autoregulation, rest, swap, skip and a pain flag; L11 on the device; no network', () => {
    const d = withPlan();
    openAndStart(d);
    const record = outbox(d, 'workout_sessions')[0] as WorkoutSessionRecord;
    expect(record.plan).toMatchObject({ kind: 'program_session', engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION });
    expect(record.plan.exercises.length).toBeGreaterThanOrEqual(3);
    // L11: the prescription (engine + rules versions, every reason code) is in the device buffer.
    const issued = d.legal.getState().events.filter((e) => e.type === 'prescription.issued');
    expect(issued).toHaveLength(1);
    const payload = issued[0]!.payload as { prescriptionId: string; engineVersion: string; rulesVersion: string; reasonCodes: string[] };
    expect(payload).toMatchObject({ prescriptionId: record.plan.planId, engineVersion: ENGINE_VERSION, rulesVersion: SESSION_RULES_VERSION });
    const codes = new Set(record.plan.exercises.flatMap((e) => e.sets.flatMap((s) => s.reasonCodes)));
    for (const code of codes) expect(payload.reasonCodes).toContain(code);

    // Set 1: two taps. The load defaults to the planned load.
    expectStopAndSkip();
    logCurrentSet();
    let logs = outbox(d, 'set_logs') as SetLog[];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ planId: record.plan.planId, exerciseIndex: 0, set: { status: 'done', rir: 2, loadKg: record.plan.exercises[0]!.sets[0]!.loadKg } });
    // Rest: stop and skip are still there.
    expect(screen.getByTestId('workout-phase-rest')).toBeTruthy();
    expectStopAndSkip();
    press('workout-skip');

    // Swap the current exercise.
    press('workout-swap');
    expect(screen.getByTestId('workout-sheet-skip')).toBeTruthy();
    expect(screen.getByTestId('workout-sheet-stop')).toBeTruthy();
    const option = screen.getAllByTestId(/^workout-swap-option-/)[0]!;
    const replacementId = (option.props.testID as string).replace('workout-swap-option-', '');
    fireEvent.press(option);
    expect(outbox(d, 'execution_logs')).toMatchObject([{ kind: 'swapped', exerciseIndex: 0, fromExerciseId: record.plan.exercises[0]!.exerciseId, replacement: { exerciseId: replacementId }, reason: 'user' }]);
    // A set with a harder effort than planned: logged as done.
    logCurrentSet(0);
    press('workout-skip');

    // Skip the rest of the exercise.
    press('workout-skip-exercise');
    expect(screen.getByTestId(/^workout-set-1-0$/)).toBeTruthy();

    // Pain flag: lower back 7 (red) swaps or skips every remaining exercise that loads it (S2).
    press('workout-pain');
    press('workout-pain-joint-lumbar');
    press('workout-pain-score-7');
    press('workout-pain-save');
    const events = outbox(d, 'execution_logs') as { kind: string; exerciseIndex?: number; replacement?: { exerciseId: string }; reason?: string }[];
    expect(events.some((e) => e.kind === 'pain')).toBe(true);
    expect(screen.getByTestId('workout-message')).toBeTruthy();
    const lumbarLoad = (id: string) => SEED_EXERCISES.find((e) => e.id === id)!.jointLoad.lumbar;
    for (const e of events.filter((x) => x.kind === 'swapped' && x.reason === 'pain')) expect(lumbarLoad(e.replacement!.exerciseId)).toBe('low');
    const handled = new Set(events.filter((e) => (e.kind === 'swapped' && e.reason === 'pain') || e.kind === 'exercise_skipped').map((e) => e.exerciseIndex));
    const lumbarLater = record.plan.exercises.filter((e, i) => i >= 1 && lumbarLoad(e.exerciseId) !== 'low');
    expect(lumbarLater.length).toBeGreaterThan(0);
    record.plan.exercises.forEach((e, i) => {
      if (i >= 1 && lumbarLoad(e.exerciseId) !== 'low') expect(handled.has(i)).toBe(true);
    });

    // Skip each remaining set until the session ends.
    for (let guard = 0; guard < 60 && !screen.queryByTestId('workout-done'); guard++) {
      expectStopAndSkip();
      press('workout-skip');
    }
    expect(screen.getByTestId('workout-done')).toBeTruthy();
    expect(outbox(d, 'execution_logs').at(-1)).toMatchObject({ kind: 'ended', reason: 'completed' });
    logs = outbox(d, 'set_logs') as SetLog[];
    expect(logs.filter((l) => l.set.status === 'done')).toHaveLength(2);
    expect(logs.every((l) => l.planId === record.plan.planId && l.correctionOf === null)).toBe(true);
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'en')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('L4: stop and skip are visible in every execution state and every sheet; stop ends the session calmly', () => {
    const d = withPlan();
    openAndStart(d, 'fr');
    for (const sheet of ['workout-swap', 'workout-pain', 'workout-stop']) {
      expectStopAndSkip();
      press(sheet);
      expect(screen.getByTestId('workout-sheet-skip')).toBeTruthy();
      expect(screen.getByTestId('workout-sheet-stop')).toBeTruthy();
      expectEveryControlLabelled();
      fireEvent(screen.getByTestId(sheet === 'workout-stop' ? 'workout-sheet-stop-menu' : `workout-sheet-${sheet.replace('workout-', '')}`), 'requestClose');
    }
    logCurrentSet();
    expect(screen.getByTestId('workout-phase-rest')).toBeTruthy();
    expectStopAndSkip();
    expectEveryControlLabelled();
    press('workout-stop');
    press('workout-sheet-stop');
    expect(screen.getByTestId('workout-ended')).toBeTruthy();
    expect(outbox(d, 'execution_logs').at(-1)).toMatchObject({ kind: 'ended', reason: 'user_stop' });
  });

  it('the rest timer is an end time on the device: correct after the app was in the background (fake timers)', () => {
    const listeners: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (s: AppStateStatus) => void);
      return { remove: () => listeners.splice(listeners.indexOf(listener as (s: AppStateStatus) => void), 1) } as ReturnType<typeof AppState.addEventListener>;
    });
    const scheduled: number[] = [];
    let cancelled = 0;
    const previous = setRestNotifier({ schedule: (at) => scheduled.push(at), cancel: () => (cancelled += 1) });
    try {
      const d = withPlan();
      openAndStart(d);
      const rest = plan(d).exercises[0]!.sets[0]!.restSeconds;
      expect(rest).toBeGreaterThan(30);
      const startedRest = Date.now();
      logCurrentSet();
      const shown = () => String(screen.getByTestId('workout-rest-remaining').props.children);
      const clockText = (ms: number) => {
        const s = Math.ceil(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      };
      expect(shown()).toBe(clockText(rest * 1000));
      act(() => jest.advanceTimersByTime(10_000));
      expect(shown()).toBe(clockText(rest * 1000 - 10_000));
      // Background: the lock-screen notice is scheduled for the end time; JS timers stop.
      act(() => listeners.forEach((l) => l('background')));
      expect(scheduled).toEqual([startedRest + rest * 1000]);
      // 25 s pass with no JS timer running (the OS paused the app).
      jest.setSystemTime(new Date(Date.now() + 25_000));
      act(() => listeners.forEach((l) => l('active')));
      expect(shown()).toBe(clockText(rest * 1000 - 35_000));
      // Much later: the rest is over (never negative), and the next set is offered.
      jest.setSystemTime(new Date(Date.now() + rest * 1000));
      act(() => listeners.forEach((l) => l('active')));
      expect(shown()).toBe('00:00');
      expect(screen.getByText(tr('en').t('workout.rest.over'))).toBeTruthy();
      expectStopAndSkip();
      press('workout-skip');
      expect(screen.getByTestId('workout-phase-set')).toBeTruthy();
      expect(cancelled).toBeGreaterThan(0);
    } finally {
      setRestNotifier(previous);
    }
  });

  it('S3: a red-flag stop ends the session, shows seek-care, locks intensity until a review is attested (L11 events on the device)', () => {
    const t = tr('en').t;
    const d = withPlan();
    openAndStart(d);
    press('workout-stop');
    press('workout-stop-symptom-chest_pain_pressure');
    expect(screen.getByTestId('workout-red_flag')).toBeTruthy();
    expect(screen.getByTestId('notice-seek_care')).toBeTruthy();
    press('notice-seek_care-ack');
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'seek_care').map((n) => n.kind)).toEqual(['shown', 'acknowledged']);
    expect(outbox(d, 'execution_logs').slice(-2)).toMatchObject([{ kind: 'red_flag', symptom: 'chest_pain_pressure' }, { kind: 'ended', reason: 'red_flag' }]);
    const s3 = d.legal.getState().events.filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S3').map((e) => (e.payload as { action: string }).action);
    expect(s3).toEqual(['session_ended', 'intensity_locked']);
    screen.unmount();

    // Wednesday (the next training day): no session until the review is attested.
    jest.setSystemTime(new Date(Date.parse(MON) + 2 * 24 * 3600_000));
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('workout-locked')).toBeTruthy();
    expect(screen.getByText(t('engine.reason.session.unavailable.s3_intensity_locked'))).toBeTruthy();
    expect(screen.queryByTestId('workout-start')).toBeNull();
    press('workout-attest');
    // M05: the review is confirmed in two steps (the statement, then "I confirm").
    expect(screen.getByTestId('workout-attest-statement')).toBeTruthy();
    press('workout-attest-confirm');
    expect(d.legal.getState().events.at(-1)).toMatchObject({ type: 'safety.attested', payload: { invariant: 'S3' } });
    expect(screen.queryByTestId('workout-locked')).toBeNull();
    expect(screen.getByTestId('workout-start')).toBeTruthy();
  });

  it('S1: a flagged user’s session is capped at RPE 7 (at least 3 reps in reserve)', () => {
    const d = withPlan({ yes: ['chest_discomfort'] });
    openAndStart(d);
    const p = plan(d);
    expect(p.targetRir).toBeGreaterThanOrEqual(3);
    expect(p.exercises.every((e) => e.sets.every((s) => s.targetRir >= 3))).toBe(true);
  });

  it('the home screen opens today’s session once the L2 gate is open', () => {
    const d = withPlan();
    const opened: string[] = [];
    renderWith(d, <HomeScreen onStartOnboarding={() => undefined} onOpenWorkout={() => opened.push('workout')} />);
    press('open-workout');
    expect(opened).toEqual(['workout']);
  });
});
