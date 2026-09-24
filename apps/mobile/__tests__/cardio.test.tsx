import { createEngineContext, fixedClock } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, generateSession } from '@fitadapt/exercise-library';
import { fatBurnClaims, guiltPhrases, type Locale } from '@fitadapt/i18n';
import { SCREENING_QUESTION_IDS, type ExecutionLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppState, type AppStateStatus } from 'react-native';
import { AppProviders } from '../src/AppProviders';
import { setCueOutputs, type CueOutput } from '../src/cardio/cue-output';
import { setHeartRateSource, useManualHeartRate } from '../src/cardio/heart-rate';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectHistory, selectSafetyProfile } from '../src/profile/selectors';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr, visibleStrings } from './helpers';

/**
 * M03 on the device (goal conditions 2, 4, 5 and 7): cardio sessions from the
 * engine with the network down; the first HIIT session cannot start before
 * the L3 intensity notice is shown and confirmed; gated users see HIIT as
 * not available and why; the interval timer speaks FR/EN cues and vibrates,
 * keeps going with the app in the background (audio session for background
 * playback, expo-speech / expo-haptics / expo-audio test harness in
 * jest.setup.js); the block's minutes go to the weekly ledger shown against
 * 150–300 minutes. Fictional people only.
 */
const NOW = '2026-10-12T07:00:00.000Z';
const DAY = 86_400_000;
const speech = jest.requireMock('expo-speech') as { __spoken: { text: string; language: string }[] };
const haptics = jest.requireMock('expo-haptics') as { __felt: string[] };
const audio = jest.requireMock('expo-audio') as { __modes: Record<string, unknown>[] };

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  speech.__spoken.length = 0;
  haptics.__felt.length = 0;
  audio.__modes.length = 0;
  useManualHeartRate.setState({ restingBpm: null });
  jest.useFakeTimers({ now: new Date(NOW), doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function device(options: { yes?: string[]; trainedDaysAgo?: number[]; weightKg?: number | null; heightCm?: number | null } = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'FR' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'FR' });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('home', [...EQUIPMENT_PRESETS.home_basic]);
  profile.getState().updateDraft({
    primaryGoal: 'fat_loss',
    experience: 'intermediate',
    schedule: { daysPerWeek: 3, minutesPerSession: 30, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1990, month: 5, day: 20 },
    biometrics: { heightCm: options.heightCm ?? null, weightKg: options.weightKg ?? null, bodyFatPercent: null },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, options.yes?.includes(q) ? 'yes' : 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 20 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  // Earlier steady cardio sessions (engine plans at their own time), each run to the end.
  for (const [i, daysAgo] of (options.trainedDaysAgo ?? []).entries()) {
    const at = Date.parse(NOW) - daysAgo * DAY;
    const input = { jointFlags: {}, history: [], recentLoads: [], localDate: null, intensityLock: { locked: false, since: null }, safetyProfile: selectSafetyProfile(profile.getState().screenings, consents.getState().records), equipment: [...EQUIPMENT_PRESETS.home_basic], minutesAvailable: 30, mode: 'cardio' as const, cardio: { protocol: 'steady' as const }, birthDate: { year: 1990, month: 5, day: 20 } };
    const r = generateSession(input, createEngineContext({ clock: fixedClock(at), seed: i + 1 }));
    if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
    const startedAt = new Date(at).toISOString();
    profile.getState().saveWorkout({ schemaVersion: 1, input: input as WorkoutSessionRecord['input'], plan: r.plan, safetyEvents: [], startedAt, jurisdiction: 'FR', firstWorkout: i === 0 });
    profile.getState().logExecution({ kind: 'cardio_done', planId: r.plan.planId, protocol: 'steady', moderateSeconds: r.plan.cardio!.planned.moderateSeconds, vigorousSeconds: 0, completedWork: 1, totalWork: 1, rounds: null, endedEarly: false, at: new Date(at + 30 * 60_000).toISOString() });
  }
  return { client, kv, consents, profile, legal };
}
type Device = ReturnType<typeof device>;

function renderWith(d: Device, locale: Locale = 'en') {
  return render(
    <AppProviders syncClient={d.client} initialLocale={locale} profile={d.profile} legal={d.legal} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      <WorkoutScreen onExit={() => undefined} />
    </AppProviders>,
  );
}
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const outbox = (d: Device, collection: string) => d.client.outbox('pending').filter((o) => o.mutation.collection === collection).map((o) => o.mutation.data);
const TWO_WEEKS = [15, 13, 11, 9, 6, 4, 2];

describe('first HIIT session: the L3 intensity notice (goal condition 7)', () => {
  it('cannot start before the intensity notice is shown and confirmed; the next HIIT session does not ask again', () => {
    const d = device({ trainedDaysAgo: TWO_WEEKS });
    renderWith(d);
    press('workout-mode-cardio');
    press('cardio-protocol-hiit');
    expect(screen.getByTestId('cardio-summary')).toBeTruthy();
    // This is also the device's first workout: its notice comes first, then the intensity notice.
    press('notice-first_workout-ack');
    expect(screen.getByTestId('notice-first_hiit')).toBeTruthy();
    expect(screen.getByTestId('cardio-hiit-notice-first')).toBeTruthy();
    expect(screen.getByTestId('workout-start').props.accessibilityState).toMatchObject({ disabled: true });
    // A press while the notice is pending does nothing: no session is stored.
    press('workout-start');
    expect(outbox(d, 'workout_sessions').filter((r) => (r as WorkoutSessionRecord).plan.cardio?.hiit)).toHaveLength(0);
    expect(screen.queryByTestId('workout-phase-cardio')).toBeNull();
    // Shown was recorded (L3, L11 on the device), then the confirmation.
    const shown = d.legal.getState().notices.filter((n) => n.noticeId === 'first_hiit');
    expect(shown.map((n) => n.kind)).toEqual(['shown']);
    press('notice-first_hiit-ack');
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'first_hiit').map((n) => n.kind)).toEqual(['shown', 'acknowledged']);
    expect(d.legal.getState().events.some((e) => e.type === 'notice.acknowledged' && (e.payload as { noticeId: string }).noticeId === 'first_hiit')).toBe(true);
    expect(screen.getByTestId('workout-start').props.accessibilityState).toMatchObject({ disabled: false });
    press('workout-start');
    expect(screen.getByTestId('workout-phase-cardio')).toBeTruthy();
    const record = outbox(d, 'workout_sessions').at(-1) as WorkoutSessionRecord;
    expect(record.plan.cardio).toMatchObject({ protocol: 'hiit', hiit: true });
    // L11: the prescription with its cardio reason codes.
    const issued = d.legal.getState().events.filter((e) => e.type === 'prescription.issued').at(-1)!;
    expect((issued.payload as { reasonCodes: string[] }).reasonCodes).toEqual(expect.arrayContaining(['cardio.protocol.hiit', 'cardio.hiit.gates_passed', 'cardio.zones.perceived_exertion']));
    screen.unmount();
    // Next time: no intensity notice.
    renderWith(d);
    press('workout-mode-cardio');
    press('cardio-protocol-tabata');
    expect(screen.queryByTestId('notice-first_hiit')).toBeNull();
    expect(screen.getByTestId('workout-start').props.accessibilityState).toMatchObject({ disabled: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('steady cardio never asks for the intensity notice', () => {
    const d = device();
    renderWith(d);
    press('workout-mode-cardio');
    press('notice-first_workout-ack');
    expect(screen.queryByTestId('notice-first_hiit')).toBeNull();
    expect(screen.getByTestId('workout-start').props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('gated users (goal condition 4)', () => {
  it('without two weeks of logged training, or with an unresolved screening flag, HIIT is not available and says why', () => {
    for (const [d, reason] of [
      [device(), 'cardio.unavailable.hiit_needs_consistent_training'],
      [device({ yes: ['heart_or_blood_pressure'], trainedDaysAgo: TWO_WEEKS }), 'cardio.unavailable.hiit_s1'],
    ] as const) {
      renderWith(d);
      press('workout-mode-cardio');
      expect(screen.getByTestId('cardio-protocol-hiit').props.accessibilityLabel).toBe(tr('en').t('cardio.protocol.locked', { protocol: tr('en').t('cardio.protocol.hiit') }));
      press('cardio-protocol-hiit');
      expect(screen.getByTestId('workout-unavailable')).toBeTruthy();
      expect(screen.getByText(tr('en').t(`engine.reason.${reason}` as never))).toBeTruthy();
      expect(screen.queryByTestId('workout-start')).toBeNull();
      press('cardio-protocol-steady');
      expect(screen.getByTestId('workout-start')).toBeTruthy();
      screen.unmount();
    }
  });

  it('BMI ≥ 35: low-impact movements by default, with an opt-up', () => {
    const d = device({ weightKg: 120, heightCm: 178, trainedDaysAgo: TWO_WEEKS });
    renderWith(d);
    press('workout-mode-cardio');
    press('cardio-protocol-hiit');
    press('notice-first_workout-ack');
    const lowText = tr('en').t('engine.reason.cardio.impact.low_default.bmi');
    expect(screen.getByText(lowText)).toBeTruthy();
    expect(screen.queryByTestId('cardio-movement-burpee')).toBeNull();
    press('cardio-impact-up');
    expect(screen.getByText(tr('en').t('engine.reason.cardio.impact.opted_up'))).toBeTruthy();
    press('cardio-impact-down');
    expect(screen.getByText(lowText)).toBeTruthy();
  });
});

describe('eyes-free intervals: FR/EN spoken cues and haptics, also in the background (goal condition 2)', () => {
  it('plays the French cues and vibrations on time, keeps going with the app in the background, and logs the minutes', () => {
    const listeners: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (s: AppStateStatus) => void);
      return { remove: () => listeners.splice(listeners.indexOf(listener as (s: AppStateStatus) => void), 1) } as ReturnType<typeof AppState.addEventListener>;
    });
    const d = device({ trainedDaysAgo: TWO_WEEKS });
    renderWith(d, 'fr');
    press('workout-mode-cardio');
    press('cardio-protocol-tabata');
    press('notice-first_workout-ack');
    press('notice-first_hiit-ack');
    press('workout-start');
    const record = outbox(d, 'workout_sessions').at(-1) as WorkoutSessionRecord;
    const cardio = record.plan.cardio!;
    expect(cardio.protocol).toBe('tabata');
    // The audio session keeps playing with the screen locked or the app in the background.
    expect(audio.__modes.at(-1)).toMatchObject({ shouldPlayInBackground: true, playsInSilentMode: true });
    // At once: the warm-up, spoken in French.
    expect(speech.__spoken[0]).toEqual({ text: 'Échauffement tranquille pendant 5 minutes.', language: 'fr-FR' });
    expect(screen.getByTestId('cardio-segment-0')).toBeTruthy();
    // The app goes to the background just before the first work step.
    act(() => jest.advanceTimersByTime(295_000));
    act(() => listeners.forEach((l) => l('background')));
    const before = speech.__spoken.length;
    act(() => jest.advanceTimersByTime(60_000));
    const inBackground = speech.__spoken.slice(before).map((s) => s.text);
    expect(inBackground.slice(0, 3)).toEqual(['Trois', 'Deux', 'Un']);
    const firstWork = cardio.timeline.find((s) => s.kind === 'work')!;
    expect(inBackground).toContain(`C’est parti : ${tr('fr').t(`exercise.${firstWork.exerciseId}.name` as never)}. Tour 1 sur 8.`);
    expect(inBackground).toContain('Tranquille, 10 secondes.');
    expect(speech.__spoken.every((s) => s.language === 'fr-FR')).toBe(true);
    expect(haptics.__felt).toEqual(expect.arrayContaining(['impact:heavy', 'impact:light', 'selection']));
    act(() => listeners.forEach((l) => l('active')));
    // Pause, resume, skip: always there (L4), the stop control too.
    expect(screen.getByTestId('workout-stop')).toBeTruthy();
    press('cardio-pause');
    expect(screen.getByTestId('cardio-paused')).toBeTruthy();
    press('cardio-resume');
    // To the end of the block.
    act(() => jest.advanceTimersByTime(cardio.totalSeconds * 1000));
    expect(speech.__spoken.at(-1)!.text).toBe('Terminé. Prenez le temps de récupérer.');
    expect(haptics.__felt.at(-1)).toBe('notification:success');
    expect(screen.getByTestId('workout-done')).toBeTruthy();
    const logs = outbox(d, 'execution_logs') as ExecutionLog[];
    const done = logs.find((l) => l.kind === 'cardio_done' && l.planId === record.plan.planId) as Extract<ExecutionLog, { kind: 'cardio_done' }>;
    expect(done).toMatchObject({ protocol: 'tabata', vigorousSeconds: cardio.planned.vigorousSeconds, endedEarly: false });
    expect(logs.find((l) => l.kind === 'ended' && l.planId === record.plan.planId)).toMatchObject({ reason: 'completed' });
    // The weekly ledger, shown against 150–300 minutes (vigorous minutes count double).
    expect(screen.getByTestId('cardio-ledger')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('English cues through a replaced output (the port), a skipped step and a red pain rating that ends the block', () => {
    const said: string[] = [];
    const felt: string[] = [];
    const output: CueOutput = { speak: (text) => said.push(text), haptic: (k) => felt.push(k), stop: () => undefined };
    const previous = setCueOutputs({ output });
    try {
      const d = device();
      renderWith(d);
      press('workout-mode-cardio');
      press('notice-first_workout-ack');
      press('workout-start');
      expect(said[0]).toBe('Warm up easily for 5 minutes.');
      press('cardio-skip');
      act(() => jest.advanceTimersByTime(0));
      expect(said.at(-1)).toMatch(/steady pace for \d+ minutes\.$/);
      expect(felt).toEqual(['rest', 'work']);
      act(() => jest.advanceTimersByTime(120_000));
      press('workout-pain');
      press('workout-pain-joint-knee');
      press('workout-pain-score-7');
      press('workout-pain-save');
      expect(screen.getByTestId('workout-done')).toBeTruthy();
      const logs = outbox(d, 'execution_logs') as ExecutionLog[];
      expect(logs.find((l) => l.kind === 'pain')).toMatchObject({ joint: 'knee', score: 7, phase: 'during' });
      const done = logs.find((l) => l.kind === 'cardio_done') as Extract<ExecutionLog, { kind: 'cardio_done' }>;
      expect(done.endedEarly).toBe(true);
      expect(done.moderateSeconds).toBe(120);
      expect(screen.getByTestId('cardio-counted').props.children).toBe(tr('en').t('cardio.done.counted', { minutes: 2, vigorous: 0 }));
    } finally {
      setCueOutputs(previous);
    }
  });
});

describe('zones and the weekly ledger on the device (goal conditions 3 and 5)', () => {
  it('with a resting heart rate: heart-rate-reserve zones; without: effort and talk test; a wearable source plugs in through the port', () => {
    const d = device();
    renderWith(d);
    press('workout-mode-cardio');
    press('notice-first_workout-ack');
    expect(screen.getByText(tr('en').t('engine.reason.cardio.zones.perceived_exertion'))).toBeTruthy();
    expect(screen.getByTestId('cardio-zone').props.children.join('')).toContain(tr('en').t('cardio.zone.rpe', { min: 4, max: 6 }));
    press('cardio-hr-add');
    // Age 36 on 2026-10-12 → HRmax 208 − 0.7 × 36 = 182.8 → 183; resting 60 → moderate 60 + 0.40 × 123 … 60 + 0.59 × 123 = 109–133 bpm.
    expect(screen.getByText(tr('en').t('cardio.zone.hrMax', { bpm: 183 }))).toBeTruthy();
    expect(screen.getByTestId('cardio-zone').props.children.join('')).toContain(tr('en').t('cardio.zone.bpm', { min: 109, max: 133 }));
    press('cardio-hr-clear');
    expect(screen.queryByText(tr('en').t('cardio.zone.hrMax', { bpm: 183 }))).toBeNull();
    screen.unmount();
    const previous = setHeartRateSource({ kind: 'wearable', restingBpm: () => 55 });
    try {
      renderWith(d);
      press('workout-mode-cardio');
      expect(screen.getByText(tr('en').t('cardio.hr.source.wearable'))).toBeTruthy();
      expect(screen.getByText(tr('en').t('cardio.zone.hrMax', { bpm: 183 }))).toBeTruthy();
    } finally {
      setHeartRateSource(previous);
    }
  });

  it('shows the week against 150–300 minutes, vigorous counting double; the copy is honest (no fat-burning zone), calm and labelled, in FR and EN', () => {
    const d = device({ trainedDaysAgo: [6, 4, 2, 1] });
    for (const locale of ['en', 'fr'] as const) {
      renderWith(d, locale);
      press('workout-mode-cardio');
      // This week (Monday 2026-10-12): nothing yet; the last blocks were last week.
      expect(screen.getByTestId('cardio-ledger-summary').props.children).toBe(tr(locale).t('cardio.ledger.summary', { minutes: 0, min: 150, max: 300 }));
      for (const s of visibleStrings()) {
        expect({ s, hits: fatBurnClaims(s) }).toEqual({ s, hits: [] });
        expect({ s, hits: guiltPhrases(s, locale) }).toEqual({ s, hits: [] });
      }
      screen.unmount();
    }
    // Sunday: the four blocks of that week count.
    jest.setSystemTime(new Date(Date.parse(NOW) - DAY));
    renderWith(d);
    press('workout-mode-cardio');
    const history = selectHistory(d.profile.getState().workouts, d.profile.getState().setLogs, d.profile.getState().executionLogs, d.consents.getState().records);
    expect(history.filter((h) => (h.cardioSeconds ?? 0) > 0)).toHaveLength(4);
    const moderate = Math.round(outboxModerate(d) / 60);
    expect(screen.getByTestId('cardio-ledger-summary').props.children).toBe(tr('en').t('cardio.ledger.summary', { minutes: moderate, min: 150, max: 300 }));
  });
});

function outboxModerate(d: Device): number {
  return (outbox(d, 'execution_logs') as ExecutionLog[]).filter((l): l is Extract<ExecutionLog, { kind: 'cardio_done' }> => l.kind === 'cardio_done').reduce((s, l) => s + l.moderateSeconds, 0);
}
