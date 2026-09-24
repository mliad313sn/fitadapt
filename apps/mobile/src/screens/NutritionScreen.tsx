import { minimumGoalWeightKg } from '@fitadapt/safety';
import { foodById, searchFoods, type FoodNames } from '@fitadapt/food-library';
import { createTranslator, foodLocalName, formatMass, inToCm, lbToKg, type MessageKey } from '@fitadapt/i18n';
import { NOTICES, noticesToShow, renderNotice } from '@fitadapt/legal';
import { useI18n } from '@fitadapt/i18n/react';
import { ACTIVITY_LEVELS, ESTIMATE_SEXES, HAND_PORTIONS, NUTRITION_GOALS, NUTRITION_HABITS, PLANNED_LOSS_OPTIONS, type HandPortion, type NutritionGoal, type NutritionTarget, type TrackingStyle } from '@fitadapt/shared';
import { Button, Card, ChoiceGroup, Chip, Input, useTheme } from '@fitadapt/ui';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { buildNutritionInput, logNutritionResult } from '../nutrition/nutrition-input';
import { useCurrentNutrition, useGuardrailInbox, useNutrition, useNutritionStore } from '../nutrition/NutritionProvider';
import { latestPlan, type NutritionSettings } from '../nutrition/nutrition-store';
import { featureOn } from '../privacy/consents';
import { useConsents } from '../privacy/PrivacyProvider';
import { useLegal, useProfile, useSafetyProfile } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { useProgressContext } from '../progress/ProgressProvider';

export interface NutritionScreenProps {
  onExit: () => void;
  onOpenPrivacy?: () => void;
}

const parseDecimal = (s: string) => {
  const n = Number(s.replace(',', '.').trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

/**
 * M10 nutrition screen, offline. Numbers (an energy target never below the
 * estimated BMR, a protein range, the planned pace) appear only when the
 * engine returns the numeric mode. When deficit features are off (under 18,
 * advised against calorie restriction, not screened, pregnancy or a recent
 * birth: S4) or the user chose habits, the screen shows supportive content
 * and habits, never a calorie number. Choosing a fat-loss pace shows the L3
 * nutrition-deficit notice first. Quick log with hand portions: two taps on
 * this screen (portion, then how many); food search runs on the bundled seed.
 */
export function NutritionScreen({ onExit, onOpenPrivacy }: NutritionScreenProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const records = useConsents((s) => s.records);
  const health = featureOn('nutrition.tracking', records);
  const settings = useNutrition((s) => s.settings);
  const [editing, setEditing] = useState(false);
  const { result } = useCurrentNutrition();
  const target = result?.target ?? null;
  const deficitOff = target !== null && target.mode === 'supportive' && !target.reasonCodes.includes('nutrition.supportive.chosen');
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="nutrition-screen">
        <Text accessibilityRole="header" style={{ ...text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('nutrition.title')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('nutrition.intro')}</Text>
        {!health ? (
          <Card testID="nutrition-no-consent">
            <Text style={text}>{t('nutrition.noConsent')}</Text>
            {onOpenPrivacy ? <Button label={t('nutrition.openPrivacy')} variant="secondary" onPress={onOpenPrivacy} testID="nutrition-open-privacy" /> : null}
          </Card>
        ) : (
          <>
            <GuardrailNotice />
            {target === null ? null : deficitOff ? (
              <SupportiveView target={target} />
            ) : !settings || editing ? (
              <SetupForm onDone={() => setEditing(false)} />
            ) : (
              <TodayView target={target} onEdit={() => setEditing(true)} />
            )}
          </>
        )}
        <Button label={t('nutrition.back')} variant="secondary" onPress={onExit} testID="nutrition-back" />
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
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm } as const,
  };
}

/** The M04 hand-off: a supportive notice; the deficit is already paused by the provider (S4). */
function GuardrailNotice() {
  const { t } = useI18n();
  const { text } = useStyles();
  const pending = useNutrition((s) => s.pendingNotices);
  const acknowledge = useNutrition((s) => s.acknowledgeGuardrailNotices);
  const inbox = useGuardrailInbox();
  if (pending.length === 0) return null;
  return (
    <Card title={t('nutrition.guardrail.title')} testID="nutrition-guardrail">
      <Text style={text}>{t('nutrition.guardrail.body')}</Text>
      <Button
        label={t('nutrition.guardrail.ok')}
        onPress={() => {
          inbox.consume();
          acknowledge();
        }}
        testID="nutrition-guardrail-ok"
      />
    </Card>
  );
}

/** Deficit features off (S4) or habits chosen: no number anywhere — habits and where to find help. */
function SupportiveView({ target }: { target: NutritionTarget }) {
  const { t } = useI18n();
  const { text, muted } = useStyles();
  return (
    <>
      <Card title={t('nutrition.supportive.title')} testID="nutrition-supportive">
        <Text style={text}>{t('nutrition.supportive.body')}</Text>
        {target.reasonCodes.map((code) => (
          <Text key={code} style={muted}>
            {t(`engine.reason.${code}` as MessageKey)}
          </Text>
        ))}
        <Text style={text} testID="nutrition-supportive-resources">
          {t('nutrition.supportive.resources')}
        </Text>
      </Card>
      <HabitsCard />
    </>
  );
}

function HabitsCard() {
  const { t } = useI18n();
  const { row } = useStyles();
  const checks = useNutrition((s) => s.habitChecks);
  const checkHabit = useNutrition((s) => s.checkHabit);
  const today = localIsoDate(clock.now());
  const done = (habit: string) => [...checks].reverse().find((c) => c.data.checkedOn === today && c.data.habit === habit)?.data.done ?? false;
  return (
    <Card title={t('nutrition.habits.title')} testID="nutrition-habits">
      <View style={row}>
        {NUTRITION_HABITS.map((habit) => (
          <Chip key={habit} label={t(`nutrition.habit.${habit}`)} hint={t('nutrition.habit.hint')} selected={done(habit)} onPress={() => checkHabit(habit, today, !done(habit))} testID={`habit-${habit}`} />
        ))}
      </View>
    </Card>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const { text, muted, row, theme } = useStyles();
  const store = useNutritionStore();
  const existing = useNutrition((s) => s.settings);
  const profile = useProfile((s) => s.profile);
  const safetyProfile = useSafetyProfile();
  const { progress } = useProgressContext();
  const impressions = useLegal((s) => s.notices);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const recordNotice = useLegal((s) => s.recordNotice);
  const logNutritionTarget = useLegal((s) => s.logNutritionTarget);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const [goal, setGoal] = useState<NutritionGoal>(existing?.goal ?? 'maintain');
  const [style, setStyle] = useState<TrackingStyle>(existing?.trackingStyle ?? 'numbers');
  const [activity, setActivity] = useState(existing?.activityLevel ?? 'light');
  const [sex, setSex] = useState(existing?.sexForEstimate ?? 'unspecified');
  const [pace, setPace] = useState<number>(existing?.plannedLossPercentPerWeek ?? 0.5);
  const [goalWeight, setGoalWeight] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasWeight = progress.getState().bodyMetrics.some((m) => m.data.kind === 'weight') || profile?.biometrics.weightKg != null;
  const needsHeight = profile?.biometrics.heightCm == null && existing?.heightCm == null;
  const massUnit = t(unitSystem === 'metric' ? 'units.kg' : 'units.lb', { value: '' }).trim();
  const lengthUnit = t(unitSystem === 'metric' ? 'units.cm' : 'units.in', { value: '' }).trim();

  // L3: a deficit set-up (fat loss with numbers) shows the nutrition-deficit notice first.
  const deficitSetup = goal === 'fat_loss' && style === 'numbers';
  const pendingNotice = deficitSetup ? noticesToShow('nutrition.deficit_setup', impressions, NOTICES)[0] : undefined;
  useEffect(() => {
    if (pendingNotice && !impressions.some((i) => i.noticeId === pendingNotice.id && i.version === pendingNotice.version && i.kind === 'shown')) recordNotice(pendingNotice, 'shown', locale);
  }, [pendingNotice, impressions, locale, recordNotice]);

  const save = () => {
    const today = localIsoDate(clock.now());
    const toKg = (n: number) => (unitSystem === 'metric' ? n : Math.round(lbToKg(n) * 10) / 10);
    const heightCm = needsHeight ? parseDecimal(height) : null;
    const heightValue = heightCm === null ? null : unitSystem === 'metric' ? heightCm : Math.round(inToCm(heightCm) * 10) / 10;
    const weightValue = !hasWeight ? parseDecimal(weight) : null;
    const goalValue = goalWeight.trim() === '' ? null : parseDecimal(goalWeight);
    if ((needsHeight && (heightValue === null || heightValue < 100 || heightValue > 250)) || (!hasWeight && (weightValue === null || toKg(weightValue) < 25 || toKg(weightValue) > 350)) || (goalWeight.trim() !== '' && goalValue === null)) {
      setError(t('nutrition.setup.invalid'));
      return;
    }
    const effectiveHeight = profile?.biometrics.heightCm ?? existing?.heightCm ?? heightValue;
    const goalKg = goal === 'fat_loss' && goalValue !== null ? toKg(goalValue) : null;
    if (goalKg !== null && effectiveHeight != null && goalKg < minimumGoalWeightKg(effectiveHeight)) {
      setError(t('nutrition.setup.goalWeightTooLow', { weight: formatMass(minimumGoalWeightKg(effectiveHeight), unitSystem, i18n) }));
      return;
    }
    if (weightValue !== null) progress.getState().logBodyMetric('weight', toKg(weightValue), today);
    const next: NutritionSettings = {
      schemaVersion: 1,
      goal,
      trackingStyle: style,
      activityLevel: activity,
      sexForEstimate: sex,
      plannedLossPercentPerWeek: goal === 'fat_loss' ? pace : null,
      goalWeightKg: goalKg !== null ? Math.min(350, Math.max(25, goalKg)) : null,
      heightCm: existing?.heightCm ?? heightValue,
    };
    store.getState().saveSettings(next);
    if (!profile) return;
    const state = store.getState();
    const previous = latestPlan(state.plans)?.data ?? null;
    const input = buildNutritionInput({ settings: next, profile, safetyProfile, bodyMetrics: progress.getState().bodyMetrics, intakeLogs: state.intakeLogs, guardrailEvents: state.guardrailEvents, previous, today });
    const reason = state.plans.length > 0 ? 'settings_changed' : 'setup';
    logNutritionResult({ logNutritionTarget, logSafetyEvent }, state.recordPlan(input, reason), reason);
    setError(null);
    onDone();
  };

  return (
    <View style={{ gap: theme.spacing.md }} testID="nutrition-setup">
      <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
        {t('nutrition.setup.title')}
      </Text>
      <ChoiceGroup label={t('nutrition.setup.goal')} options={NUTRITION_GOALS.map((g) => ({ value: g, label: t(`nutrition.goal.${g}`) }))} value={goal} onChange={setGoal} testID="nutrition-goal" />
      <ChoiceGroup label={t('nutrition.setup.style')} options={(['numbers', 'habits'] as const).map((s) => ({ value: s, label: t(`nutrition.style.${s}`) }))} value={style} onChange={setStyle} testID="nutrition-style" />
      {pendingNotice ? (
        <Card title={renderNotice(pendingNotice, locale, jurisdiction).title} testID={`notice-${pendingNotice.id}`}>
          <Text style={muted}>{t('nutrition.setup.noticeFirst')}</Text>
          <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{renderNotice(pendingNotice, locale, jurisdiction).draftBanner}</Text>
          <Text style={text}>{renderNotice(pendingNotice, locale, jurisdiction).body}</Text>
          <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => recordNotice(pendingNotice, 'acknowledged', locale)} testID={`notice-${pendingNotice.id}-ack`} />
        </Card>
      ) : (
        <>
          {style === 'numbers' ? (
            <>
              <ChoiceGroup label={t('nutrition.setup.activity')} options={ACTIVITY_LEVELS.map((a) => ({ value: a, label: t(`nutrition.activity.${a}`) }))} value={activity} onChange={setActivity} testID="nutrition-activity" />
              <ChoiceGroup label={t('nutrition.setup.sex')} options={ESTIMATE_SEXES.map((s) => ({ value: s, label: t(`nutrition.sex.${s}`) }))} value={sex} onChange={setSex} testID="nutrition-sex" />
              {needsHeight ? <Input label={t('nutrition.setup.height', { unit: lengthUnit })} hint={t('nutrition.setup.heightHint')} value={height} onChangeText={setHeight} keyboardType="decimal-pad" testID="nutrition-height" /> : null}
              {!hasWeight ? <Input label={t('nutrition.setup.weight', { unit: massUnit })} hint={t('nutrition.setup.weightHint')} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" testID="nutrition-weight" /> : null}
            </>
          ) : null}
          {deficitSetup ? (
            <>
              <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('nutrition.setup.pace')}</Text>
              <View style={row} testID="nutrition-pace">
                {PLANNED_LOSS_OPTIONS.map((p) => (
                  <Chip key={p} label={t('nutrition.pace.option', { percent: i18n.formatNumber(p, { maximumFractionDigits: 2 }) })} hint={t('nutrition.pace.hint')} selected={pace === p} onPress={() => setPace(p)} testID={`nutrition-pace-${p}`} />
                ))}
              </View>
              <Text style={muted}>{t('nutrition.pace.hint')}</Text>
              <Input label={t('nutrition.setup.goalWeight', { unit: massUnit })} hint={t('nutrition.setup.goalWeightHint')} value={goalWeight} onChangeText={setGoalWeight} keyboardType="decimal-pad" testID="nutrition-goal-weight" />
            </>
          ) : null}
          {error ? (
            <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.body }} testID="nutrition-setup-error">
              {error}
            </Text>
          ) : null}
          <Button label={t('nutrition.setup.save')} onPress={save} testID="nutrition-setup-save" />
        </>
      )}
    </View>
  );
}

function TodayView({ target, onEdit }: { target: NutritionTarget; onEdit: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { text, muted, theme } = useStyles();
  const logs = useNutrition((s) => s.intakeLogs);
  const today = localIsoDate(clock.now());
  const totals = useMemo(() => {
    const corrected = new Set(logs.map((l) => l.data.correctionOf).filter(Boolean));
    return logs.filter((l) => !corrected.has(l.id) && !l.data.removed && l.data.loggedOn === today).reduce((a, l) => ({ kcal: a.kcal + l.data.estimate.energyKcal, protein: a.protein + l.data.estimate.proteinG, n: a.n + 1 }), { kcal: 0, protein: 0, n: 0 });
  }, [logs, today]);
  const n = (v: number) => i18n.formatNumber(v, { maximumFractionDigits: 0 });

  if (target.mode === 'supportive') {
    return (
      <>
        <SupportiveView target={target} />
        <Button label={t('nutrition.setup.edit')} variant="secondary" onPress={onEdit} testID="nutrition-edit" />
      </>
    );
  }
  if (target.mode === 'needs_measurements' || !target.energy || !target.protein) {
    return (
      <Card title={t('nutrition.needsMeasurements.title')} testID="nutrition-needs-measurements">
        {target.reasonCodes.map((code) => (
          <Text key={code} style={text}>
            {t(`engine.reason.${code}` as MessageKey)}
          </Text>
        ))}
        <Button label={t('nutrition.setup.edit')} onPress={onEdit} testID="nutrition-edit" />
      </Card>
    );
  }
  return (
    <>
      <Card title={t('nutrition.today.title')} testID="nutrition-target">
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="nutrition-target-energy">
          {t('nutrition.target.energy', { kcal: n(target.energy.targetKcal) })}
        </Text>
        <Text style={text} testID="nutrition-target-protein">
          {t('nutrition.target.protein', { min: n(target.protein.minG), max: n(target.protein.maxG) })}
        </Text>
        {target.plannedLossPercentPerWeek > 0 ? (
          <Text style={text} testID="nutrition-target-pace">
            {t('nutrition.target.pace', { percent: i18n.formatNumber(target.plannedLossPercentPerWeek, { maximumFractionDigits: 2 }) })}
          </Text>
        ) : null}
        <Text style={muted}>{t('nutrition.target.estimate')}</Text>
        <Text style={muted}>{t('nutrition.target.floor')}</Text>
        <Text style={muted}>{t('nutrition.target.updated')}</Text>
        <Text style={{ ...muted, fontWeight: theme.fontWeight.bold }}>{t('nutrition.target.why')}</Text>
        {target.reasonCodes.map((code) => (
          <Text key={code} style={muted} testID={`nutrition-reason-${code}`}>
            {t(`engine.reason.${code}` as MessageKey)}
          </Text>
        ))}
        <Text accessibilityLiveRegion="polite" style={text} testID="nutrition-logged-today">
          {totals.n === 0 ? t('nutrition.today.nothing') : t('nutrition.today.logged', { kcal: n(totals.kcal), protein: n(totals.protein) })}
        </Text>
      </Card>
      <QuickLog />
      <FoodSearch />
      <HabitsCard />
      <Button label={t('nutrition.setup.edit')} variant="secondary" onPress={onEdit} testID="nutrition-edit" />
    </>
  );
}

/** Hand-portion quick log: tap a portion, then how many (the second tap logs). */
function QuickLog() {
  const { t } = useI18n();
  const { muted, row, text } = useStyles();
  const logIntake = useNutrition((s) => s.logIntake);
  const [open, setOpen] = useState<HandPortion | null>(null);
  const [logged, setLogged] = useState(false);
  return (
    <Card title={t('nutrition.quick.title')} testID="nutrition-quick">
      <Text style={muted}>{t('nutrition.quick.hint')}</Text>
      <View style={row}>
        {HAND_PORTIONS.map((p) => (
          <Chip
            key={p}
            label={t(`nutrition.hand.${p}`)}
            hint={t('nutrition.hand.hint')}
            selected={open === p}
            onPress={() => {
              setOpen(open === p ? null : p);
              setLogged(false);
            }}
            testID={`quick-${p}`}
          />
        ))}
      </View>
      {open ? (
        <View style={row} testID="quick-counts">
          {[1, 2, 3].map((count) => (
            <Button
              key={count}
              label={t('nutrition.quick.count', { count })}
              hint={t('nutrition.quick.countHint')}
              onPress={() => {
                logIntake({ kind: 'hand_portion', portion: open, count }, localIsoDate(clock.now()));
                setOpen(null);
                setLogged(true);
              }}
              testID={`quick-count-${count}`}
            />
          ))}
          <Button label={t('nutrition.quick.cancel')} variant="secondary" onPress={() => setOpen(null)} testID="quick-cancel" />
        </View>
      ) : null}
      {logged ? (
        <Text accessibilityLiveRegion="polite" style={text} testID="quick-logged">
          {t('nutrition.quick.logged')}
        </Text>
      ) : null}
    </Card>
  );
}

/** Food search on the bundled seed (offline): name in either language or the local name; one tap on a portion logs it. */
function FoodSearch() {
  const { t, locale } = useI18n();
  const { muted, row } = useStyles();
  const logIntake = useNutrition((s) => s.logIntake);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [names, other] = useMemo(() => {
    const make = (tr: (key: MessageKey) => string): FoodNames => ({ name: (f) => tr(`food.${f.id}.name` as MessageKey), local: (f) => foodLocalName(f.id) });
    const otherLocale = createTranslator(locale === 'fr' ? 'en' : 'fr');
    return [make((k) => t(k)), make((k) => otherLocale.t(k))];
  }, [t, locale]);
  const results = useMemo(() => (query.trim().length < 2 ? [] : searchFoods({ text: query, limit: 12 }, names, other)), [query, names, other]);
  const food = selected ? foodById(selected) : undefined;
  const label = (id: string) => {
    const local = foodLocalName(id);
    const name = t(`food.${id}.name` as MessageKey);
    return local && local !== name ? t('nutrition.search.withLocal', { name, local }) : name;
  };
  return (
    <Card title={t('nutrition.search.title')} testID="nutrition-search-card">
      <Input label={t('nutrition.search.label')} hint={t('nutrition.search.placeholder')} value={query} onChangeText={(v) => { setQuery(v); setSelected(null); }} testID="nutrition-search" />
      <Text style={muted}>{t('nutrition.search.estimateNote')}</Text>
      {query.trim().length >= 2 && results.length === 0 ? <Text style={muted} testID="nutrition-search-none">{t('nutrition.search.none')}</Text> : null}
      {food ? (
        <View style={row} testID={`food-${food.id}-portions`}>
          {food.portions.map((p) => (
            <Button
              key={p.id}
              label={t('nutrition.search.portion', { portion: t(`nutrition.portion.${p.id}`), grams: p.grams })}
              hint={t('nutrition.search.portionHint')}
              onPress={() => {
                logIntake({ kind: 'food', foodId: food.id, portionId: p.id, count: 1 }, localIsoDate(clock.now()));
                setSelected(null);
                setQuery('');
              }}
              testID={`food-${food.id}-portion-${p.id}`}
            />
          ))}
          <Button label={t('nutrition.search.close')} variant="secondary" onPress={() => setSelected(null)} testID="food-close" />
        </View>
      ) : (
        results.map((f) => <Button key={f.id} label={label(f.id)} variant="secondary" onPress={() => setSelected(f.id)} testID={`food-${f.id}`} />)
      )}
    </Card>
  );
}
