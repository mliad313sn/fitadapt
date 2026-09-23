import { SCREENING_QUESTION_IDS, type SafetyProfile } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { EQUIPMENT_PRESETS } from '@fitadapt/exercise-library';
import { render, screen } from '@testing-library/react-native';
import { drizzle } from 'drizzle-orm/sql-js';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { LibraryStore } from '../src/library/library-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectRescreen, selectSafetyProfile } from '../src/profile/selectors';
import { HomeScreen } from '../src/screens/HomeScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr } from './helpers';

/** Goal conditions 3 and 4: SafetyProfile persisted, synced and selected; re-screen after 12 months; equipment pool. */

const server = () => new SyncServer({ store: new MemoryServerStore() });
function device(sync: SyncServer, user = 'user-1') {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(sync, user), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  let now = new Date('2026-09-23T10:00:00.000Z');
  const profile = createProfileStore({ sync: client, kv, now: () => now });
  return { client, kv, consents, profile, setNow: (d: Date) => (now = d) };
}

function answerAll(store: ReturnType<typeof device>['profile'], yes: string[] = []) {
  store.getState().updateDraft({
    primaryGoal: 'strength',
    experience: 'beginner',
    birthDate: { year: 1988, month: 3, day: 14 },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])),
  });
}

describe('SafetyProfile: persisted, synced, typed selector (goal condition 3)', () => {
  it('is stored with the screening, synced to a second device and read through the selector', async () => {
    const sync = server();
    const a = device(sync);
    a.consents.getState().decide('health', true, 'en');
    answerAll(a.profile, ['fainting_or_dizziness']);
    a.profile.getState().saveProfileFromDraft();
    a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });

    const onA: SafetyProfile = selectSafetyProfile(a.profile.getState().screenings, a.consents.getState().records);
    expect(onA).toMatchObject({ screeningOutcome: 'consult_professional', maxRPE: 7, allowHIIT: false, allowMaxTests: false, unresolvedFlags: ['fainting_or_dizziness'] });
    // Persisted: in the sync store and queued in the outbox (works offline).
    expect(a.client.list('screenings')).toHaveLength(1);
    expect(a.client.outbox('pending').map((o) => o.mutation.collection).sort()).toEqual(['profile', 'screenings']);

    await a.client.sync();
    const b = device(sync);
    b.consents.getState().decide('health', true, 'en');
    await b.client.sync();
    b.profile.getState().reload();
    expect(selectSafetyProfile(b.profile.getState().screenings, b.consents.getState().records)).toEqual(onA);
    expect(b.profile.getState().profile?.goals.primary).toBe('strength');
  });

  it('fails closed: without health consent, or after withdrawal, the profile is "not screened"', () => {
    const a = device(server());
    answerAll(a.profile);
    a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
    expect(selectSafetyProfile(a.profile.getState().screenings, [])).toMatchObject({ screeningOutcome: 'not_screened', allowHIIT: false, maxRPE: 7, reasonCodes: ['safety_profile.not_screened.no_consent'] });
    a.consents.getState().decide('health', true, 'en');
    expect(selectSafetyProfile(a.profile.getState().screenings, a.consents.getState().records).screeningOutcome).toBe('cleared');
    a.consents.getState().decide('health', false, 'en');
    expect(selectSafetyProfile(a.profile.getState().screenings, a.consents.getState().records).screeningOutcome).toBe('not_screened');
    expect(selectSafetyProfile([], [])).toMatchObject({ screeningOutcome: 'not_screened' });
  });

  it('re-derives the profile from the answers: a tampered stored profile does not loosen it', () => {
    const a = device(server());
    a.consents.getState().decide('health', true, 'en');
    answerAll(a.profile, ['chest_discomfort']);
    const record = a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
    const tampered = [{ id: 'x', data: { ...record, safetyProfile: { ...record.safetyProfile, maxRPE: 10, allowHIIT: true, unresolvedFlags: [] } } }];
    expect(selectSafetyProfile(tampered, a.consents.getState().records)).toMatchObject({ maxRPE: 7, allowHIIT: false });
  });
});

describe('re-screen prompt (fake clock, goal condition 3)', () => {
  afterEach(() => jest.useRealTimers());

  function renderHome(a: ReturnType<typeof device>) {
    const kv = new MemoryKeyValueStore();
    return render(
      <AppProviders
        syncClient={a.client}
        initialLocale="en"
        profile={a.profile}
        legal={createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' })}
        privacy={{ ageGate: createAgeGateStore(kv), consents: a.consents, wipeLocalData: () => undefined }}
      >
        <HomeScreen onStartOnboarding={() => undefined} onRescreen={() => undefined} />
      </AppProviders>,
    );
  }

  it('appears 12 months after the last screening, not before', () => {
    const t = tr('en');
    jest.useFakeTimers({ now: new Date('2026-09-23T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const a = device(server());
    a.consents.getState().decide('health', true, 'en');
    answerAll(a.profile);
    a.profile.getState().saveProfileFromDraft();
    a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
    a.profile.getState().completeOnboarding();

    renderHome(a);
    expect(screen.queryByTestId('rescreen-prompt')).toBeNull();
    screen.unmount();

    jest.setSystemTime(new Date('2027-09-23T09:59:59.000Z'));
    renderHome(a);
    expect(screen.queryByTestId('rescreen-prompt')).toBeNull();
    screen.unmount();

    jest.setSystemTime(new Date('2027-09-23T10:00:00.000Z'));
    renderHome(a);
    expect(screen.getByTestId('rescreen-prompt')).toBeTruthy();
    expect(screen.getByText(t.t('home.rescreen.annual'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t.t('home.rescreen.button') })).toBeTruthy();
  });

  it('appears at once after the user reports a change, and clears with a new screening', () => {
    const a = device(server());
    answerAll(a.profile);
    a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
    const now = new Date('2026-10-01T10:00:00.000Z');
    a.setNow(now);
    expect(selectRescreen(a.profile.getState().screenings, a.profile.getState().newConditionReportedAt, now).status).toBe('current');
    a.profile.getState().reportNewCondition();
    expect(selectRescreen(a.profile.getState().screenings, a.profile.getState().newConditionReportedAt, now)).toMatchObject({ status: 'due', reason: 'new_condition' });
    a.setNow(new Date('2026-10-02T10:00:00.000Z'));
    a.profile.getState().saveScreening('new_condition', { year: 2026, month: 10, day: 2 });
    expect(selectRescreen(a.profile.getState().screenings, a.profile.getState().newConditionReportedAt, new Date('2026-10-02T11:00:00.000Z')).status).toBe('current');
    expect(a.profile.getState().screenings.map((s) => s.data.reason)).toEqual(['onboarding', 'new_condition']);
  });
});

describe('equipment profiles and the exercise pool (goal condition 4, integration with the M06 seed in SQLite)', () => {
  it('a user creates at least three profiles; switching the active one changes the queried pool', async () => {
    const SQL = await initSqlJs();
    const db = drizzle(new SQL.Database());
    const library = new LibraryStore(db);
    library.install();
    const a = device(server());
    a.consents.getState().decide('health', true, 'en');
    answerAll(a.profile);
    a.profile.getState().saveProfileFromDraft();
    const record = a.profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });

    const home = a.profile.getState().saveEquipment('home', EQUIPMENT_PRESETS.home_basic);
    const gym = a.profile.getState().saveEquipment('gym', EQUIPMENT_PRESETS.full_gym);
    const park = a.profile.getState().saveEquipment('park', EQUIPMENT_PRESETS.park);
    const travel = a.profile.getState().saveEquipment('travel', []);
    expect(a.profile.getState().equipment.map((p) => p.data.location)).toEqual(['home', 'gym', 'park', 'travel']);

    const poolOfActive = () => {
      const state = a.profile.getState();
      const active = state.equipment.find((p) => p.id === state.profile?.activeEquipmentProfileId)!;
      return library.pool('en', active.data.equipment, record.safetyProfile).map((r) => r.id);
    };
    const pools: Record<string, string[]> = {};
    for (const [name, id] of Object.entries({ home, gym, park, travel })) {
      a.profile.getState().setActiveEquipment(id);
      pools[name] = poolOfActive();
    }
    expect(new Set(Object.values(pools).map((p) => p.length)).size).toBe(4);
    expect(pools.gym!.length).toBeGreaterThan(pools.home!.length);
    expect(pools.home!.length).toBeGreaterThan(pools.travel!.length);
    expect(pools.gym).toContain('barbell_back_squat');
    expect(pools.home).not.toContain('barbell_back_squat');
    expect(pools.park).toContain('parallel_bar_dip');
    expect(pools.travel!.every((id) => pools.gym!.includes(id) || library.getExercise(id)!.equipment.length === 0)).toBe(true);
    // Editing a profile changes its pool too.
    a.profile.getState().saveEquipment('travel', ['suspension_trainer']);
    a.profile.getState().setActiveEquipment(travel);
    expect(poolOfActive().length).toBeGreaterThan(pools.travel!.length);
    // The active place is part of the synced profile.
    expect(a.profile.getState().profile?.activeEquipmentProfileId).toBe(travel);
  });
});
