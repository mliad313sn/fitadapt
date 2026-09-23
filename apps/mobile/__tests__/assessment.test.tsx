import { buildCapacityModel } from '@fitadapt/exercise-library';
import { SCREENING_QUESTION_IDS, type AssessmentResult } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectCapacity, selectReassessment } from '../src/profile/selectors';
import { AssessmentScreen } from '../src/screens/AssessmentScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr } from './helpers';

/** M07 on the device: capacity selector, re-assessment prompt (fake clock), unavailable assessments, labels, FR. */

const T0 = '2026-09-23T10:00:00.000Z';

function device(yes: string[] = []) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('home', ['pull_up_bar']);
  profile.getState().updateDraft({ primaryGoal: 'strength', experience: 'beginner', birthDate: { year: 1988, month: 3, day: 14 }, answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])) });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  return { client, kv, consents, profile, legal };
}

function result(completedAt = T0): AssessmentResult {
  const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number }) => ({ status: 'done' as const, testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: null, rir: null });
  return {
    protocolId: 'home',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: T0,
    completedAt,
    tests: [done('push_reps', 'knee_push_up', { reps: 6 }), done('dead_hang_hold', 'dead_hang', { seconds: 20 }), { status: 'skipped', testId: 'row_reps', reason: 'equipment' }, done('squat_reps', 'air_squat', { reps: 12 }), done('plank_hold', 'knee_plank', { seconds: 30 })],
  };
}

function renderWith(d: ReturnType<typeof device>, ui: React.ReactElement, locale: 'en' | 'fr' = 'en') {
  return render(
    <AppProviders syncClient={d.client} initialLocale={locale} profile={d.profile} legal={d.legal} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      {ui}
    </AppProviders>,
  );
}

function expectEveryControlLabelled() {
  const unlabelled: string[] = [];
  const walk = (node: typeof screen.root) => {
    const p = node.props as Record<string, unknown>;
    const control = ['button', 'switch', 'radio', 'togglebutton', 'checkbox', 'link'].includes(String(p.accessibilityRole));
    if (typeof node.type === 'string' && (typeof p.onChangeText === 'function' || control) && (typeof p.accessibilityLabel !== 'string' || p.accessibilityLabel.trim() === '')) unlabelled.push(String(p.testID ?? node.type));
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(screen.root);
  expect(unlabelled).toEqual([]);
}

describe('capacity selector', () => {
  it('returns the latest CapacityModel, and nothing without the health consent (fail closed)', () => {
    const d = device();
    expect(selectCapacity(d.profile.getState().assessments, d.consents.getState().records)).toBeNull();
    const first = result('2026-09-23T10:00:00.000Z');
    const later = result('2026-10-21T10:00:00.000Z');
    d.profile.getState().saveAssessment({ reason: 'first', result: first, capacity: buildCapacityModel(first), cappedByS1: false });
    d.profile.getState().saveAssessment({ reason: 'mesocycle_end', result: later, capacity: buildCapacityModel(later), cappedByS1: false });
    expect(d.client.outbox('pending').filter((o) => o.mutation.collection === 'assessments')).toHaveLength(2);
    expect(selectCapacity(d.profile.getState().assessments, d.consents.getState().records)?.assessedAt).toBe('2026-10-21T10:00:00.000Z');
    d.consents.getState().decide('health', false, 'en');
    expect(selectCapacity(d.profile.getState().assessments, d.consents.getState().records)).toBeNull();
    expect(selectReassessment(null, new Date())).toEqual({ status: 'never_assessed' });
  });
});

describe('re-assessment prompt at the end of the mesocycle (fake clock, goal condition 5)', () => {
  afterEach(() => jest.useRealTimers());

  it('appears 4 weeks after the assessment (default mesocycle), not before; re-test on demand before that', () => {
    const t = tr('en');
    jest.useFakeTimers({ now: new Date(T0), doNotFake: ['nextTick', 'setImmediate'] });
    const d = device();
    const opened: string[] = [];
    const home = () => renderWith(d, <HomeScreen onStartOnboarding={() => undefined} onOpenAssessment={() => opened.push('assessment')} />);

    home();
    expect(screen.getByTestId('open-assessment')).toBeTruthy(); // never assessed: first assessment entry
    screen.unmount();

    const r = result(T0);
    d.profile.getState().saveAssessment({ reason: 'first', result: r, capacity: buildCapacityModel(r), cappedByS1: false });
    home();
    expect(screen.queryByTestId('reassessment-prompt')).toBeNull();
    expect(screen.getByTestId('reassess-on-demand')).toBeTruthy();
    screen.unmount();

    jest.setSystemTime(new Date('2026-10-21T09:59:59.999Z'));
    home();
    expect(screen.queryByTestId('reassessment-prompt')).toBeNull();
    screen.unmount();

    jest.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));
    home();
    expect(screen.getByTestId('reassessment-prompt')).toBeTruthy();
    expect(screen.getByText(t.t('home.assessment.due'))).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: t.t('home.assessment.retest') }));
    expect(opened).toEqual(['assessment']);
    expectEveryControlLabelled();
  });
});

describe('assessment screen', () => {
  it('offers no assessment to a user routed to professional guidance (S7), with the reason in FR and EN', () => {
    for (const locale of ['en', 'fr'] as const) {
      const d = device(['pregnancy_or_recent_birth']);
      renderWith(d, <AssessmentScreen onExit={() => undefined} onFirstWorkout={() => undefined} />, locale);
      expect(screen.getByTestId('assessment-unavailable').props.children).toBe(tr(locale).t('engine.reason.assessment.unavailable.professional_guidance'));
      expect(screen.queryByTestId('assessment-start')).toBeNull();
      expect(screen.getByTestId('assessment-stop')).toBeTruthy();
      screen.unmount();
    }
  });

  it('labels every control on every step, in French too, and records the notice every time', () => {
    const d = device();
    const t = tr('fr');
    renderWith(d, <AssessmentScreen onExit={() => undefined} onFirstWorkout={() => undefined} />, 'fr');
    expect(screen.getByRole('header', { name: t.t('assessment.title') })).toBeTruthy();
    expectEveryControlLabelled();
    fireEvent.press(screen.getByTestId('assessment-start'));
    expect(screen.getByText(t.t('legal.notice.assessment.v1.body'))).toBeTruthy();
    expectEveryControlLabelled();
    fireEvent.press(screen.getByTestId('notice-assessment-ack'));
    for (let step = 0; step < 5; step++) {
      expectEveryControlLabelled();
      // A missing value is refused with a message; skipping is always possible.
      if (step === 0) {
        fireEvent.press(screen.getByTestId('assessment-next'));
        expect(screen.getByLabelText(t.t('assessment.input.reps')).props.accessibilityHint).toBe(t.t('assessment.input.invalid'));
      }
      fireEvent.press(screen.getByTestId(screen.queryByTestId('assessment-skip') ? 'assessment-skip' : 'assessment-next'));
    }
    expect(screen.getByRole('header', { name: t.t('assessment.result.title') })).toBeTruthy();
    expectEveryControlLabelled();
    const record = d.profile.getState().assessments[0]!.data;
    expect(record.result.tests.map((x) => x.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(record.capacity.slots.every((s) => s.stepIndex === 0)).toBe(true);
    expect(d.legal.getState().notices.filter((n) => n.noticeId === 'assessment').map((n) => n.kind)).toEqual(['shown', 'acknowledged']);
  });
});
