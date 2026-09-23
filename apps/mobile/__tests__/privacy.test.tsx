import type { AnalyticsEvent } from '@fitadapt/privacy';
import { DataExportSchema, type DataExport } from '@fitadapt/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { Share, Text } from 'react-native';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { AppProviders } from '../src/AppProviders';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { createAnalytics } from '../src/privacy/analytics';
import { createHttpPrivacyClient, PrivacyRequestError, type PrivacyClient } from '../src/privacy/client';
import { createConsentStore } from '../src/privacy/consents';
import { FeatureGate, usePrivacy } from '../src/privacy/PrivacyProvider';
import { HomeScreen } from '../src/screens/HomeScreen';
import { PrivacyScreen } from '../src/screens/PrivacyScreen';
import { MemoryKeyValueStore, SqliteKeyValueStore, wipeLocalDatabase } from '../src/storage/app-state';
import { assertSecureApiUrl, createDeviceSyncClient } from '../src/sync/device';
import { memoryClient } from './helpers';

const exportDoc: DataExport = DataExportSchema.parse({
  format: 'account-data-export',
  schemaVersion: 1,
  generatedAt: '2026-09-23T10:00:00.000Z',
  user: { id: randomUUID(), email: 'fictional.user@example.test', locale: 'en', unitSystem: 'metric', createdAt: '2026-09-01T10:00:00.000Z' },
  devices: [],
  sessions: [],
  consents: [],
  sync: { revision: 0, changes: [], mutations: [] },
  dataRequests: [],
  auditTrail: [],
});

function setup(options: { client?: PrivacyClient | null; locale?: 'en' | 'fr'; kv?: MemoryKeyValueStore } = {}) {
  const kv = options.kv ?? new MemoryKeyValueStore();
  const sent: AnalyticsEvent[] = [];
  const wipe = jest.fn();
  const client =
    options.client === null
      ? undefined
      : (options.client ?? {
          exportData: jest.fn(async () => exportDoc),
          deleteAccount: jest.fn(async () => ({
            requestId: randomUUID(),
            status: 'backup_purge_pending' as const,
            primaryDeletedAt: '2026-09-23T10:00:00.000Z',
            backupPurgeDueAt: '2026-10-23T10:00:00.000Z',
          })),
        });
  const privacy = {
    ageGate: createAgeGateStore(kv),
    consents: createConsentStore({ kv, newId: randomUUID, jurisdiction: 'SN' }),
    client,
    wipeLocalData: wipe,
    analyticsTransport: { send: (e: AnalyticsEvent) => void sent.push(e) },
  };
  function Probe() {
    const { analytics } = usePrivacy();
    return (
      <>
        <FeatureGate feature="ai_coach.chat" fallback={<Text>coach-off</Text>}>
          <Text>coach-on</Text>
        </FeatureGate>
        <FeatureGate feature="wearables.import" fallback={<Text>wearables-off</Text>}>
          <Text>wearables-on</Text>
        </FeatureGate>
        <Text onPress={() => analytics.track('app_opened', {})}>track</Text>
      </>
    );
  }
  render(
    <AppProviders syncClient={memoryClient().client} initialLocale={options.locale ?? 'en'} privacy={privacy}>
      <PrivacyScreen />
      <Probe />
    </AppProviders>,
  );
  return { kv, sent, wipe, client, privacy };
}

const toggle = (name: string) => screen.getByRole('switch', { name });
const checked = (name: string) => (toggle(name).props.accessibilityState as { checked: boolean }).checked;

describe('consent-gated features on the device (goal condition 1)', () => {
  it('every data type starts off, and no gated feature is on', () => {
    setup();
    for (const name of ['Health data', 'Progress photos', 'Wearables and health apps', 'AI coach', 'Usage statistics']) {
      expect(checked(name)).toBe(false);
    }
    expect(screen.getByText('coach-off')).toBeTruthy();
    expect(screen.getByText('wearables-off')).toBeTruthy();
  });

  it('a feature switches on with its consent and off at once on withdrawal', () => {
    setup();
    fireEvent.press(toggle('AI coach'));
    expect(checked('AI coach')).toBe(true);
    expect(screen.getByText('coach-on')).toBeTruthy();
    fireEvent.press(toggle('AI coach'));
    expect(checked('AI coach')).toBe(false);
    expect(screen.getByText('coach-off')).toBeTruthy();
  });

  it('a feature needing two consents waits for both and stops when either is withdrawn', () => {
    setup();
    fireEvent.press(toggle('Wearables and health apps'));
    expect(screen.getByText('wearables-off')).toBeTruthy();
    fireEvent.press(toggle('Health data'));
    expect(screen.getByText('wearables-on')).toBeTruthy();
    fireEvent.press(toggle('Health data'));
    expect(screen.getByText('wearables-off')).toBeTruthy();
  });

  it('records each decision with data type, text version, locale and jurisdiction, and keeps them offline', () => {
    const { kv, privacy } = setup({ locale: 'fr' });
    fireEvent.press(toggle('Données de santé'));
    fireEvent.press(toggle('Données de santé'));
    const records = privacy.consents.getState().records;
    expect(records.map((r) => [r.dataType, r.decision, r.version, r.locale, r.jurisdiction, r.source])).toEqual([
      ['health', 'granted', 1, 'fr', 'SN', 'mobile'],
      ['health', 'withdrawn', 1, 'fr', 'SN', 'mobile'],
    ]);
    // A relaunch reads the same ledger from device storage.
    expect(createConsentStore({ kv, newId: randomUUID, jurisdiction: 'SN' }).getState().records).toEqual(records);
  });

  it('a corrupt ledger fails closed', () => {
    const kv = new MemoryKeyValueStore();
    kv.set('consent_records', '{not json');
    expect(createConsentStore({ kv, newId: randomUUID, jurisdiction: 'FR' }).getState().records).toEqual([]);
    kv.set('consent_records', JSON.stringify([{ dataType: 'health', decision: 'granted' }]));
    expect(createConsentStore({ kv, newId: randomUUID, jurisdiction: 'FR' }).getState().records).toEqual([]);
  });
});

describe('analytics need consent (goal conditions 1 and 3)', () => {
  it('sends nothing without consent, sends allowlisted events with it, and stops on withdrawal', () => {
    const { sent } = setup();
    fireEvent.press(screen.getByText('track'));
    fireEvent.press(toggle('Health data')); // consent_changed, but analytics is off
    expect(sent).toEqual([]);

    fireEvent.press(toggle('Usage statistics'));
    fireEvent.press(screen.getByText('track'));
    expect(sent).toEqual([
      { event: 'consent_changed', props: { dataType: 'analytics', decision: 'granted' } },
      { event: 'app_opened', props: {} },
    ]);

    fireEvent.press(toggle('Usage statistics'));
    fireEvent.press(screen.getByText('track'));
    expect(sent).toHaveLength(2);
  });

  it('rejects events that carry personal data even with consent', () => {
    const sent: AnalyticsEvent[] = [];
    const analytics = createAnalytics({ isEnabled: () => true, transport: { send: (e) => void sent.push(e) } });
    expect(analytics.track('screen_viewed', { screen: 'home' })).toBe('sent');
    const bad = { screen: 'home', note: 'I felt dizzy after the long run' } as unknown as { screen: 'home' };
    expect(analytics.track('screen_viewed', bad)).toBe('rejected');
    expect(createAnalytics({ isEnabled: () => false }).track('app_opened', {})).toBe('dropped_no_consent');
    expect(createAnalytics({ isEnabled: () => true }).track('app_opened', {})).toBe('sent');
    expect(sent).toEqual([{ event: 'screen_viewed', props: { screen: 'home' } }]);
  });
});

describe('export and deletion from the app (goal condition 2)', () => {
  it('exports all data as JSON through the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { client } = setup();
    fireEvent.press(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('Your data is ready.')).toBeTruthy();
    expect(client!.exportData).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0]![0] as { message: string }).message;
    expect(DataExportSchema.parse(JSON.parse(message))).toEqual(exportDoc);
    share.mockRestore();
  });

  it('deletes the account after confirmation and wipes the device', async () => {
    const { client, wipe, privacy } = setup();
    fireEvent.press(toggle('Health data'));
    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText(/Copies in our backups are erased within 30 days\./)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Keep my account' }));
    expect(client!.deleteAccount).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    fireEvent.press(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('Your account has been deleted.')).toBeTruthy();
    expect(client!.deleteAccount).toHaveBeenCalledTimes(1);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(privacy.consents.getState().records).toEqual([]);
    expect(checked('Health data')).toBe(false);
  });

  it('shows a generic error when the request fails', async () => {
    const failing: PrivacyClient = {
      exportData: jest.fn(async () => Promise.reject(new PrivacyRequestError(500))),
      deleteAccount: jest.fn(async () => Promise.reject(new PrivacyRequestError(500))),
    };
    const { wipe } = setup({ client: failing });
    fireEvent.press(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    fireEvent.press(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(failing.deleteAccount).toHaveBeenCalled());
    expect(wipe).not.toHaveBeenCalled();
  });

  it('without sign-in, export and deletion are unavailable and say why', () => {
    setup({ client: null });
    expect(screen.getByText('Sign in to download your data or delete your account.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download my data' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: 'Delete my account' }).props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('device storage', () => {
  let SQL: SqlJsStatic;
  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  it('keeps app state in the local database and wipes account data, keeping only the age-gate outcome', () => {
    const db = drizzle(new SQL.Database());
    const sync = createDeviceSyncClient({ openDatabase: () => db, randomUUID });
    sync.insert('set_logs', { exercise: 'push_up', reps: 12 });
    const kv = new SqliteKeyValueStore(db);
    kv.set('age_gate_status', 'allowed');
    kv.set('consent_records', '[]');
    kv.set('consent_records', '[1]');
    expect(kv.get('consent_records')).toBe('[1]');
    expect(sync.pendingCount()).toBe(1);

    wipeLocalDatabase(db);
    expect(kv.get('consent_records')).toBeUndefined();
    expect(kv.get('age_gate_status')).toBe('allowed');
    expect(sync.pendingCount()).toBe(0);
    kv.remove('age_gate_status');
    expect(kv.get('age_gate_status')).toBeUndefined();
    // The next start creates a new device id.
    const fresh = createDeviceSyncClient({ openDatabase: () => db, randomUUID });
    expect(fresh.deviceId).not.toBe(sync.deviceId);
  });

  it('the age gate ignores a corrupt stored value and never re-opens once blocked', () => {
    const kv = new MemoryKeyValueStore();
    kv.set('age_gate_status', 'maybe');
    const gate = createAgeGateStore(kv);
    expect(gate.getState().status).toBe('unknown');
    const today = { year: 2026, month: 9, day: 23 };
    expect(gate.getState().submit({ year: 2015, month: 1, day: 1 }, today).status).toBe('blocked');
    expect(gate.getState().submit({ year: 1990, month: 1, day: 1 }, today).status).toBe('blocked');
    expect(kv.get('age_gate_status')).toBe('blocked');
  });
});

describe('privacy HTTP client', () => {
  it('calls the export and deletion endpoints with the access token', async () => {
    const calls: [string, RequestInit][] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      const body = url.endsWith('/export')
        ? exportDoc
        : { requestId: randomUUID(), status: 'backup_purge_pending', primaryDeletedAt: '2026-09-23T10:00:00.000Z', backupPurgeDueAt: '2026-10-23T10:00:00.000Z' };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    const client = createHttpPrivacyClient({ baseUrl: 'https://api.example.test', getAccessToken: () => 'token', fetch: fake });
    expect(await client.exportData()).toEqual(exportDoc);
    expect((await client.deleteAccount()).status).toBe('backup_purge_pending');
    expect(calls.map(([url, init]) => [url, init.method, (init.headers as Record<string, string>).authorization])).toEqual([
      ['https://api.example.test/v1/privacy/export', 'GET', 'Bearer token'],
      ['https://api.example.test/v1/privacy/deletion', 'POST', 'Bearer token'],
    ]);
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ confirm: 'delete-my-account' });
  });

  it('turns HTTP errors into a typed error', async () => {
    const fake = (async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    const client = createHttpPrivacyClient({ baseUrl: 'https://api.example.test', getAccessToken: async () => 'token', fetch: fake });
    await expect(client.exportData()).rejects.toEqual(new PrivacyRequestError(429));
  });
});

describe('transport security (MASVS-NETWORK)', () => {
  it('requires https, except loopback in development builds', async () => {
    expect(assertSecureApiUrl('https://api.example.test', false)).toBe('https://api.example.test');
    expect(assertSecureApiUrl('http://127.0.0.1:3000', true)).toBe('http://127.0.0.1:3000');
    expect(() => assertSecureApiUrl('http://127.0.0.1:3000', false)).toThrow('https');
    expect(() => assertSecureApiUrl('http://api.example.test', true)).toThrow('https');
    const SQL = await initSqlJs();
    const openDatabase = () => drizzle(new SQL.Database());
    expect(() => createDeviceSyncClient({ openDatabase, randomUUID, apiUrl: 'http://api.example.test', isDevelopment: false })).toThrow('API URL must use https');
    expect(createDeviceSyncClient({ openDatabase, randomUUID, apiUrl: 'https://api.example.test', isDevelopment: false }).deviceId).toBeTruthy();
  });

  it('the app config does not allow cleartext traffic', () => {
    const config = jest.requireActual('../app.json') as { expo: Record<string, Record<string, unknown> | undefined> };
    expect(config.expo.android?.usesCleartextTraffic).not.toBe(true);
    const ats = (config.expo.ios?.infoPlist as Record<string, { NSAllowsArbitraryLoads?: boolean }> | undefined)?.NSAppTransportSecurity;
    expect(ats?.NSAllowsArbitraryLoads).not.toBe(true);
  });
});

describe('home entry point', () => {
  it('opens the privacy settings from home', async () => {
    const open = jest.fn();
    render(
      <AppProviders syncClient={memoryClient().client} initialLocale="en">
        <HomeScreen onOpenPrivacy={open} />
      </AppProviders>,
    );
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Privacy settings' }));
    });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
