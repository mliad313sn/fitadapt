import { createEngineContext } from '@fitadapt/engine';
import { buildCapacityModel, generateSession } from '@fitadapt/exercise-library';
import { SCREENING_QUESTION_IDS, type AssessmentResult, type SessionHistoryEntry } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectCapacity, selectSafetyProfile } from '../src/profile/selectors';
import { AssessmentScreen } from '../src/screens/AssessmentScreen';
import { FirstWorkoutScreen } from '../src/screens/FirstWorkoutScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { todayInput } from '../src/workout/today';
import { tr } from './helpers';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

/**
 * FIX-A on the device: every engine caller passes the safety facts (SAF-3), the
 * assessment takes the S3 lock (SAF-2), and a long history never breaks
 * generation (SAF-1). Fictional user.
 */
const T0 = '2026-09-23T10:00:00.000Z';
const t = tr('en').t;

function device() {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('home', ['pull_up_bar', 'resistance_band', 'dumbbell']);
  profile.getState().updateDraft({ primaryGoal: 'strength', experience: 'beginner', birthDate: { year: 1988, month: 3, day: 14 }, answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])) });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number }) => ({ status: 'done' as const, testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: null, rir: null });
  const result: AssessmentResult = {
    protocolId: 'home',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: T0,
    completedAt: T0,
    tests: [done('push_reps', 'knee_push_up', { reps: 6 }), done('dead_hang_hold', 'dead_hang', { seconds: 20 }), { status: 'skipped', testId: 'row_reps', reason: 'equipment' }, done('squat_reps', 'air_squat', { reps: 12 }), done('plank_hold', 'knee_plank', { seconds: 30 })],
  };
  profile.getState().saveAssessment({ reason: 'first', result, capacity: buildCapacityModel(result), cappedByS1: false });
  return { client, kv, consents, profile, legal };
}

function renderWith(d: ReturnType<typeof device>, ui: React.ReactElement) {
  return render(
    <AppProviders syncClient={d.client} initialLocale="en" profile={d.profile} legal={d.legal} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      {ui}
    </AppProviders>,
  );
}

const redFlag = (d: ReturnType<typeof device>) => d.profile.getState().logExecution({ kind: 'red_flag', planId: null, symptom: 'chest_pain_pressure', at: new Date().toISOString() });

afterEach(() => jest.useRealTimers());

describe('SAF-3: the first-workout preview uses every safety fact', () => {
  it('shows the first session, and after a red-flag stop (S3) no plan, only the locked reason', () => {
    jest.useFakeTimers({ now: new Date(T0), doNotFake: ['nextTick', 'setImmediate'] });
    const d = device();
    renderWith(d, <FirstWorkoutScreen />);
    expect(screen.getByTestId('first-session-plan')).toBeTruthy();
    screen.unmount();

    redFlag(d);
    renderWith(d, <FirstWorkoutScreen />);
    expect(screen.queryByTestId('first-session-plan')).toBeNull();
    expect(screen.getByTestId('first-session-unavailable').props.children).toBe(t('engine.reason.session.unavailable.s3_intensity_locked'));
  });
});

describe('SAF-2: the assessment takes the S3 lock', () => {
  it('after a red-flag stop the assessment shows the locked reason, never loaded tests', () => {
    jest.useFakeTimers({ now: new Date(T0), doNotFake: ['nextTick', 'setImmediate'] });
    const d = device();
    redFlag(d);
    renderWith(d, <AssessmentScreen onExit={() => undefined} onFirstWorkout={() => undefined} />);
    expect(screen.getByTestId('assessment-unavailable').props.children).toBe(t('engine.reason.assessment.unavailable.s3_intensity_locked'));
  });
});

describe('SAF-1: a long history never breaks today’s session', () => {
  it('todayInput keeps the newest 60 sessions, carries the local date, and the engine gives a plan with 61 and 500 sessions', () => {
    const d = device();
    const s = d.profile.getState();
    const safetyProfile = selectSafetyProfile(s.screenings, d.consents.getState().records);
    const entry = (i: number): SessionHistoryEntry => {
      const at = new Date(Date.parse(T0) - (600 - i) * 86_400_000).toISOString();
      return { planId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, prescribedAt: at, startedAt: at, countsForProgression: true, exercises: [] };
    };
    for (const n of [61, 500]) {
      const history = Array.from({ length: n }, (_, i) => entry(i));
      const facts = todayInput({ profile: s.profile!, safetyProfile, places: s.equipment, program: null, reflows: [], capacity: selectCapacity(s.assessments, d.consents.getState().records), history, jointFlags: {}, intensityLock: { locked: false, since: null }, today: '2026-09-23', placeId: null, minutes: 40 });
      if (facts.status !== 'ready') throw new Error(facts.status);
      expect(facts.input.history).toHaveLength(60);
      expect(facts.input.history.at(-1)).toBe(history.at(-1));
      expect(facts.input.localDate).toEqual({ year: 2026, month: 9, day: 23 });
      // The engine is robust too: the whole history (no trimming by the caller) still gives a plan.
      expect(generateSession({ ...facts.input, history }, createEngineContext({ clock: { now: () => Date.parse(T0) }, seed: 1 })).status).toBe('ok');
    }
  });
});
