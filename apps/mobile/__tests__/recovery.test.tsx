import { createEngineContext, fixedClock, type GenerateSessionInput } from '@fitadapt/engine';
import { SEED_EXERCISES, EQUIPMENT_PRESETS, generateSession } from '@fitadapt/exercise-library';
import { guiltPhrases, type Locale } from '@fitadapt/i18n';
import { SCREENING_QUESTION_IDS, type ExecutionLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { CalendarScreen } from '../src/screens/CalendarScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr, visibleStrings } from './helpers';

/**
 * M05 on the device, offline (P3, David, fictional): the optional readiness
 * check (a low score makes the session one set lighter per exercise; no
 * wearable needed), the red-flag screen at the check-in (seek-care with the
 * jurisdiction's emergency number, lock), the pain check after a session
 * and the next-morning check (not settled → red → S2 in the next session),
 * the physiotherapist suggestion after more than two weeks of amber, the
 * mobility and balance session and what the warm-up is. FR and EN.
 */
const WED = '2026-09-23T10:00:00.000Z';
const MON = '2026-09-28T10:00:00.000Z';
const DAY = 86_400_000;

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function device(options: { yes?: string[]; jurisdiction?: string } = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: options.jurisdiction ?? 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: options.jurisdiction ?? 'GB' });
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
function withPlan(options: { yes?: string[]; jurisdiction?: string } = {}) {
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

const byId = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const sessions = (d: Device) => outbox(d, 'workout_sessions') as WorkoutSessionRecord[];
const logs = (d: Device) => outbox(d, 'execution_logs') as ExecutionLog[];

function start(d: Device, locale: Locale = 'en') {
  renderWith(d, <WorkoutScreen onExit={() => undefined} />, locale);
  if (screen.queryByTestId('notice-first_workout-ack')) press('notice-first_workout-ack');
  press('workout-start');
}

describe('M05 readiness check on the device (goal condition 5)', () => {
  it('a low score trims one set per exercise and adds a rep in reserve; no wearable is needed; skipping keeps the plan', () => {
    const normal = withPlan();
    renderWith(normal, <WorkoutScreen onExit={() => undefined} />);
    press('recovery-readiness-skip');
    expect(screen.queryByTestId('recovery-readiness')).toBeNull();
    press('notice-first_workout-ack');
    press('workout-start');
    const base = sessions(normal)[0]!.plan;
    screen.unmount();

    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('recovery-readiness-save').props.accessibilityState).toMatchObject({ disabled: true });
    press('recovery-readiness-sleep-1');
    press('recovery-readiness-soreness-5');
    press('recovery-readiness-stress-4');
    press('recovery-readiness-energy-2');
    press('recovery-readiness-save');
    expect(screen.getByTestId('recovery-readiness-note').props.children.join('')).toContain(tr('en').t('recovery.readiness.done.reduced'));
    expect(outbox(d, 'readiness_checks')).toMatchObject([{ schemaVersion: 1, date: '2026-09-28', sleep: 1, soreness: 5, stress: 4, energy: 2, wearable: null }]);
    press('notice-first_workout-ack');
    press('workout-start');
    const low = sessions(d)[0]!;
    expect(low.input.readiness).toBe('reduced');
    expect(low.plan.reasonCodes).toContain('session.readiness.reduced');
    expect(low.plan.targetRir).toBe(base.targetRir + 1);
    for (const e of low.plan.exercises) expect(e.sets.length).toBe(Math.max(1, base.exercises.find((x) => x.slot === e.slot && x.role === e.role)!.sets.length - 1));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a good score keeps the session as planned', () => {
    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    for (const [q, v] of [['sleep', 5], ['soreness', 1], ['stress', 1], ['energy', 5]] as const) press(`recovery-readiness-${q}-${v}`);
    press('recovery-readiness-save');
    expect(screen.getByTestId('recovery-readiness-note').props.children.join('')).toContain(tr('en').t('recovery.readiness.done.normal'));
    press('notice-first_workout-ack');
    press('workout-start');
    expect(sessions(d)[0]!.input.readiness).toBe('normal');
  });
});

describe('M05 red flag at the check-in (goal conditions 4 and 7)', () => {
  it.each([
    ['FR', 'fr', '112'],
    ['GB', 'en', '999'],
  ] as const)('%s: seek-care guidance with %s copy and the %s number; intensity locks; S3 on the device log at once', (jurisdiction, locale, number) => {
    const d = withPlan({ jurisdiction });
    renderWith(d, <WorkoutScreen onExit={() => undefined} />, locale);
    press('recovery-redflag-fainting');
    expect(screen.getByTestId('workout-checkin-red_flag')).toBeTruthy();
    expect(screen.getByRole('header', { name: tr(locale).t('recovery.redFlag.checkin.stopTitle') })).toBeTruthy();
    expect(String(screen.getByTestId('notice-seek_care-emergency').props.children)).toContain(number);
    expect(logs(d).at(-1)).toMatchObject({ kind: 'red_flag', planId: null, symptom: 'fainting' });
    const s3 = d.legal.getState().events.filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S3').map((e) => e.payload);
    expect(s3).toMatchObject([{ reasonCode: 'safety.s3.fainting', action: 'session_ended' }, { reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked' }]);
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'seek_care')).toMatchObject([{ kind: 'shown', jurisdiction }]);
    press('notice-seek_care-ack');
    press('workout-checkin-back');
    expect(screen.getByTestId('workout-locked')).toBeTruthy();
    expect(screen.queryByTestId('workout-start')).toBeNull();
    for (const text of visibleStrings()) expect(guiltPhrases(text, locale)).toEqual([]);
    expectEveryControlLabelled();
  });
});

describe('M05 pain monitoring on the device (goal conditions 2 and 6)', () => {
  it('pain check after the session, next-morning "not settled" → red → the next session substitutes every medium/high-load exercise on that joint', () => {
    const d = withPlan();
    start(d);
    press('workout-stop');
    press('workout-sheet-stop');
    expect(screen.getByTestId('recovery-pain-after')).toBeTruthy();
    press('recovery-pain-joint-knee');
    press('recovery-pain-score-3');
    press('recovery-pain-save');
    expect(logs(d).at(-1)).toMatchObject({ kind: 'pain', joint: 'knee', score: 3, phase: 'after_session', planId: sessions(d)[0]!.plan.planId });
    press('recovery-pain-done');
    expect(screen.queryByTestId('recovery-pain-after')).toBeNull();
    screen.unmount();

    // Next morning: the knee is asked about; it has not settled.
    jest.setSystemTime(new Date(Date.parse(MON) + DAY - 3 * 3600_000));
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('recovery-morning')).toBeTruthy();
    press('recovery-morning-knee-score-2');
    press('recovery-morning-knee-settled-no');
    press('recovery-morning-save');
    expect(logs(d).at(-1)).toMatchObject({ kind: 'pain', joint: 'knee', score: 2, phase: 'next_morning', settled: false, planId: null });
    expect(screen.queryByTestId('recovery-morning')).toBeNull();
    screen.unmount();

    // Wednesday: the next session never loads the knee above "low".
    jest.setSystemTime(new Date(Date.parse(MON) + 2 * DAY));
    start(d);
    const next = sessions(d).at(-1)!;
    expect(next.input.jointFlags).toEqual({ knee: 'red' });
    expect(next.plan.exercises.filter((e) => byId.get(e.exerciseId)!.jointLoad.knee !== 'low').map((e) => e.exerciseId)).toEqual([]);
    expect(next.plan.warmUp.content!.mobility.filter((x) => byId.get(x.exerciseId)!.jointLoad.knee !== 'low').map((x) => x.exerciseId)).toEqual([]);
    // What the same day would have been without the flag: every exercise loading the knee at medium/high is substituted (S2).
    const unflagged = generateSession({ ...(next.input as GenerateSessionInput), jointFlags: {} }, createEngineContext({ clock: fixedClock(Date.parse(next.plan.generatedAt)), seed: next.plan.seed }));
    if (unflagged.status !== 'ok') throw new Error('expected a plan');
    const onKnee = unflagged.plan.exercises.filter((e) => byId.get(e.exerciseId)!.jointLoad.knee !== 'low');
    expect(onKnee.length).toBeGreaterThan(0);
    for (const e of onKnee) {
      const now = next.plan.exercises.find((x) => x.slot === e.slot && x.role === e.role);
      if (now) expect([now.exerciseId, now.reasonCodes[0]]).toEqual([expect.not.stringMatching(`^${e.exerciseId}$`), 'session.exercise.s2_substituted.knee']);
    }
    // A slot whose every option loads the knee is left out, and says why.
    if (onKnee.some((e) => !next.plan.exercises.some((x) => x.slot === e.slot && x.role === e.role))) expect(next.plan.reasonCodes).toContain('session.s2.slot_dropped.knee');
    expect(d.legal.getState().events.some((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S2')).toBe(true);
  });

  it('suggests a physiotherapist after more than two weeks of amber on the same joint, in FR and EN', () => {
    const d = withPlan();
    const at = (days: number) => new Date(Date.parse(MON) + days * DAY).toISOString();
    d.profile.getState().logExecution({ kind: 'pain', planId: null, joint: 'shoulder', score: 4, at: at(-20), phase: 'after_session' });
    d.profile.getState().logExecution({ kind: 'pain', planId: null, joint: 'shoulder', score: 5, at: at(-2), phase: 'after_session' });
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('recovery-physio-shoulder')).toBeTruthy();
    expect(screen.getByText(tr('en').t('recovery.physio.body.shoulder'))).toBeTruthy();
    screen.unmount();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />, 'fr');
    expect(screen.getByText(tr('fr').t('recovery.physio.body.shoulder'))).toBeTruthy();
    // 18 days apart is not "two amber weeks" in a row: no deload from these two reports.
    expect(screen.queryByTestId('recovery-deload')).toBeNull();
  });

  it('two amber weeks make today a lighter week (triggered deload), explained on the preview and applied to the plan', () => {
    const d = withPlan();
    const at = (days: number) => new Date(Date.parse(MON) + days * DAY).toISOString();
    d.profile.getState().logExecution({ kind: 'pain', planId: null, joint: 'hip', score: 4, at: at(-8), phase: 'after_session' });
    d.profile.getState().logExecution({ kind: 'pain', planId: null, joint: 'hip', score: 4, at: at(-1), phase: 'after_session' });
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('recovery-deload')).toBeTruthy();
    press('recovery-morning-skip');
    press('recovery-readiness-skip');
    press('notice-first_workout-ack');
    press('workout-start');
    const record = sessions(d)[0]!;
    expect(record.input.deload).toMatchObject({ trigger: 'amber_weeks' });
    expect(record.plan.reasonCodes).toEqual(expect.arrayContaining(['session.deload.triggered.amber_weeks', 'session.deload.volume_reduced']));
  });
});

describe('M05 warm-up and the mobility and balance session', () => {
  it('shows what the warm-up is, and a mobility and balance session can replace today’s training', () => {
    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />);
    expect(screen.getByTestId('recovery-warmup')).toBeTruthy();
    expect(screen.getByTestId('recovery-warmup-general')).toBeTruthy();
    expect(screen.getAllByTestId(/^recovery-warmup-drill-/).length).toBeGreaterThan(0);
    press('workout-mode-mobility_balance');
    expect(screen.queryByTestId('recovery-readiness')).toBeNull();
    press('notice-first_workout-ack');
    press('workout-start');
    const record = sessions(d)[0]!;
    expect(record.plan.kind).toBe('mobility_session');
    expect(record.input.mode).toBe('mobility_balance');
    for (const e of record.plan.exercises) expect(['balance', 'mobility']).toContain(byId.get(e.exerciseId)!.pattern);
    expectEveryControlLabelled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('French: every M05 card is translated and labelled', () => {
    const d = withPlan();
    renderWith(d, <WorkoutScreen onExit={() => undefined} />, 'fr');
    expect(screen.getByText(tr('fr').t('recovery.readiness.title'))).toBeTruthy();
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'fr')).toEqual([]);
    expectEveryControlLabelled();
  });
});

