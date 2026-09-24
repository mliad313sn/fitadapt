import { ENGINE_VERSION, NUTRITION_RULES_VERSION } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS } from '@fitadapt/exercise-library';
import { guiltPhrases, judgementalBodyTerms, nutritionCopyPhrases, type Locale } from '@fitadapt/i18n';
import { verifyChain } from '@fitadapt/legal';
import { NUTRITION_COLLECTIONS, NutritionPlanRecordSchema, SCREENING_QUESTION_IDS, type ScreeningQuestionId } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createLegalStore } from '../src/legal/legal-store';
import { createGuardrailInbox } from '../src/nutrition/guardrail-port';
import { buildNutritionInput, planUpkeep } from '../src/nutrition/nutrition-input';
import { currentNutrition } from '../src/nutrition/NutritionProvider';
import { createNutritionStore, type NutritionSettings } from '../src/nutrition/nutrition-store';
import { isDeepStrictEqual } from '../src/nutrition/deep-equal';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectSafetyProfile } from '../src/profile/selectors';
import { createProgressStore } from '../src/progress/progress-store';
import { NutritionScreen } from '../src/screens/NutritionScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/storage/app-state';
import { tr, visibleStrings } from './helpers';
import { closeReferenceDevices, referenceDevice, seedReferenceData } from './progress-seed';

jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID(), getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('node:crypto').randomBytes(n)) }));

/**
 * M10 on the device, screen level, offline (every fetch fails). Fictional
 * users only.
 * - goal condition 3: with deficit features disabled (under 18, advised
 *   against calorie restriction), the screen shows no calorie number and
 *   shows supportive content and habits;
 * - goal condition 7: the deficit set-up shows the L3 notice first;
 * - goal condition 6: the M04 sustained-loss event shows a supportive
 *   notice and the stored target's deficit is removed, then reduced.
 */
const TODAY = '2026-09-24';
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(`${TODAY}T12:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate'] });
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  jest.useRealTimers();
  closeReferenceDevices();
});

interface Options {
  birthYear?: number;
  yes?: ScreeningQuestionId[];
  biometrics?: { heightCm: number | null; weightKg: number | null };
}

function device(o: Options = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  let seed = 0;
  const nutrition = createNutritionStore({ sync: client, kv, now: () => new Date(), newSeed: () => ++seed });
  const inbox = createGuardrailInbox(kv, (e) => nutrition.getState().receiveGuardrail(e));
  const progress = createProgressStore({ sync: client, kv, now: () => new Date(), nutrition: inbox });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('home', [...EQUIPMENT_PRESETS.home_basic]);
  profile.getState().updateDraft({
    primaryGoal: 'fat_loss',
    experience: 'beginner',
    schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: o.birthYear ?? 1988, month: 3, day: 14 },
    biometrics: { heightCm: 178, weightKg: 120, bodyFatPercent: null, ...o.biometrics },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, o.yes?.includes(q) ? 'yes' : 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  return { client, kv, consents, profile, legal, nutrition, inbox, progress };
}
type Device = ReturnType<typeof device>;

function renderNutrition(d: Pick<Device, 'client' | 'consents' | 'profile' | 'legal' | 'nutrition' | 'inbox' | 'progress'> & { kv: KeyValueStore }, locale: Locale = 'en') {
  return render(
    <AppProviders
      syncClient={d.client}
      initialLocale={locale}
      profile={d.profile}
      legal={d.legal}
      nutrition={d.nutrition}
      progress={{ progress: d.progress, nutrition: d.inbox, vault: null, randomBytes: (n) => new Uint8Array(n) }}
      privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}
    >
      <NutritionScreen onExit={() => undefined} />
    </AppProviders>,
  );
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const logEvents = (d: { legal: Device['legal'] }) => d.legal.getState().events;
const plans = (d: { nutrition: Device['nutrition'] }) => d.nutrition.getState().plans.map((p) => p.data);

/** Every host control and text input has an accessibility label. */
function expectEveryControlLabelled() {
  const unlabelled: string[] = [];
  const walk = (node: typeof screen.root) => {
    const p = node.props as { accessibilityRole?: string; accessibilityLabel?: string; testID?: string; onChangeText?: unknown };
    if (typeof node.type === 'string' && (p.accessibilityRole === 'button' || p.accessibilityRole === 'togglebutton' || p.accessibilityRole === 'radio' || p.onChangeText) && !p.accessibilityLabel) unlabelled.push(p.testID ?? node.type);
    for (const c of node.children) if (typeof c !== 'string') walk(c);
  };
  walk(screen.root);
  expect(unlabelled).toEqual([]);
}

describe('goal condition 3: deficit disabled → no calorie numbers, supportive content', () => {
  it.each([
    ['en', 'a 17-year-old (fictional)', { birthYear: 2009 }, 'nutrition.supportive.minor'],
    ['fr', 'a user advised against calorie restriction (fictional)', { yes: ['advised_against_calorie_restriction'] as ScreeningQuestionId[] }, 'nutrition.supportive.advised_against'],
  ] as const)('%s: %s', (locale, _name, options, reason) => {
    const d = device(options);
    expect(selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records).deficitNutritionAllowed).toBe(false);
    renderNutrition(d, locale);
    const t = tr(locale).t;
    expect(screen.getByTestId('nutrition-supportive')).toBeTruthy();
    expect(screen.getByText(t(`engine.reason.${reason}`))).toBeTruthy();
    expect(screen.getByTestId('nutrition-supportive-resources')).toBeTruthy();
    expect(screen.getByTestId('nutrition-habits')).toBeTruthy();
    // No set-up that could offer a deficit, no target, no quick log with numbers.
    for (const id of ['nutrition-setup', 'nutrition-target', 'nutrition-target-energy', 'nutrition-target-protein', 'nutrition-quick', 'notice-nutrition_deficit']) expect(screen.queryByTestId(id)).toBeNull();
    const strings = visibleStrings();
    expect(strings.filter((s) => /kcal|\d{3,}/i.test(s))).toEqual([]);
    expect(strings.flatMap((s) => [...nutritionCopyPhrases(s, locale), ...guiltPhrases(s, locale), ...judgementalBodyTerms(s, locale)])).toEqual([]);
    expectEveryControlLabelled();
    // Habits still work, without numbers.
    press('habit-hydration');
    expect(d.nutrition.getState().habitChecks.map((c) => c.data)).toEqual([expect.objectContaining({ habit: 'hydration', checkedOn: TODAY, done: true })]);
    expect(plans(d)).toEqual([]);
  });

  it('an adult who chose "habits, no numbers" sees the same supportive content', () => {
    const d = device();
    renderNutrition(d);
    press('nutrition-style-habits');
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-supportive')).toBeTruthy();
    expect(screen.queryByTestId('nutrition-target-energy')).toBeNull();
    expect(plans(d)[0]!.target).toMatchObject({ mode: 'supportive', energy: null, reasonCodes: ['nutrition.supportive.chosen'] });
  });

  it('a stored numeric plan turns supportive at once when a re-screen switches deficit features off', () => {
    const d = device();
    renderNutrition(d);
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-target-energy')).toBeTruthy();
    screen.unmount();
    d.profile.getState().updateDraft({ answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, q === 'advised_against_calorie_restriction' ? 'yes' : 'no'])) });
    d.profile.getState().saveScreening('new_condition', { year: 2026, month: 9, day: 24 });
    renderNutrition(d);
    expect(screen.getByTestId('nutrition-supportive')).toBeTruthy();
    expect(screen.queryByTestId('nutrition-target-energy')).toBeNull();
    expect(plans(d).map((p) => [p.reason, p.target.mode])).toEqual([
      ['setup', 'numeric'],
      ['settings_changed', 'supportive'],
    ]);
  });
});

describe('S4: what the screen shows never outruns the stored plan (no stale calorie target)', () => {
  /* Found in PO verification: the screen showed the STORED plan and relied on
     NutritionProvider's effect to store the supportive plan after a
     re-screen; one full run saw "Energy: about 2,820 kcal a day" for a user
     just advised against calorie restriction. The display decision is now
     pure and checks the stored plan against the current inputs first. */
  it('a numeric plan made before a re-screen that switched deficit features off is not shown; the engine answer for the current profile is', () => {
    const d = device();
    renderNutrition(d);
    press('nutrition-setup-save');
    screen.unmount();
    expect(plans(d).map((p) => p.target.mode)).toEqual(['numeric']);
    d.profile.getState().updateDraft({ answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, q === 'advised_against_calorie_restriction' ? 'yes' : 'no'])) });
    d.profile.getState().saveScreening('new_condition', { year: 2026, month: 9, day: 24 });
    // No render: NutritionProvider's upkeep effect has NOT run, the stale numeric plan is still the latest stored one.
    const safetyProfile = selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records);
    expect(safetyProfile.deficitNutritionAllowed).toBe(false);
    const n = d.nutrition.getState();
    const shown = currentNutrition({
      profile: d.profile.getState().profile, safetyProfile, bodyMetrics: d.progress.getState().bodyMetrics, settings: n.settings,
      plans: n.plans, intakeLogs: n.intakeLogs, guardrailEvents: n.guardrailEvents, today: TODAY, now: () => Date.now(),
    });
    expect(shown.stored).toBe(false);
    expect(shown.result!.target.mode).toBe('supportive');
    expect(shown.result!.target.energy).toBeNull();
    expect(plans(d).map((p) => p.target.mode)).toEqual(['numeric']);
  });

  it('a stored plan that is still current is shown as stored', () => {
    const d = device();
    renderNutrition(d);
    press('nutrition-setup-save');
    screen.unmount();
    const safetyProfile = selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records);
    const n = d.nutrition.getState();
    const shown = currentNutrition({
      profile: d.profile.getState().profile, safetyProfile, bodyMetrics: d.progress.getState().bodyMetrics, settings: n.settings,
      plans: n.plans, intakeLogs: n.intakeLogs, guardrailEvents: n.guardrailEvents, today: TODAY, now: () => Date.now(),
    });
    expect(shown.stored).toBe(true);
    expect(shown.result!.target.targetId).toBe(n.plans.at(-1)!.data.target.targetId);
  });
});

describe('goal condition 7: the deficit set-up shows the L3 notice first', () => {
  it('choosing fat loss with numbers shows the nutrition-deficit notice; pace and save appear only after it is acknowledged', () => {
    const d = device();
    renderNutrition(d);
    expect(screen.getByTestId('nutrition-setup')).toBeTruthy();
    expect(screen.queryByTestId('notice-nutrition_deficit')).toBeNull();
    press('nutrition-goal-fat_loss');
    expect(screen.getByTestId('notice-nutrition_deficit')).toBeTruthy();
    expect(screen.getByText(tr('en').t('legal.notice.nutritionDeficit.v1.body'))).toBeTruthy();
    for (const id of ['nutrition-pace', 'nutrition-pace-0.5', 'nutrition-setup-save', 'nutrition-goal-weight']) expect(screen.queryByTestId(id)).toBeNull();
    expect(d.legal.getState().notices.map((n) => [n.noticeId, n.kind])).toEqual([['nutrition_deficit', 'shown']]);
    press('notice-nutrition_deficit-ack');
    expect(screen.queryByTestId('notice-nutrition_deficit')).toBeNull();
    press('nutrition-pace-0.75');
    fireEvent.changeText(screen.getByTestId('nutrition-goal-weight'), '95');
    press('nutrition-setup-save');
    const [plan] = plans(d);
    expect(plan!.reason).toBe('setup');
    expect(plan!.input).toMatchObject({ goal: 'fat_loss', plannedLossPercentPerWeek: 0.75, goalWeightKg: 95, weightKg: 120, heightCm: 178 });
    expect(plan!.target).toMatchObject({ mode: 'numeric', deficitAllowed: true, goalWeightKg: 95, engineVersion: ENGINE_VERSION, rulesVersion: NUTRITION_RULES_VERSION });
    expect(plan!.target.energy!.targetKcal).toBeGreaterThanOrEqual(plan!.target.energy!.floorKcal);
    expect(screen.getByTestId('nutrition-target-energy')).toBeTruthy();
    expect(screen.getByTestId('nutrition-target-pace')).toBeTruthy();
    // Device defensibility buffer (L11): notice shown, acknowledged, then the target with versions and codes, no value.
    const events = logEvents(d);
    const types = events.map((e) => e.type);
    expect(types.indexOf('notice.shown')).toBeLessThan(types.indexOf('notice.acknowledged'));
    expect(types.indexOf('notice.acknowledged')).toBeLessThan(types.indexOf('nutrition.target_set'));
    // 0.75 %/week of this sedentary-to-light profile would go below the estimated BMR: S4 keeps it at the floor, and logs it.
    expect(plan!.target.reasonCodes).toContain('nutrition.s4.bmr_floor');
    expect(events.filter((e) => e.type === 'safety.event').map((e) => e.payload)).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.bmr_floor', action: 'capped', engineVersion: ENGINE_VERSION }]);
    expect(events.find((e) => e.type === 'nutrition.target_set')!.payload).toEqual({ targetId: plan!.target.targetId, engineVersion: ENGINE_VERSION, rulesVersion: NUTRITION_RULES_VERSION, mode: 'numeric', reason: 'setup', deficitAllowed: true, reasonCodes: plan!.target.reasonCodes });
    expect(verifyChain(events).ok).toBe(true);
    expectEveryControlLabelled();
  });

  it('once acknowledged, the notice is not repeated for the same version; a goal weight below BMI 18.5 is refused with an explanation', () => {
    const d = device();
    renderNutrition(d);
    press('nutrition-goal-fat_loss');
    press('notice-nutrition_deficit-ack');
    screen.unmount();
    renderNutrition(d);
    press('nutrition-goal-fat_loss');
    expect(screen.queryByTestId('notice-nutrition_deficit')).toBeNull();
    fireEvent.changeText(screen.getByTestId('nutrition-goal-weight'), '50');
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-setup-error').props.children).toBe(tr('en').t('nutrition.setup.goalWeightTooLow', { weight: '58.7 kg' }));
    expect(plans(d)).toEqual([]);
    fireEvent.changeText(screen.getByTestId('nutrition-goal-weight'), 'abc');
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-setup-error').props.children).toBe(tr('en').t('nutrition.setup.invalid'));
  });

  it('asks for height and weight when the profile has none, in the user’s units, and saves the weight as a weigh-in', () => {
    const d = device({ biometrics: { heightCm: null, weightKg: null } });
    renderNutrition(d);
    fireEvent.changeText(screen.getByTestId('nutrition-height'), '165');
    fireEvent.changeText(screen.getByTestId('nutrition-weight'), '');
    press('nutrition-setup-save');
    expect(screen.getByTestId('nutrition-setup-error')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('nutrition-weight'), '60,5');
    press('nutrition-sex-female');
    press('nutrition-setup-save');
    expect(d.progress.getState().bodyMetrics.map((m) => [m.data.kind, m.data.value])).toEqual([['weight', 60.5]]);
    expect(plans(d)[0]!.input).toMatchObject({ weightKg: 60.5, heightCm: 165, sexForEstimate: 'female' });
    expect(screen.getByTestId('nutrition-target-energy')).toBeTruthy();
  });

  it('without the health consent nothing is shown and nothing is computed', () => {
    const d = device();
    d.consents.getState().decide('health', false, 'en');
    renderNutrition(d);
    expect(screen.getByTestId('nutrition-no-consent')).toBeTruthy();
    expect(screen.queryByTestId('nutrition-setup')).toBeNull();
  });
});

describe('goal condition 6: the M04 guardrail event shows a supportive notice and reduces the deficit', () => {
  it('sustained loss > 1 %/week for 3 weeks on the dashboard → the nutrition plan pauses the deficit, logs S4, and shows the notice', () => {
    const d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 12, lossPercentPerWeek: -1.6, lossWeeks: 5 });
    let seed = 0;
    const nutrition = createNutritionStore({ sync: d.client, kv: d.kv, now: () => new Date(), newSeed: () => ++seed });
    const inbox = createGuardrailInbox(d.kv, (e) => nutrition.getState().receiveGuardrail(e));
    const progress = createProgressStore({ sync: d.client, kv: d.kv, now: () => new Date(), nutrition: inbox });
    const m10 = { ...d, nutrition, inbox, progress };
    // A fat-loss plan at 1 %/week set up three weeks before (fictional P2-like user, 165 cm).
    const settings: NutritionSettings = { schemaVersion: 1, goal: 'fat_loss', trackingStyle: 'numbers', activityLevel: 'moderate', sexForEstimate: 'female', plannedLossPercentPerWeek: 1, goalWeightKg: null, heightCm: 165 };
    nutrition.getState().saveSettings(settings);
    const safetyProfile = selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records);
    const setupInput = buildNutritionInput({ settings, profile: d.profile.getState().profile!, safetyProfile, bodyMetrics: progress.getState().bodyMetrics, intakeLogs: [], guardrailEvents: [], previous: null, today: TODAY });
    const before = nutrition.getState().recordPlan(setupInput, 'setup').target;
    expect(before.energy!.deficitKcal).toBeGreaterThan(300);

    // The dashboard detects the sustained loss and hands it off (M04).
    render(
      <AppProviders syncClient={d.client} initialLocale="en" profile={d.profile} legal={d.legal} nutrition={nutrition} progress={{ progress, nutrition: inbox, vault: null, randomBytes: (n) => new Uint8Array(n) }} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
        <ProgressScreen onExit={() => undefined} />
      </AppProviders>,
    );
    expect(screen.getByTestId('progress-guardrail')).toBeTruthy();
    expect(nutrition.getState().guardrailEvents).toEqual([TODAY]);
    // M10 handled it at once, without the nutrition screen being open: a new plan without a deficit (S4).
    const after = plans(m10);
    expect(after.map((p) => p.reason)).toEqual(['setup', 'guardrail']);
    const paused = after[1]!;
    expect(paused.input.guardrailEvents).toEqual([TODAY]);
    expect(paused.target.energy!.deficitKcal).toBe(0);
    expect(paused.target.plannedLossPercentPerWeek).toBe(0);
    expect(paused.target.reasonCodes).toContain('nutrition.guardrail.paused');
    const s4 = d.legal.getState().events.filter((e) => e.type === 'safety.event').map((e) => e.payload);
    expect(s4).toEqual(expect.arrayContaining([{ invariant: 'S4', reasonCode: 'progress.guardrail.sustained_loss', action: 'handed_off', engineVersion: ENGINE_VERSION }, { invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_pause', action: 'deficit_reduced', engineVersion: ENGINE_VERSION }]));
    expect(d.legal.getState().events.filter((e) => e.type === 'nutrition.target_set').map((e) => (e.payload as { reason: string }).reason)).toEqual(['guardrail']);
    screen.unmount();

    // The nutrition screen shows the supportive notice; OK consumes the M04 inbox.
    renderNutrition(m10);
    expect(screen.getByTestId('nutrition-guardrail')).toBeTruthy();
    expect(screen.getByText(tr('en').t('nutrition.guardrail.body'))).toBeTruthy();
    expect(screen.getByTestId('nutrition-reason-nutrition.guardrail.paused')).toBeTruthy();
    expect(screen.queryByTestId('nutrition-target-pace')).toBeNull();
    expect(visibleStrings().flatMap((s) => [...nutritionCopyPhrases(s, 'en'), ...guiltPhrases(s, 'en'), ...judgementalBodyTerms(s, 'en')])).toEqual([]);
    press('nutrition-guardrail-ok');
    expect(screen.queryByTestId('nutrition-guardrail')).toBeNull();
    expect(inbox.pending()).toEqual([]);
    screen.unmount();

    // After the two-week pause the deficit comes back smaller: at most 0.5 %/week (config), below the 1 % chosen.
    jest.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
    const later = buildNutritionInput({ settings, profile: d.profile.getState().profile!, safetyProfile, bodyMetrics: progress.getState().bodyMetrics, intakeLogs: [], guardrailEvents: nutrition.getState().guardrailEvents, previous: paused, today: '2026-10-09' });
    expect(planUpkeep(paused, later)).toBe('weekly_update');
    const reduced = nutrition.getState().recordPlan(later, 'weekly_update');
    expect(reduced.target.plannedLossPercentPerWeek).toBeGreaterThan(0);
    expect(reduced.target.plannedLossPercentPerWeek).toBeLessThanOrEqual(0.5);
    expect(reduced.target.energy!.deficitKcal).toBeLessThan(before.energy!.deficitKcal);
    expect(reduced.target.reasonCodes).toContain('nutrition.guardrail.rate_reduced');
    expect(reduced.safetyEvents).toEqual([{ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_reduced', action: 'deficit_reduced' }]);
  });
});

describe('store details', () => {
  it('intake corrections are new entries; plans are schema-valid sync records; withdrawal forgets the settings', () => {
    const d = device();
    const log = d.nutrition.getState().logIntake({ kind: 'hand_portion', portion: 'protein_palm', count: 2 }, TODAY);
    expect(log.estimate).toEqual({ energyKcal: 300, proteinG: 50 });
    const [stored] = d.nutrition.getState().intakeLogs;
    d.nutrition.getState().removeIntake(stored!.id);
    expect(d.nutrition.getState().intakeLogs.map((l) => [l.data.removed, l.data.correctionOf])).toEqual(
      expect.arrayContaining([
        [false, null],
        [true, stored!.id],
      ]),
    );
    expect(d.nutrition.getState().intakeLogs).toHaveLength(2);
    expect(() => d.nutrition.getState().removeIntake('nope')).toThrow('unknown intake log');
    renderNutrition(d);
    press('nutrition-setup-save');
    expect(d.client.list(NUTRITION_COLLECTIONS.plans).every((r) => NutritionPlanRecordSchema.safeParse(r.data).success)).toBe(true);
    expect(d.nutrition.getState().settings).not.toBeNull();
    d.inbox.receive({ kind: 'bodyweight.sustained_loss', detectedOn: TODAY, weeks: [{ weekEnd: TODAY, percentPerWeek: -1.5 }], thresholdPercentPerWeek: 1, reasonCodes: ['progress.guardrail.sustained_loss'] });
    d.consents.getState().decide('health', false, 'en');
    expect(d.nutrition.getState()).toMatchObject({ settings: null, guardrailEvents: [], pendingNotices: [] });
    // A corrupt stored value is ignored (fail closed to "no settings").
    d.kv.set('nutrition_settings', '{oops');
    d.kv.set('nutrition_guardrail_events', '[1]');
    d.nutrition.getState().reload();
    expect(d.nutrition.getState()).toMatchObject({ settings: null, guardrailEvents: [] });
    expect(isDeepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(isDeepStrictEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(isDeepStrictEqual([1], { 0: 1 })).toBe(false);
    expect(isDeepStrictEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(isDeepStrictEqual(null, {})).toBe(false);
  });
});
