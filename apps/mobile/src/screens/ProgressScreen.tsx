import { ENGINE_VERSION, guardrailDue } from '@fitadapt/engine';
import { formatLength, formatMass, lbToKg, inToCm, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { MEASUREMENT_SITES, PROGRAM_MUSCLE_GROUPS, type GuardrailEvent, type MeasurementSite, type MilestoneForecast } from '@fitadapt/shared';
import { BarChart, Button, Card, Chip, Input, LineChart, Toggle, useTheme } from '@fitadapt/ui';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AerobicLedgerCard } from '../cardio/CardioCards';
import { clock } from '../clock';
import { reportError } from '../observability';
import { useConsents, useFeature, usePrivacy } from '../privacy/PrivacyProvider';
import { featureOn } from '../privacy/consents';
import { useLegal, useProfile, useProgram, useReadinessChecks, useReflows, useSessionHistory } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { buildDashboard, type DashboardModel, type StrengthRow } from '../progress/dashboard';
import { buildExport, parseExport, toCsv, toJson, ExportFormatError, type ExportPhoto } from '../progress/export';
import { formatIsoDate } from '../progress/format';
import { importBundle } from '../progress/import';
import { useProgress, useProgressContext } from '../progress/ProgressProvider';
import { useSync } from '../sync/SyncProvider';

export interface ProgressScreenProps {
  onExit: () => void;
  onOpenPhotos?: () => void;
  onOpenPrivacy?: () => void;
}

const dateOf = (iso: string) => localIsoDate(new Date(iso));

/**
 * M04 progress dashboard: sessions and streaks, strength, weekly hard sets,
 * milestones (always labelled as estimates), body trends (optional, can be
 * hidden), aerobic minutes, progress photos and the export — all computed
 * on the device from the stored records, offline. The engine's pure
 * analytics do the work; nothing here changes a prescription.
 */
export function ProgressScreen({ onExit, onOpenPhotos, onOpenPrivacy }: ProgressScreenProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const records = useConsents((s) => s.records);
  const health = featureOn('health.screening', records);
  const history = useSessionHistory();
  const profile = useProfile((s) => s.profile);
  const executionLogs = useProfile((s) => s.executionLogs);
  const readinessChecks = useReadinessChecks();
  const program = useProgram();
  const reflows = useReflows();
  const bodyMetrics = useProgress((s) => s.bodyMetrics);
  const measurements = useProgress((s) => s.measurements);
  const today = localIsoDate(clock.now());
  const model = useMemo(
    () =>
      buildDashboard({
        history,
        bodyMetrics: health ? bodyMetrics : [],
        measurements: health ? measurements : [],
        program,
        reflows,
        executionLogs: health ? executionLogs.map((e) => e.data) : [],
        readinessChecks: health ? readinessChecks : [],
        experience: profile?.experience ?? 'beginner',
        today,
        dateOf,
      }),
    [history, bodyMetrics, measurements, program, reflows, executionLogs, readinessChecks, profile?.experience, today, health],
  );
  const { analytics } = usePrivacy();
  useEffect(() => {
    analytics.track('screen_viewed', { screen: 'progress' });
  }, [analytics]);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="progress-screen">
        <Text accessibilityRole="header" style={{ ...text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('progress.title')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('progress.intro')}</Text>
        {!health ? (
          <Card testID="progress-no-consent">
            <Text style={text}>{t('progress.noConsent')}</Text>
            {onOpenPrivacy ? <Button label={t('progress.openPrivacy')} variant="secondary" onPress={onOpenPrivacy} testID="progress-open-privacy" /> : null}
          </Card>
        ) : (
          <>
            <GuardrailNotice event={model.guardrail} />
            <AdherenceCard model={model} hasProgram={program !== null} />
            <StrengthCard rows={model.strength} />
            <VolumeCard model={model} />
            <MilestonesCard model={model} />
            <BodyCard model={model} />
            <MeasurementsCard model={model} />
            <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
              {t('progress.cardio.title')}
            </Text>
            <AerobicLedgerCard ledger={model.ledger} />
          </>
        )}
        <PhotosEntry onOpenPhotos={onOpenPhotos} />
        <ExportCard />
        <Button label={t('progress.back')} variant="secondary" onPress={onExit} testID="progress-back" />
      </ScrollView>
    </SafeAreaView>
  );
}

function useStyles() {
  const theme = useTheme();
  return {
    theme,
    text: { color: theme.colors.text, fontSize: theme.fontSize.body } as const,
    muted: { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const,
  };
}

/** Sustained loss > 1 %/week for 3 weeks: a supportive notice, and the event goes to the nutrition guardrails (M10). */
function GuardrailNotice({ event }: { event: GuardrailEvent | null }) {
  const { t } = useI18n();
  const { text, muted } = useStyles();
  const handedOffOn = useProgress((s) => s.guardrailHandedOffOn);
  const handOff = useProgress((s) => s.handOffGuardrail);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const [shown, setShown] = useState<GuardrailEvent | null>(null);
  useEffect(() => {
    if (!event || !guardrailDue(event, handedOffOn)) return;
    handOff(event);
    // L11: the hand-off to the S4 nutrition guardrails goes to the device defensibility buffer (no body value in it).
    logSafetyEvent({ invariant: 'S4', reasonCode: 'progress.guardrail.sustained_loss', action: 'handed_off', engineVersion: ENGINE_VERSION });
    setShown(event);
  }, [event, handedOffOn, handOff, logSafetyEvent]);
  if (!shown) return null;
  return (
    <Card title={t('progress.guardrail.title')} testID="progress-guardrail">
      <Text style={text}>{t('progress.guardrail.body')}</Text>
      <Text style={muted}>{t('progress.guardrail.handoff')}</Text>
      <Button label={t('progress.guardrail.ok')} onPress={() => setShown(null)} testID="progress-guardrail-ok" />
    </Card>
  );
}

function AdherenceCard({ model, hasProgram }: { model: DashboardModel; hasProgram: boolean }) {
  const { t } = useI18n();
  const { text, muted } = useStyles();
  const a = model.adherence;
  return (
    <Card title={t('progress.adherence.title')} testID="progress-adherence">
      {model.sessionsTrained === 0 ? <Text style={text}>{t('progress.empty')}</Text> : null}
      {hasProgram && a ? (
        <>
          <Text style={text} testID="progress-adherence-planned">
            {t('progress.adherence.planned', { completed: a.completed, planned: a.planned })}
          </Text>
          <Text style={text} testID="progress-streak">
            {t('progress.adherence.streak', { days: a.currentStreakDays })}
          </Text>
          <Text style={muted}>{t('progress.adherence.longest', { days: a.longestStreakDays })}</Text>
          {a.extra > 0 ? <Text style={muted}>{t('progress.adherence.extra', { count: a.extra })}</Text> : null}
        </>
      ) : (
        <Text style={muted}>{t('progress.adherence.noPlan')}</Text>
      )}
    </Card>
  );
}

function StrengthCard({ rows }: { rows: readonly StrengthRow[] }) {
  const { t } = useI18n();
  const { muted } = useStyles();
  return (
    <Card title={t('progress.strength.title')} testID="progress-strength">
      {rows.length === 0 ? <Text style={muted}>{t('progress.strength.none')}</Text> : null}
      {rows.map((row) => (
        <StrengthRowView key={row.exerciseId} row={row} />
      ))}
      {rows.some((r) => r.latest.e1rmKg !== null) ? <Text style={muted}>{t('progress.strength.estimateNote')}</Text> : null}
    </Card>
  );
}

function StrengthRowView({ row }: { row: StrengthRow }) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const { theme, text, muted } = useStyles();
  const [open, setOpen] = useState(false);
  const name = t(`exercise.${row.exerciseId}.name` as MessageKey);
  const mass = (kg: number) => formatMass(kg, unitSystem, i18n);
  const best = row.latest.bestSet;
  const bestText = !best
    ? null
    : best.loadKg !== null && best.reps !== null
      ? t('progress.strength.bestSetLoad', { reps: best.reps, load: mass(best.loadKg) })
      : best.reps !== null
        ? t('progress.strength.bestSetReps', { reps: best.reps })
        : t('progress.strength.bestSetHold', { seconds: best.seconds ?? 0 });
  const loaded = row.points.some((p) => p.e1rmKg !== null);
  const value = (p: StrengthRow['points'][number]) => (loaded ? (p.e1rmKg ?? 0) : (p.bestSet?.reps ?? p.bestSet?.seconds ?? 0));
  const display = (p: StrengthRow['points'][number]) => (loaded ? (p.e1rmKg !== null ? mass(p.e1rmKg) : '—') : String(value(p)));
  const first = row.points[0]!;
  return (
    <View style={{ gap: theme.spacing.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing.sm }} testID={`progress-exercise-${row.exerciseId}`}>
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{name}</Text>
      {row.latest.e1rmKg !== null ? <Text style={text}>{t('progress.strength.e1rm', { value: mass(row.latest.e1rmKg) })}</Text> : null}
      {bestText ? <Text style={text}>{bestText}</Text> : null}
      {row.latest.volumeLoadKg > 0 ? <Text style={muted}>{t('progress.strength.volume', { value: mass(row.latest.volumeLoadKg) })}</Text> : null}
      {row.variant ? <Text style={muted}>{t('progress.strength.variant', { rung: row.variant.rung, steps: row.variant.steps })}</Text> : null}
      <Text style={muted}>{t('progress.strength.sessions', { count: row.sessions, date: formatIsoDate(row.lastDate, locale) })}</Text>
      <Button
        label={open ? t('progress.strength.close', { name }) : t('progress.strength.open', { name })}
        hint={t('progress.strength.openHint')}
        variant="secondary"
        onPress={() => setOpen((o) => !o)}
        testID={`progress-exercise-${row.exerciseId}-open`}
      />
      {open ? (
        <LineChart
          title={loaded ? t('progress.strength.chart', { name }) : t('progress.strength.chartReps', { name })}
          summary={t('progress.strength.chartSummary', { count: row.points.length, from: formatIsoDate(first.date, locale), to: formatIsoDate(row.latest.date, locale), first: display(first), last: display(row.latest) })}
          points={row.points.map((p) => ({ label: formatIsoDate(p.date, locale), value: value(p), displayValue: display(p) }))}
          legend={[t('progress.strength.legend')]}
          table={{ show: t('progress.table.show'), hide: t('progress.table.hide') }}
          testID={`progress-exercise-${row.exerciseId}-chart`}
        />
      ) : null}
    </View>
  );
}

function VolumeCard({ model }: { model: DashboardModel }) {
  const { t } = useI18n();
  const { muted } = useStyles();
  const bars = PROGRAM_MUSCLE_GROUPS.map((muscle) => {
    const w = model.volume.find((v) => v.muscle === muscle)!;
    const sets = Math.round(w.hardSets * 10) / 10;
    return {
      label: t(`progress.muscle.${muscle}` as MessageKey),
      value: w.hardSets,
      displayValue: t('progress.volume.value', { sets }),
      rangeMin: w.rangeMin,
      rangeMax: w.rangeMax,
      rangeText: t('progress.volume.range', { min: w.rangeMin, max: w.rangeMax }),
      statusText: t(`progress.volume.${w.status}` as MessageKey),
    };
  });
  const summary = t('progress.volume.summary', { list: bars.map((b) => t('progress.volume.summaryItem', { muscle: b.label, sets: b.displayValue, status: b.statusText })).join('; ') });
  return (
    <Card testID="progress-volume">
      <BarChart title={t('progress.volume.title')} summary={summary} bars={bars} table={{ show: t('progress.table.show'), hide: t('progress.table.hide') }} testID="progress-volume-chart" />
      <Text style={muted}>{t('progress.volume.note')}</Text>
    </Card>
  );
}

/** Every forecast carries the "estimate, not a guarantee" label (L1), whatever its status. */
export function ForecastView({ milestoneId, forecast }: { milestoneId: string; forecast: MilestoneForecast }) {
  const { t, locale } = useI18n();
  const { theme, text, muted } = useStyles();
  return (
    <View style={{ gap: theme.spacing.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing.sm }} testID={`progress-milestone-${milestoneId}`}>
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t(`progress.milestone.${milestoneId}` as MessageKey)}</Text>
      <Text style={{ ...muted, fontWeight: theme.fontWeight.bold }} testID={`progress-milestone-${milestoneId}-label`}>
        {t('progress.forecast.label')}
      </Text>
      {forecast.status === 'forecast' ? (
        <>
          <Text style={text} testID={`progress-milestone-${milestoneId}-window`}>
            {t('progress.forecast.window', { earliest: formatIsoDate(forecast.earliest!, locale), latest: formatIsoDate(forecast.latest!, locale) })}
          </Text>
          <Text style={muted}>{t('progress.forecast.confidence', { level: t(`progress.forecast.confidence.${forecast.confidence!}` as MessageKey) })}</Text>
          <Text style={muted}>{t('progress.forecast.how')}</Text>
        </>
      ) : (
        <Text style={text} testID={`progress-milestone-${milestoneId}-status`}>
          {t(`progress.forecast.${forecast.status}` as MessageKey)}
        </Text>
      )}
    </View>
  );
}

function MilestonesCard({ model }: { model: DashboardModel }) {
  const { t } = useI18n();
  const { muted } = useStyles();
  return (
    <Card title={t('progress.milestones.title')} testID="progress-milestones">
      {model.milestones.length === 0 ? <Text style={muted}>{t('progress.milestones.none')}</Text> : null}
      {model.milestones.map((m) => (
        <ForecastView key={m.id} milestoneId={m.id} forecast={m.forecast} />
      ))}
    </Card>
  );
}

const parseDecimal = (s: string) => {
  const n = Number(s.replace(',', '.').trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

function BodyCard({ model }: { model: DashboardModel }) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const { text, muted } = useStyles();
  const show = useProgress((s) => s.showBodyWeight);
  const setShow = useProgress((s) => s.setShowBodyWeight);
  const log = useProgress((s) => s.logBodyMetric);
  const { refresh } = useSync();
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const [message, setMessage] = useState<'progress.body.saved' | 'progress.body.invalid' | null>(null);
  const mass = (kg: number) => formatMass(kg, unitSystem, i18n);
  const today = localIsoDate(clock.now());
  const save = () => {
    const w = parseDecimal(weight);
    const f = parseDecimal(fat);
    try {
      if (w === null && f === null) throw new Error('empty');
      if (w !== null) log('weight', unitSystem === 'metric' ? w : Math.round(lbToKg(w) * 100) / 100, today);
      if (f !== null) log('body_fat', f, today);
      setWeight('');
      setFat('');
      setMessage('progress.body.saved');
      refresh();
    } catch {
      setMessage('progress.body.invalid');
    }
  };
  const b = model.body;
  return (
    <Card title={t('progress.body.title')} testID="progress-body">
      <Text style={muted}>{t('progress.body.optional')}</Text>
      <Toggle label={t('progress.body.show')} hint={t('progress.body.showHint')} value={show} onValueChange={setShow} testID="progress-body-show" />
      {!show ? (
        <Text style={text} testID="progress-body-hidden">
          {t('progress.body.hidden')}
        </Text>
      ) : (
        <>
          <Input label={t('progress.body.weight', { unit: unitSystem === 'metric' ? 'kg' : 'lb' })} hint={t('progress.body.weightHint')} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" testID="progress-weight-input" />
          <Input label={t('progress.body.bodyFat')} hint={t('progress.body.bodyFatHint')} value={fat} onChangeText={setFat} keyboardType="decimal-pad" testID="progress-bodyfat-input" />
          <Button label={t('progress.body.save')} onPress={save} testID="progress-weight-save" />
          {message ? (
            <Text accessibilityLiveRegion="polite" style={muted} testID="progress-body-message">
              {t(message)}
            </Text>
          ) : null}
          {b.weighIns === 0 ? <Text style={muted}>{t('progress.body.none')}</Text> : null}
          {b.latestTrend !== null ? (
            <Text style={text} testID="progress-body-trend">
              {t('progress.body.trend', { value: mass(b.latestTrend) })}
            </Text>
          ) : null}
          {b.weighIns > 0 ? (
            <Text style={text} testID="progress-body-rate">
              {b.rate ? t('progress.body.rate', { percent: i18n.formatNumber(b.rate.percentPerWeek, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }) }) : t('progress.body.rateUnknown')}
            </Text>
          ) : null}
          {b.points.length > 0 ? (
            <LineChart
              title={t('progress.body.chart')}
              summary={t('progress.body.chartSummary', { count: b.points.length, from: formatIsoDate(b.points[0]!.date, locale), to: formatIsoDate(b.points.at(-1)!.date, locale), trend: mass(b.latestTrend!) })}
              points={b.points.map((p) => ({ label: formatIsoDate(p.date, locale), value: p.value, displayValue: mass(p.value), secondary: p.trend, secondaryDisplay: t('progress.body.trendPoint', { value: mass(p.trend) }) }))}
              legend={[t('progress.body.legendLogged'), t('progress.body.legendTrend')]}
              table={{ show: t('progress.table.show'), hide: t('progress.table.hide') }}
              testID="progress-body-chart"
            />
          ) : null}
          {b.points.length > 0 ? <Text style={muted}>{t('progress.body.trendNote')}</Text> : null}
          {b.lastBodyFat !== null ? <Text style={muted}>{t('progress.body.lastBodyFat', { value: b.lastBodyFat })}</Text> : null}
        </>
      )}
    </Card>
  );
}

function MeasurementsCard({ model }: { model: DashboardModel }) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const { theme, text, muted } = useStyles();
  const log = useProgress((s) => s.logMeasurement);
  const { refresh } = useSync();
  const [site, setSite] = useState<MeasurementSite>('waist');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<'progress.body.saved' | 'progress.body.invalid' | null>(null);
  const save = () => {
    const n = parseDecimal(value);
    try {
      if (n === null) throw new Error('empty');
      log(site, unitSystem === 'metric' ? n : Math.round(inToCm(n) * 10) / 10, localIsoDate(clock.now()));
      setValue('');
      setMessage('progress.body.saved');
      refresh();
    } catch {
      setMessage('progress.body.invalid');
    }
  };
  return (
    <Card title={t('progress.measurements.title')} testID="progress-measurements">
      <Text style={muted}>{t('progress.measurements.site')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {MEASUREMENT_SITES.map((s) => (
          <Chip key={s} label={t(`progress.site.${s}` as MessageKey)} selected={site === s} onPress={() => setSite(s)} testID={`progress-site-${s}`} />
        ))}
      </View>
      <Input label={t('progress.measurements.value', { unit: unitSystem === 'metric' ? 'cm' : 'in' })} hint={t('progress.measurements.valueHint')} value={value} onChangeText={setValue} keyboardType="decimal-pad" testID="progress-measurement-input" />
      <Button label={t('progress.body.save')} onPress={save} testID="progress-measurement-save" />
      {message ? <Text style={muted}>{t(message)}</Text> : null}
      {model.measurements.length === 0 ? <Text style={muted}>{t('progress.measurements.none')}</Text> : null}
      {model.measurements.map((m) => (
        <Text key={m.site} style={text} testID={`progress-measurement-${m.site}`}>
          {t('progress.measurements.latest', { site: t(`progress.site.${m.site}` as MessageKey), value: formatLength(m.valueCm, unitSystem, i18n), date: formatIsoDate(m.date, locale) })}
        </Text>
      ))}
    </Card>
  );
}

function PhotosEntry({ onOpenPhotos }: { onOpenPhotos?: () => void }) {
  const { t } = useI18n();
  const { text, muted } = useStyles();
  const allowed = useFeature('photos.progress');
  if (!onOpenPhotos) return null;
  return (
    <Card title={t('progress.photos.title')} testID="progress-photos">
      <Text style={text}>{t('progress.photos.body')}</Text>
      {allowed ? <Button label={t('progress.photos.open')} variant="secondary" onPress={onOpenPhotos} testID="progress-photos-open" /> : <Text style={muted}>{t('progress.photos.needsConsent')}</Text>}
    </Card>
  );
}

/** Export of all training and body data (JSON or CSV) and the importer, on the device, offline. */
function ExportCard() {
  const { t } = useI18n();
  const { text, muted } = useStyles();
  const { io, vault } = useProgressContext();
  const { analytics } = usePrivacy();
  const { client: sync, refresh } = useSync();
  const profile = useProfile((s) => s);
  const progress = useProgress((s) => s);
  const photosAllowed = useFeature('photos.progress');
  const [withPhotos, setWithPhotos] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const bundle = () => {
    const photos: ExportPhoto[] = withPhotos && vault && photosAllowed ? vault.list().map((meta) => ({ meta, image: vault.image(meta.id) })) : [];
    return buildExport(
      {
        workout_sessions: profile.workouts,
        set_logs: profile.setLogs,
        execution_logs: profile.executionLogs,
        readiness_checks: profile.readinessChecks,
        assessments: profile.assessments,
        programs: profile.programs,
        program_reflows: profile.reflows,
        body_metrics: progress.bodyMetrics,
        measurements: progress.measurements,
      },
      { exportedAt: clock.now().toISOString(), engineVersion: ENGINE_VERSION },
      photos,
    );
  };

  const run = async (format: 'json' | 'csv') => {
    try {
      const b = bundle();
      const stamp = localIsoDate(clock.now());
      if (format === 'json') await io.shareFile(`training-export-${stamp}.json`, toJson(b), 'application/json');
      else await io.shareFile(`training-export-${stamp}.csv`, toCsv(b), 'text/csv');
      analytics.track('progress_export_requested', { format, withPhotos: format === 'json' && b.photos.length > 0 });
      setMessage(t('progress.export.done'));
    } catch (error) {
      reportError(error, { area: 'ui' });
      setMessage(t('progress.export.failed'));
    }
  };

  const runImport = async () => {
    try {
      const textIn = await io.pickTextFile();
      if (textIn === null) return;
      const count = importBundle(parseExport(textIn), sync, photosAllowed ? vault : null);
      profile.reload();
      progress.reload();
      refresh();
      setMessage(t('progress.import.done', { count }));
    } catch (error) {
      if (!(error instanceof ExportFormatError)) reportError(error, { area: 'ui' });
      setMessage(t('progress.import.failed'));
    }
  };

  return (
    <Card title={t('progress.export.title')} testID="progress-export">
      <Text style={text}>{t('progress.export.body')}</Text>
      {photosAllowed && vault ? <Toggle label={t('progress.export.photos')} value={withPhotos} onValueChange={setWithPhotos} testID="progress-export-photos" /> : null}
      <Button label={t('progress.export.json')} hint={t('progress.export.hint')} onPress={() => void run('json')} testID="progress-export-json" />
      <Button label={t('progress.export.csv')} hint={t('progress.export.hint')} variant="secondary" onPress={() => void run('csv')} testID="progress-export-csv" />
      <Button label={t('progress.import.button')} hint={t('progress.import.hint')} variant="secondary" onPress={() => void runImport()} testID="progress-import" />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={muted} testID="progress-export-message">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
