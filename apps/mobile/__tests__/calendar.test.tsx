import { EQUIPMENT_PRESETS, buildCapacityModel } from '@fitadapt/exercise-library';
import { guiltPhrases, type Locale } from '@fitadapt/i18n';
import { SCREENING_QUESTION_IDS, type AssessmentResult, type GoalId } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectMesocycleEnd, selectProgram } from '../src/profile/selectors';
import { CalendarScreen } from '../src/screens/CalendarScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr, visibleStrings } from './helpers';

/**
 * M08 on the device (goal condition 5): the calendar builds the program with
 * the engine, shows the week and applies reflow offline (the network is
 * down); the copy after a missed session passes the no-guilt denylist in EN
 * and FR. Also: the M07 re-assessment follows the real mesocycle end, and
 * S1/S7 are respected. P3 (David, fictional) often misses Fridays.
 */
const WED = '2026-09-23T10:00:00.000Z';
const FRI_WEEK1 = '2026-10-02T10:00:00.000Z';
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
});

function device(options: { yes?: string[]; goal?: GoalId; experience?: 'beginner' | 'intermediate' } = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('gym', [...EQUIPMENT_PRESETS.full_gym]);
  profile.getState().updateDraft({
    primaryGoal: options.goal ?? 'muscle_gain',
    experience: options.experience ?? 'intermediate',
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

function renderWith(d: ReturnType<typeof device>, ui: React.ReactElement, locale: Locale = 'en') {
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
    if (typeof node.type === 'string' && control && (typeof p.accessibilityLabel !== 'string' || p.accessibilityLabel.trim() === '')) unlabelled.push(String(p.testID ?? node.type));
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(screen.root);
  expect(unlabelled).toEqual([]);
}

const outbox = (d: ReturnType<typeof device>, collection: string) => d.client.outbox('pending').filter((o) => o.mutation.collection === collection);

describe('calendar screen (goal condition 5)', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`builds the week offline and reflows P3's missed Friday to Saturday, with no-guilt copy (${locale})`, () => {
      const t = tr(locale).t;
      jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
      const d = device();
      renderWith(d, <CalendarScreen onExit={() => undefined} />, locale);
      expect(screen.getByText(t('calendar.empty'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('calendar-create'));
      expect(outbox(d, 'programs')).toHaveLength(1);
      const program = selectProgram(d.profile.getState().programs, d.consents.getState().records)!.program;
      expect(program.trainingDays).toEqual(['mon', 'wed', 'fri']);
      // Before the start: the first week, and when it starts.
      expect(screen.getByTestId('calendar-week-1')).toBeTruthy();
      expect(screen.getByText(t('calendar.startsOn', { day: t('weekday.mon'), date: 28 }))).toBeTruthy();
      for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) expect(screen.getByTestId(`calendar-day-${date}`)).toBeTruthy();
      expect(screen.getByTestId('calendar-session-w01.s3')).toBeTruthy();
      expectEveryControlLabelled();
      screen.unmount();

      // Friday of week 1: David cannot make it.
      jest.setSystemTime(new Date(FRI_WEEK1));
      renderWith(d, <CalendarScreen onExit={() => undefined} />, locale);
      const cant = screen.getByTestId('calendar-cant-w01.s3');
      expect(cant.props.accessibilityLabel).toBe(t('calendar.cantMakeItFor', { session: t('calendar.focus.full_body'), day: t('weekday.fri') }));
      fireEvent.press(cant);
      const message = t('calendar.reflow.shifted', { session: t('calendar.focus.full_body'), day: t('weekday.sat') });
      expect(screen.getByTestId('calendar-message').props.children).toBe(message);
      expect(screen.getByTestId('calendar-day-2026-10-03').findByProps({ testID: 'calendar-session-w01.s3' })).toBeTruthy();
      expect(screen.getByText(t('calendar.movedFrom', { day: t('weekday.fri') }))).toBeTruthy();
      expect(outbox(d, 'program_reflows').map((o) => o.mutation.data)).toMatchObject([{ sessionId: 'w01.s3', reportedOn: '2026-10-02', outcome: { kind: 'shifted', toDate: '2026-10-03' } }]);
      // No guilt: nothing the user sees or hears after the miss matches the denylist.
      for (const text of visibleStrings()) expect(guiltPhrases(text, locale)).toEqual([]);
      expectEveryControlLabelled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('skips with calm copy when no day fits, shows deload weeks, and pages through the plan', () => {
    const t = tr('en').t;
    jest.useFakeTimers({ now: new Date('2026-10-04T09:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const d = device();
    renderWith(d, <CalendarScreen onExit={() => undefined} />);
    fireEvent.press(screen.getByTestId('calendar-create'));
    screen.unmount();
    // Sunday of week 1 is before the program (it starts Monday 5 October); move to the first Sunday of the plan.
    jest.setSystemTime(new Date('2026-10-11T09:00:00.000Z'));
    renderWith(d, <CalendarScreen onExit={() => undefined} />);
    fireEvent.press(screen.getByTestId('calendar-cant-w01.s3')); // Friday's session reported on Sunday: Sunday touches Monday's full body
    expect(screen.getByTestId('calendar-message').props.children).toBe(t('calendar.reflow.skipped'));
    expect(screen.getByText(t('calendar.goneLine', { session: t('calendar.focus.full_body'), status: t('calendar.skippedLabel') }))).toBeTruthy();
    for (const text of visibleStrings()) expect(guiltPhrases(text, 'en')).toEqual([]);
    for (let i = 0; i < 4; i++) fireEvent.press(screen.getByTestId('calendar-next'));
    expect(screen.getByTestId('calendar-week-5')).toBeTruthy();
    expect(screen.getByTestId('calendar-week-kind').props.children).toBe(t('calendar.kind.deload'));
    fireEvent.press(screen.getByTestId('calendar-previous'));
    expect(screen.getByTestId('calendar-week-4')).toBeTruthy();
    expectEveryControlLabelled();
  });

  it('S7: no automatic plan for a user routed to professional guidance (reason shown, nothing stored)', () => {
    const t = tr('fr').t;
    const d = device({ yes: ['pregnancy_or_recent_birth'] });
    renderWith(d, <CalendarScreen onExit={() => undefined} />, 'fr');
    fireEvent.press(screen.getByTestId('calendar-create'));
    expect(screen.getByText(t('engine.reason.program.unavailable.professional_guidance'))).toBeTruthy();
    expect(outbox(d, 'programs')).toHaveLength(0);
  });

  it('S1: a flagged user gets a capped plan and the S1 caps go to the device defensibility buffer', () => {
    const d = device({ yes: ['chest_discomfort'], goal: 'fat_loss' });
    renderWith(d, <CalendarScreen onExit={() => undefined} />);
    fireEvent.press(screen.getByTestId('calendar-create'));
    const program = d.profile.getState().programs[0]!.data.program;
    expect(program.microcycles.every((w) => w.sessions.every((s) => s.targetRpe <= 7 && s.conditioning?.kind !== 'intervals'))).toBe(true);
    expect(d.legal.getState().events.filter((e) => e.type === 'safety.event').map((e) => (e.payload as { reasonCode: string }).reasonCode)).toEqual(['safety.s1.hiit_not_allowed', 'safety.s1.rpe_above_cap']);
  });

  it('a changed goal offers a new plan that starts with a transition week', () => {
    const t = tr('en').t;
    const d = device();
    renderWith(d, <CalendarScreen onExit={() => undefined} />);
    fireEvent.press(screen.getByTestId('calendar-create'));
    expect(screen.queryByTestId('calendar-create')).toBeNull();
    act(() => {
      d.profile.getState().updateDraft({ primaryGoal: 'strength' });
      d.profile.getState().saveProfileFromDraft();
    });
    fireEvent.press(screen.getByTestId('calendar-create'));
    const records = d.profile.getState().programs;
    expect(records.map((r) => r.data.reason)).toEqual(['first', 'goal_change']);
    expect(records[1]!.data.program.microcycles[0]!.kind).toBe('transition');
    expect(screen.getByTestId('calendar-week-kind').props.children).toBe(t('calendar.kind.transition'));
  });
});

describe('re-assessment at the real mesocycle end (M07 wired to M08, fake clock)', () => {
  it('follows the program’s block end instead of the 4-week default; the home screen opens the calendar', () => {
    jest.useFakeTimers({ now: new Date(WED), doNotFake: ['nextTick', 'setImmediate'] });
    const d = device();
    const opened: string[] = [];
    const result: AssessmentResult = {
      protocolId: 'home',
      protocolVersion: 1,
      stopRir: 2,
      startedAt: WED,
      completedAt: WED,
      tests: ['push_reps', 'dead_hang_hold', 'row_reps', 'squat_reps', 'plank_hold'].map((testId) => ({ status: 'skipped' as const, testId, reason: 'user_choice' as const })),
    };
    d.profile.getState().saveAssessment({ reason: 'first', result, capacity: buildCapacityModel(result), cappedByS1: false });
    renderWith(d, <CalendarScreen onExit={() => undefined} />);
    fireEvent.press(screen.getByTestId('calendar-create'));
    screen.unmount();
    const program = d.profile.getState().programs[0]!.data;
    // Intermediate: 5-week blocks from Monday 28 September → block 1 ends Sunday 1 November; due at local midnight after it.
    expect(program.program.mesocycles[0]!.endDate).toBe('2026-11-01');
    const due = selectMesocycleEnd(d.profile.getState().assessments[0]!.data.capacity, program)!;
    expect(due).toBe(new Date(2026, 10, 2).toISOString());
    const home = () => renderWith(d, <HomeScreen onStartOnboarding={() => undefined} onOpenAssessment={() => opened.push('assessment')} onOpenCalendar={() => opened.push('calendar')} />);

    jest.setSystemTime(new Date('2026-10-21T10:00:00.000Z')); // the old 4-week default: not due any more
    home();
    expect(screen.queryByTestId('reassessment-prompt')).toBeNull();
    fireEvent.press(screen.getByTestId('open-calendar'));
    expect(opened).toEqual(['calendar']);
    screen.unmount();

    jest.setSystemTime(new Date(new Date(due).getTime() - 1));
    home();
    expect(screen.queryByTestId('reassessment-prompt')).toBeNull();
    screen.unmount();

    jest.setSystemTime(new Date(due));
    home();
    expect(screen.getByTestId('reassessment-prompt')).toBeTruthy();
    expect(selectMesocycleEnd(null, program)).toBeNull();
  });
});
