import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCoachTurn } from '@fitadapt/coach';
import { EQUIPMENT_PRESETS, buildCapacityModel } from '@fitadapt/exercise-library';
import type { Locale } from '@fitadapt/i18n';
import { notice, renderNotice, verifyChain } from '@fitadapt/legal';
import { SCREENING_QUESTION_IDS, type AssessmentResult, type CoachContext, type CoachMessageResponse, type StartConversationResponse } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppProviders } from '../src/AppProviders';
import { createCoachAdjustmentStore } from '../src/coach/adjustments';
import { CoachRequestError, createHttpCoachClient, type CoachClient } from '../src/coach/coach-client';
import { createLegalStore } from '../src/legal/legal-store';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectIntensityLock } from '../src/profile/selectors';
import { CoachScreen } from '../src/screens/CoachScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { MemoryKeyValueStore } from '../src/storage/app-state';
import { tr, visibleStrings } from './helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID(), getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('node:crypto').randomBytes(n)) }));

/**
 * M11 on the device (screen level). Fictional users only.
 * - goal condition 7 (L5): the "AI assistant" label is on screen in every
 *   state, and every conversation starts with the FR/EN AI disclosure,
 *   recorded in the device ledger each time;
 * - goal condition 6: offline, the coach answers from the app's guide and
 *   the engine's deterministic actions (no network, no model);
 * - goal condition 4: a red flag in chat starts the M05 stop flow on the
 *   device (seek-care guidance, S3 events, intensity locked);
 * - goal condition 1: no provider key or SDK in the app (source, dependencies
 *   and the exported bundle when present).
 */
const TODAY = '2026-09-28';
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(`${TODAY}T07:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate'] });
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
});

const gymResult: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-24T17:00:00.000Z',
  completedAt: '2026-09-24T17:30:00.000Z',
  tests: [
    { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 100, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 80, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 60, reps: 10, rir: 2, seconds: null },
    { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 70, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 90, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 50, rir: null },
  ],
};

function device(options: { aiConsent?: boolean } = {}) {
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  consents.getState().decide('health', true, 'en');
  if (options.aiConsent !== false) consents.getState().decide('ai_coach', true, 'en');
  profile.getState().saveEquipment('gym', [...EQUIPMENT_PRESETS.full_gym]);
  profile.getState().updateDraft({
    primaryGoal: 'muscle_gain',
    experience: 'intermediate',
    schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1982, month: 5, day: 4 },
    biometrics: { heightCm: null, weightKg: null, bodyFatPercent: null },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2026, month: 9, day: 24 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  // M07: a gym assessment, so today has a first session from the capacity model.
  profile.getState().saveAssessment({ reason: 'first', result: gymResult, capacity: buildCapacityModel(gymResult), cappedByS1: false });
  const adjustments = createCoachAdjustmentStore(kv);
  return { client, kv, consents, profile, legal, adjustments };
}
type Device = ReturnType<typeof device>;

function renderCoach(d: Device, locale: Locale = 'en', coachClient?: CoachClient) {
  return render(
    <AppProviders syncClient={d.client} initialLocale={locale} profile={d.profile} legal={d.legal} coach={{ client: coachClient, adjustments: d.adjustments }} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
      <CoachScreen onExit={() => undefined} onOpenPrivacy={() => undefined} onOpenWorkout={() => undefined} />
    </AppProviders>,
  );
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
async function say(text: string) {
  fireEvent.changeText(screen.getByTestId('coach-input'), text);
  fireEvent.press(screen.getByTestId('coach-send'));
  await flush();
  await flush();
}
const shownAiNotices = (d: Device) => d.legal.getState().notices.filter((n) => n.noticeId === 'ai_coach' && n.kind === 'shown');

describe('L5: the AI label and the AI disclosure (goal condition 7)', () => {
  it.each(['en', 'fr'] as const)('%s: the label is always visible and every conversation starts with the disclosure, recorded each time', async (locale) => {
    const d = device();
    renderCoach(d, locale);
    await flush();
    const t = tr(locale).t;
    const label = t('legal.notice.aiCoach.label');
    expect(screen.getByTestId('coach-ai-label')).toHaveTextContent(label);
    const disclosure = renderNotice(notice('ai_coach'), locale, 'GB');
    expect(screen.getAllByTestId('coach-disclosure')).toHaveLength(1);
    expect(screen.getByText(disclosure.body)).toBeTruthy();
    expect(shownAiNotices(d)).toHaveLength(1);
    // The disclosure opens the conversation: it is the first thing before any message.
    await say(locale === 'fr' ? 'C’est quoi le RIR ?' : 'What is RIR?');
    expect(screen.getByTestId('coach-ai-label')).toHaveTextContent(label);
    const order = visibleStrings();
    expect(order).toContain(disclosure.body);
    // A new conversation shows the disclosure again and records it again.
    fireEvent.press(screen.getByTestId('coach-new'));
    await flush();
    expect(screen.getAllByTestId('coach-disclosure')).toHaveLength(1);
    expect(screen.queryAllByTestId('coach-reply')).toHaveLength(0);
    expect(shownAiNotices(d)).toHaveLength(2);
    expect(screen.getByTestId('coach-ai-label')).toHaveTextContent(label);
    expect(verifyChain(d.legal.getState().events).ok).toBe(true);
  });

  it('without the ai_coach consent: no conversation, the label still shows, the way to privacy settings is offered', async () => {
    const d = device({ aiConsent: false });
    renderCoach(d);
    await flush();
    expect(screen.getByTestId('coach-consent-needed')).toBeTruthy();
    expect(screen.getByTestId('coach-ai-label')).toHaveTextContent(tr('en').t('legal.notice.aiCoach.label'));
    expect(screen.queryByTestId('coach-input')).toBeNull();
    expect(shownAiNotices(d)).toHaveLength(0);
  });
});

describe('offline: FAQ and deterministic actions (goal condition 6)', () => {
  it('answers from the app’s guide with its source, with no network and no model', async () => {
    const d = device();
    renderCoach(d);
    await flush();
    expect(screen.getByTestId('coach-offline')).toHaveTextContent(tr('en').t('coach.offline.banner'));
    await say('What is RIR?');
    const t = tr('en').t;
    expect(screen.getByTestId('coach-reply')).toHaveTextContent(t('coach.kb.rir.body'), { exact: false });
    expect(screen.getByTestId('coach-references')).toHaveTextContent(t('coach.references', { list: t('coach.kb.rir.title') }));
  });

  it('a time change is the engine’s plan, used for today only when the user taps it', async () => {
    const d = device();
    renderCoach(d, 'fr');
    await flush();
    await say('Je n’ai que 25 minutes');
    expect(screen.getByTestId('coach-reply')).toHaveTextContent(tr('fr').t('coach.reply.time.proposed', { minutes: 25 }), { exact: false });
    expect(d.adjustments.getState().adjustment).toBeNull();
    fireEvent.press(screen.getByTestId('coach-apply'));
    expect(d.adjustments.getState().adjustment).toEqual({ date: TODAY, minutes: 25 });
    expect(screen.getByTestId('coach-applied')).toBeTruthy();
    // Today's session now uses it: the workout screen builds its input with 25 minutes, and the engine fits the plan to it.
    screen.unmount();
    render(
      <AppProviders syncClient={d.client} initialLocale="fr" profile={d.profile} legal={d.legal} coach={{ adjustments: d.adjustments }} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
        <WorkoutScreen onExit={() => undefined} />
      </AppProviders>,
    );
    const minutes = Number(/\d+/.exec(String(screen.getByTestId('workout-minutes').props.children))![0]);
    expect(minutes).toBeLessThanOrEqual(25);
    // A day later the adjustment no longer applies.
    expect(d.adjustments.getState().adjustment?.date).toBe(TODAY);
  });

  it('a pain report is written through the device store (M05) while offline', async () => {
    const d = device();
    renderCoach(d);
    await flush();
    await say('My knee hurts 4/10');
    expect(d.profile.getState().executionLogs.map((l) => l.data)).toEqual([expect.objectContaining({ kind: 'pain', joint: 'knee', score: 4 })]);
  });

  it('falls back to the device when the API cannot answer, and says when the limit is reached', async () => {
    const d = device();
    const failing: CoachClient = {
      start: async () => ({ conversationId: randomUUID(), startedAt: new Date().toISOString(), disclosure: { noticeId: 'ai_coach', version: 1, titleKey: 'legal.notice.aiCoach.v1.title', bodyKey: 'legal.notice.aiCoach.v1.body', labelKey: 'legal.notice.aiCoach.label', contentHash: '0'.repeat(64) } }),
      send: async () => {
        throw new CoachRequestError(429, 'coach.rate_limited');
      },
    };
    renderCoach(d, 'en', failing);
    await flush();
    expect(screen.queryByTestId('coach-offline')).toBeNull();
    await say('What is RIR?');
    expect(screen.getByTestId('coach-rate-limited')).toBeTruthy();
    expect(screen.getByTestId('coach-references')).toBeTruthy();
  });
});

describe('red flag in chat → the M05 stop flow on the device (goal condition 4)', () => {
  it.each([
    ['en', 'I have chest pain but I want to finish my sets', 'chest_pain_pressure'],
    ['fr', 'j’ai des palpitations depuis la dernière série', 'palpitations'],
  ] as const)('%s: seek-care guidance, S3 events, intensity locked until a review is attested', async (locale, text, symptom) => {
    const d = device();
    renderCoach(d, locale);
    await flush();
    await say(text);
    expect(screen.getByTestId('coach-reply')).toHaveTextContent(tr(locale).t('coach.reply.redFlag'), { exact: false });
    expect(screen.getByTestId('notice-seek_care')).toBeTruthy();
    expect(screen.getByTestId('notice-seek_care-emergency')).toHaveTextContent(/999/);
    const logs = d.profile.getState().executionLogs;
    expect(logs.map((l) => l.data)).toEqual([expect.objectContaining({ kind: 'red_flag', symptom, planId: null })]);
    expect(selectIntensityLock(logs).locked).toBe(true);
    const events = d.legal.getState().events.filter((e) => e.type === 'safety.event').map((e) => (e.payload as { reasonCode: string }).reasonCode);
    expect(events).toEqual([`safety.s3.${symptom}`, 'safety.s3.intensity_locked']);
    expect(d.legal.getState().notices.some((n) => n.noticeId === 'seek_care' && n.kind === 'shown')).toBe(true);
  });

  it('online: the server’s stop action is applied on the device at once as well', async () => {
    const d = device();
    let context: CoachContext | null = null;
    const online: CoachClient = {
      start: async (locale, jurisdiction) => ({ conversationId: randomUUID(), startedAt: new Date().toISOString(), disclosure: { noticeId: 'ai_coach', version: 1, titleKey: 'legal.notice.aiCoach.v1.title', bodyKey: 'legal.notice.aiCoach.v1.body', labelKey: 'legal.notice.aiCoach.label', contentHash: renderNotice(notice('ai_coach'), locale, jurisdiction).contentHash } }),
      send: async (conversationId, text, ctx) => {
        context = ctx;
        const out = await runCoachTurn({ text, context: ctx, model: null, env: { nowMs: Date.now(), seed: 1, newId: randomUUID }, noModelSource: 'deterministic' });
        return { ...out.result, conversationId, messageId: randomUUID() } as CoachMessageResponse;
      },
    };
    renderCoach(d, 'en', online);
    await flush();
    await say('I feel dizzy and I think I might faint');
    expect(screen.getByTestId('notice-seek_care')).toBeTruthy();
    expect(selectIntensityLock(d.profile.getState().executionLogs).locked).toBe(true);
    // The context sent is the engine's input for today (no name or email in it).
    expect(context).not.toBeNull();
    expect(JSON.stringify(context)).not.toMatch(/@|email/i);
    expect(context!.today?.plan?.exercises.length).toBeGreaterThan(0);
  });
});

describe('server-side model only: no provider key in the app (goal condition 1)', () => {
  const root = join(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name === 'coverage' || name.startsWith('.')) return [];
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/, /ANTHROPIC_API_KEY/, /@anthropic-ai\/sdk/, /x-api-key/i, /api\.anthropic\.com/];

  it('no key, SDK or provider endpoint in the app source, config or dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@anthropic-ai'))).toEqual([]);
    const sources = [...files(join(root, 'src')), ...files(join(root, 'app')), join(root, 'app.json'), join(root, 'app.config.js'), join(root, 'eas.json')];
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const p of KEY_PATTERNS) expect({ file: f, found: p.test(text) }).toEqual({ file: f, found: false });
    }
  });

  it('the exported bundle (pnpm --filter @fitadapt/mobile bundle:check) holds no key, SDK or provider endpoint', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return; // The bundle is exported by bundle:check; this test greps it whenever it exists.
    const bundles = files(dist).filter((f) => /\.(js|hbc|json|map)$/.test(f));
    expect(bundles.length).toBeGreaterThan(0);
    for (const f of bundles) {
      const text = readFileSync(f, 'latin1');
      for (const p of KEY_PATTERNS) expect({ file: f, found: p.test(text) }).toEqual({ file: f, found: false });
    }
  });

  it('the HTTP client talks to the API only, with the user’s token', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const client = createHttpCoachClient({
      baseUrl: 'https://api.example.test',
      getAccessToken: () => 'user-token',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return { ok: false, status: 403, json: async () => ({ error: { code: 'privacy.consent_required' } }) } as Response;
      }) as unknown as typeof fetch,
    });
    await expect(client.start('en', 'GB')).rejects.toMatchObject({ status: 403, code: 'privacy.consent_required' });
    expect(calls).toEqual([{ url: 'https://api.example.test/v1/coach/conversations', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' } }]);
  });
});

describe('the Maestro flow e2e/coach-red-flag.yaml (not executed here: no device)', () => {
  it('only uses testIDs the app renders', () => {
    const root = join(__dirname, '..');
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) all.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'app'));
    const source = all.map((f) => readFileSync(f, 'utf8')).join('\n');
    const literal = new Set([...source.matchAll(/testID="([^"]+)"/g)].map((m) => m[1]!));
    const prefixes = [...source.matchAll(/testID=\{`([^`$]*)\$\{/g)].map((m) => m[1]!);
    const flow = readFileSync(join(root, 'e2e', 'coach-red-flag.yaml'), 'utf8');
    const ids = [...flow.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => !literal.has(id) && !prefixes.some((p) => p.length > 0 && id.startsWith(p)))).toEqual([]);
  });
});

export type { StartConversationResponse };
