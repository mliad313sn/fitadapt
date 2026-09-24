import { ENGINE_VERSION } from '@fitadapt/engine';
import { findPersonalData } from '@fitadapt/privacy';
import { guiltPhrases, judgementalBodyTerms, type Locale } from '@fitadapt/i18n';
import { I18nProvider } from '@fitadapt/i18n/react';
import { ThemeProvider } from '@fitadapt/ui';
import type { MilestoneForecast } from '@fitadapt/shared';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AppProviders } from '../src/AppProviders';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { ForecastView, ProgressScreen } from '../src/screens/ProgressScreen';
import { tr, visibleStrings } from './helpers';
import { closeReferenceDevices, REFERENCE_PROFILE, referenceDevice, seedReferenceData, type ReferenceDevice } from './progress-seed';

/**
 * M04 dashboard on the device, offline (every fetch fails), over the app's
 * encrypted database (SQLCipher stand-in writing a real file, progress-seed.ts):
 * - goal condition 3: the reference profile's two-year dataset renders in < 1 s;
 * - goal condition 7: every forecast shows "estimate, not a guarantee" in FR and EN;
 * - goal condition 2 (device side): sustained loss > 1 %/week for 3 weeks shows a
 *   supportive notice and hands the event to the M10 guardrail inbox;
 * - body weight is optional and can be hidden; charts are labelled; no
 *   judgemental body terms, no guilt, no personal data in analytics.
 */
const TODAY = '2026-09-24';
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(`${TODAY}T12:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate'] });
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.useRealTimers();
  closeReferenceDevices();
});
// Seeding thousands of records into the encrypted file takes seconds; it is setup, not the measured render.
const SEED_TIMEOUT = 120_000;

const sent: { event: string; props: Record<string, unknown> }[] = [];

function renderDashboard(d: ReferenceDevice, locale: Locale = 'en') {
  d.consents.getState().decide('analytics', true, 'en');
  const onOpenPhotos = jest.fn();
  const view = render(
    <AppProviders
      syncClient={d.client}
      initialLocale={locale}
      profile={d.profile}
      legal={d.legal}
      progress={{ progress: d.progress, nutrition: d.nutrition, vault: null, randomBytes: (n) => new Uint8Array(n) }}
      privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined, analyticsTransport: { send: (event) => void sent.push(event as { event: string; props: Record<string, unknown> }) } }}
    >
      <ProgressScreen onExit={() => undefined} onOpenPhotos={onOpenPhotos} />
    </AppProviders>,
  );
  return { view, onOpenPhotos };
}

/**
 * The measure is the render of the dashboard over two years of data on a
 * running app. Before it, the same screen is rendered once over two weeks of
 * data and unmounted: in jest that first render also pays one-time costs a
 * phone pays when the app starts (jest loading React Native's and the
 * app's modules on first use, compiling the ICU messages). Both times are
 * printed.
 */
describe('goal condition 3: the dashboard renders two years of data in < 1 s (reference profile)', () => {
  let d: ReferenceDevice;
  let counts: ReturnType<typeof seedReferenceData>;
  let warmUpMs = 0;
  beforeEach(() => {
    const small = referenceDevice();
    seedReferenceData(small, { endDate: TODAY, weeks: 2 });
    const w0 = performance.now();
    renderDashboard(small);
    screen.getByTestId('progress-strength');
    warmUpMs = performance.now() - w0;
    screen.unmount();
    d = referenceDevice();
    counts = seedReferenceData(d, { endDate: TODAY });
  }, SEED_TIMEOUT);

  it(`${REFERENCE_PROFILE.name}: 104 weeks, 3 sessions a week, daily weigh-ins, read from the encrypted database`, () => {
    expect(counts.sessions).toBeGreaterThanOrEqual(300);
    expect(counts.sets).toBeGreaterThanOrEqual(3600);
    expect(counts.weighIns).toBeGreaterThanOrEqual(720);
    // Cold start: the stores read every record back from the encrypted file (timed separately from the render).
    const r0 = performance.now();
    d.profile.getState().reload();
    d.progress.getState().reload();
    const readMs = performance.now() - r0;
    expect(d.profile.getState().setLogs).toHaveLength(counts.sets);
    expect(d.progress.getState().bodyMetrics).toHaveLength(counts.weighIns);
    const t0 = performance.now();
    renderDashboard(d);
    const strength = screen.getByTestId('progress-strength');
    const ms = performance.now() - t0;
    expect(strength).toBeTruthy();
    expect(screen.getByTestId('progress-body-chart')).toBeTruthy();
    expect(screen.getByTestId('progress-milestone-first_pull_up')).toBeTruthy();
    expect(screen.getByTestId('progress-volume-chart')).toBeTruthy();
    console.info(`M04 dashboard, ${counts.sessions} sessions / ${counts.sets} sets / ${counts.weighIns} weigh-ins: read from the encrypted database ${readMs.toFixed(0)} ms, render ${ms.toFixed(0)} ms (first render of the screen in this process, two weeks of data: ${warmUpMs.toFixed(0)} ms)`);
    expect(ms).toBeLessThan(1000);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The two years sit in the file as ciphertext only.
    const bytes = readFileSync(d.databasePath);
    for (const plain of ['SQLite format 3', 'goblet_squat', 'body_metrics', '"kind":"weight"', 'waist']) expect(bytes.includes(Buffer.from(plain))).toBe(false);
  });
});

describe('the dashboard over the reference data', () => {
  let d: ReferenceDevice;
  beforeEach(() => {
    d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 26 });
  }, SEED_TIMEOUT);

  it('shows sessions and a streak that counts rest days, strength with e1RM and variant level, hard sets against the range, and the pull-up milestone', () => {
    renderDashboard(d);
    expect(screen.getByTestId('progress-adherence-planned')).toBeTruthy();
    expect(screen.getByTestId('progress-streak').props.children).toMatch(/rest days and safety pauses count|streak starts/);
    const squat = screen.getByTestId('progress-exercise-goblet_squat');
    expect(squat).toBeTruthy();
    expect(screen.getAllByText(/Estimated one-rep max: \d/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Step \d of \d+ on its progression ladder/).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId('progress-exercise-goblet_squat-open'));
    expect(screen.getByTestId('progress-exercise-goblet_squat-chart-plot').props.accessibilityLabel).toMatch(/sessions from .* to .*; from .* kg to .* kg\./);
    fireEvent.press(screen.getByTestId('progress-exercise-goblet_squat-chart-table-toggle'));
    expect(screen.getByTestId('progress-exercise-goblet_squat-chart-table')).toBeTruthy();
    const volume = screen.getByTestId('progress-volume-chart-plot').props.accessibilityLabel as string;
    expect(volume).toMatch(/^Hard sets this week: Chest: /);
    expect(volume).toMatch(/under the range|within the range|over the range/);
    expect(screen.getByTestId('progress-milestone-first_pull_up-label').props.children).toBe('Estimate, not a guarantee');
    expect(screen.getByTestId('cardio-ledger')).toBeTruthy();
  });

  it('logs body weight and a measurement offline (metric and imperial), and body weight can be hidden', () => {
    const before = d.progress.getState().bodyMetrics.length;
    renderDashboard(d);
    fireEvent.changeText(screen.getByTestId('progress-weight-input'), '59,6');
    fireEvent.press(screen.getByTestId('progress-weight-save'));
    expect(d.progress.getState().bodyMetrics).toHaveLength(before + 1);
    expect(d.progress.getState().bodyMetrics.at(-1)!.data).toMatchObject({ kind: 'weight', value: 59.6, measuredOn: TODAY });
    fireEvent.changeText(screen.getByTestId('progress-weight-input'), 'abc');
    fireEvent.press(screen.getByTestId('progress-weight-save'));
    expect(screen.getByTestId('progress-body-message').props.children).toBe('Please check the number.');
    fireEvent.press(screen.getByTestId('progress-site-hips'));
    fireEvent.changeText(screen.getByTestId('progress-measurement-input'), '94');
    fireEvent.press(screen.getByTestId('progress-measurement-save'));
    expect(screen.getByTestId('progress-measurement-hips').props.children).toMatch(/^Hips: 94 cm on /);
    expect(screen.getByTestId('progress-body-trend')).toBeTruthy();
    expect(screen.getByTestId('progress-body-rate')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Hidden: no weight number, no chart, no input; the choice is kept on the device.
    fireEvent.press(screen.getByTestId('progress-body-show'));
    expect(screen.getByTestId('progress-body-hidden')).toBeTruthy();
    expect(screen.queryByTestId('progress-body-chart')).toBeNull();
    expect(screen.queryByTestId('progress-body-trend')).toBeNull();
    expect(screen.queryByTestId('progress-weight-input')).toBeNull();
    expect(visibleStrings().some((s) => /\d kg/.test(s) && /trend|Trend/.test(s))).toBe(false);
    expect(d.kv.get('progress_show_body_weight')).toBe('false');
  });

  it('imperial units: a weight typed in lb is stored in kg', () => {
    render(
      <AppProviders syncClient={d.client} initialLocale="en" initialUnitSystem="imperial" profile={d.profile} legal={d.legal} progress={{ progress: d.progress, nutrition: d.nutrition, vault: null, randomBytes: (n) => new Uint8Array(n) }} privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}>
        <ProgressScreen onExit={() => undefined} />
      </AppProviders>,
    );
    fireEvent.changeText(screen.getByTestId('progress-weight-input'), '132');
    fireEvent.press(screen.getByTestId('progress-weight-save'));
    expect(d.progress.getState().bodyMetrics.at(-1)!.data.value).toBeCloseTo(59.87, 2);
    fireEvent.changeText(screen.getByTestId('progress-measurement-input'), '30');
    fireEvent.press(screen.getByTestId('progress-measurement-save'));
    expect(d.progress.getState().measurements.at(-1)!.data.valueCm).toBeCloseTo(76.2, 1);
    expect(screen.getByTestId('progress-body-trend').props.children).toMatch(/lb$/);
  });

  it.each(['en', 'fr'] as const)('every control is labelled, and the visible copy has no judgemental body terms and no guilt (%s)', (locale) => {
    renderDashboard(d, locale);
    const unlabelled: string[] = [];
    const walk = (node: typeof screen.root) => {
      const p = node.props as Record<string, unknown>;
      const control = ['button', 'switch', 'togglebutton'].includes(String(p.accessibilityRole)) || typeof p.onChangeText === 'function';
      if (typeof node.type === 'string' && control && (typeof p.accessibilityLabel !== 'string' || p.accessibilityLabel.trim() === '')) unlabelled.push(String(p.testID));
      for (const child of node.children) if (typeof child !== 'string') walk(child);
    };
    walk(screen.root);
    expect(unlabelled).toEqual([]);
    const strings = visibleStrings();
    expect(strings.length).toBeGreaterThan(30);
    expect(strings.flatMap((s) => judgementalBodyTerms(s, locale))).toEqual([]);
    expect(strings.flatMap((s) => guiltPhrases(s, locale))).toEqual([]);
  });

  it('analytics carry no personal or health data: only the screen name', () => {
    sent.length = 0;
    renderDashboard(d);
    act(() => jest.advanceTimersByTime(60_000));
    for (const e of sent) expect(findPersonalData(e)).toEqual([]);
    expect(sent.every((e) => e.event === 'screen_viewed' || e.event === 'consent_changed')).toBe(true);
  });

  it('without the health consent nothing of the health data is shown', () => {
    d.consents.getState().decide('health', false, 'en');
    renderDashboard(d);
    expect(screen.getByTestId('progress-no-consent')).toBeTruthy();
    expect(screen.queryByTestId('progress-strength')).toBeNull();
    expect(screen.queryByTestId('progress-body')).toBeNull();
  });
});

describe('goal condition 2 (device): sustained loss > 1 % BW/week for 3 weeks → supportive notice and hand-off to M10', () => {
  it('shows the notice once, hands the event to the M10 inbox and logs the S4 hand-off (no body value in it)', () => {
    const d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 12, lossPercentPerWeek: -1.6, lossWeeks: 5 });
    renderDashboard(d);
    const notice = screen.getByTestId('progress-guardrail');
    expect(notice).toBeTruthy();
    expect(screen.getByText(tr('en').t('progress.guardrail.body'))).toBeTruthy();
    const pending = d.nutrition.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'bodyweight.sustained_loss', detectedOn: TODAY, thresholdPercentPerWeek: 1 });
    expect(pending[0]!.weeks).toHaveLength(3);
    const s4 = d.legal.getState().events.filter((e) => e.type === 'safety.event' && (e.payload as { invariant: string }).invariant === 'S4');
    expect(s4.map((e) => e.payload)).toEqual([{ invariant: 'S4', reasonCode: 'progress.guardrail.sustained_loss', action: 'handed_off', engineVersion: ENGINE_VERSION }]);
    fireEvent.press(screen.getByTestId('progress-guardrail-ok'));
    expect(screen.queryByTestId('progress-guardrail')).toBeNull();
    // Opened again the same day: not repeated, not handed off twice.
    screen.unmount();
    renderDashboard(d);
    expect(screen.queryByTestId('progress-guardrail')).toBeNull();
    expect(d.nutrition.pending()).toHaveLength(1);
    // M10 consumes its inbox.
    expect(d.nutrition.consume()).toHaveLength(1);
    expect(d.nutrition.pending()).toEqual([]);
  });

  it('with body weight hidden the supportive notice still appears (it shows no number)', () => {
    const d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 12, lossPercentPerWeek: -1.6, lossWeeks: 5 });
    d.progress.getState().setShowBodyWeight(false);
    renderDashboard(d, 'fr');
    expect(screen.getByTestId('progress-guardrail')).toBeTruthy();
    expect(screen.getByText(tr('fr').t('progress.guardrail.body'))).toBeTruthy();
    expect(screen.getByTestId('progress-body-hidden')).toBeTruthy();
  });

  it('a slower loss (0.8 %/week) shows no notice and hands nothing off', () => {
    const d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 12, lossPercentPerWeek: -0.8, lossWeeks: 5 });
    renderDashboard(d);
    expect(screen.queryByTestId('progress-guardrail')).toBeNull();
    expect(d.nutrition.pending()).toEqual([]);
  });
});

describe('goal condition 7: forecasts always carry "estimate, not a guarantee" (FR and EN)', () => {
  const base = { estimate: true as const, points: 8, reasonCodes: ['progress.forecast.estimate_only'] };
  const forecasts: MilestoneForecast[] = [
    { ...base, milestoneId: 'm', status: 'forecast', earliest: '2026-11-02', latest: '2027-01-18', confidence: 'medium' },
    { ...base, milestoneId: 'm', status: 'achieved', earliest: null, latest: null, confidence: null },
    { ...base, milestoneId: 'm', status: 'insufficient_data', earliest: null, latest: null, confidence: null },
    { ...base, milestoneId: 'm', status: 'no_trend', earliest: null, latest: null, confidence: null },
    { ...base, milestoneId: 'm', status: 'beyond_horizon', earliest: null, latest: null, confidence: null },
  ];
  it.each([
    ['en', 'Estimate, not a guarantee', 'Possible window: 2 Nov 2026 to 18 Jan 2027'],
    ['fr', 'Estimation, pas une garantie', 'Période possible : du 2 nov. 2026 au 18 janv. 2027'],
  ] as const)('%s: the label is on every status, and a window is a range, never a single date', (locale, label, window) => {
    for (const forecast of forecasts) {
      const { unmount } = render(
        <I18nProvider initialLocale={locale}>
          <ThemeProvider>
            <ForecastView milestoneId="first_pull_up" forecast={forecast} />
          </ThemeProvider>
        </I18nProvider>,
      );
      expect(screen.getByTestId('progress-milestone-first_pull_up-label').props.children).toBe(label);
      if (forecast.status === 'forecast') expect(screen.getByTestId('progress-milestone-first_pull_up-window').props.children).toBe(window);
      else expect(screen.getByTestId('progress-milestone-first_pull_up-status')).toBeTruthy();
      unmount();
    }
  });

  it('on the dashboard, in French, the pull-up milestone carries the label', () => {
    const d = referenceDevice();
    seedReferenceData(d, { endDate: TODAY, weeks: 26 });
    renderDashboard(d, 'fr');
    expect(screen.getByTestId('progress-milestone-first_pull_up-label').props.children).toBe('Estimation, pas une garantie');
    expect(screen.getByText('Première traction stricte')).toBeTruthy();
  });
});

describe('photos entry', () => {
  it('opens the photos screen only with the photos consent', () => {
    const d = referenceDevice();
    const { onOpenPhotos } = renderDashboard(d);
    expect(screen.queryByTestId('progress-photos-open')).toBeNull();
    expect(screen.getByText(tr('en').t('progress.photos.needsConsent'))).toBeTruthy();
    act(() => void d.consents.getState().decide('photos', true, 'en'));
    fireEvent.press(screen.getByTestId('progress-photos-open'));
    expect(onOpenPhotos).toHaveBeenCalled();
  });
});
