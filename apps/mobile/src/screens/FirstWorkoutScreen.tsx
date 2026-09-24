import { boundSessionInput, createEngineContext } from '@fitadapt/engine';
import { generateSession } from '@fitadapt/exercise-library';
import { formatMass, type MessageKey } from '@fitadapt/i18n';
import { NOTICES, noticesToShow, renderNotice } from '@fitadapt/legal';
import { trainingHoldFlags } from '@fitadapt/safety';
import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, Chip, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibraryStore } from '../library/LibraryProvider';
import { clock } from '../clock';
import { useCapacity, useIntensityLock, useJointFlags, useLegal, useProfile, useSafetyProfile, useSessionHistory } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { todayInput } from '../workout/today';

/**
 * The first-workout screen (reachable only through the L2 gate, see
 * app/_layout.tsx). Shows the L3 first-workout notice, lets the user choose
 * today's place (M01: location chosen at session start) and shows the
 * exercise pool of that place under the SafetyProfile. M07: once the user
 * has measured their starting point, the first session comes from the
 * engine's generateSession() over the CapacityModel (M02 extends it).
 */
export function FirstWorkoutScreen() {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const theme = useTheme();
  const router = useRouter();
  const library = useLibraryStore();
  const safety = useSafetyProfile();
  const equipment = useProfile((s) => s.equipment);
  const activeId = useProfile((s) => s.profile?.activeEquipmentProfileId ?? null);
  const setActive = useProfile((s) => s.setActiveEquipment);
  const impressions = useLegal((s) => s.notices);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const recordNotice = useLegal((s) => s.recordNotice);
  const capacity = useCapacity();
  const minutes = useProfile((s) => s.profile?.schedule.minutesPerSession ?? 30);

  const active = equipment.find((p) => p.id === activeId) ?? equipment[0];
  // FIX-B (CS-1): training on hold until clearance — no plan and no assessment offered (the engine refuses them too).
  const held = trainingHoldFlags(safety).length > 0;
  const pending = noticesToShow('workout.start', impressions, NOTICES);
  const profile = useProfile((s) => s.profile);
  const history = useSessionHistory();
  const jointFlags = useJointFlags();
  const intensityLock = useIntensityLock();
  const session = useMemo(() => {
    if (!capacity || !active || !profile) return null;
    const at = clock.now();
    // SAF-3: the same facts as the workout screen (S3 lock, S2 joint flags, S5 history, S7 date of birth and local
    // date), never a bare capacity model. No program: this screen previews the first session from the assessment.
    const facts = todayInput({ profile, safetyProfile: safety, places: equipment, program: null, reflows: [], capacity, history, jointFlags, intensityLock, today: localIsoDate(at), placeId: active.id, minutes });
    if (facts.status !== 'ready') return null;
    const now = at.getTime();
    return generateSession(boundSessionInput(facts.input, now), createEngineContext({ clock: { now: () => now }, seed: 1 }));
  }, [capacity, active, safety, minutes, profile, equipment, history, jointFlags, intensityLock]);
  const pool = useMemo(() => (library && active ? library.pool(locale, active.data.equipment, safety) : []), [library, active, locale, safety]);

  // L3: record that the notice was shown (once per version until acknowledged).
  useEffect(() => {
    for (const n of noticesToShow('workout.start', impressions, NOTICES)) {
      if (!impressions.some((i) => i.noticeId === n.id && i.version === n.version && i.kind === 'shown')) recordNotice(n, 'shown', locale);
    }
  }, [impressions, locale, recordNotice]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="first-workout">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('firstWorkout.title')}
        </Text>
        {pending.map((n) => {
          const rendered = renderNotice(n, locale, jurisdiction);
          return (
            <Card key={n.id} title={rendered.title} testID={`notice-${n.id}`}>
              <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{rendered.draftBanner}</Text>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{rendered.body}</Text>
              <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => recordNotice(n, 'acknowledged', locale)} testID={`notice-${n.id}-ack`} />
            </Card>
          );
        })}
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>{t('firstWorkout.where')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {equipment.map((p) => (
            <Chip key={p.id} label={t(`location.${p.data.location}`)} hint={t('firstWorkout.whereHint')} selected={p.id === active?.id} onPress={() => setActive(p.id)} testID={`first-workout-location-${p.data.location}`} />
          ))}
        </View>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text, fontSize: theme.fontSize.body }} testID="first-workout-pool">
          {t('firstWorkout.available', { count: pool.length })}
        </Text>
        {safety.lowIntensityLibraryOnly ? <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('firstWorkout.lowIntensity')}</Text> : null}
        {held ? (
          <Card testID="first-workout-hold">
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('firstWorkout.hold')}</Text>
          </Card>
        ) : session?.status === 'ok' ? (
          <View style={{ gap: theme.spacing.md }} testID="first-session-plan">
            <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
              {t('firstWorkout.plan.title')}
            </Text>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('firstWorkout.plan.minutes', { minutes: Math.round(session.plan.estimatedMinutes) })}</Text>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('firstWorkout.plan.reserve', { rir: session.plan.targetRir })}</Text>
            {session.plan.exercises.map((e) => {
              const set = e.sets[0]!;
              const dose = set.target.kind === 'hold' ? t('firstWorkout.plan.hold', { sets: e.sets.length, seconds: set.target.seconds }) : t('firstWorkout.plan.reps', { sets: e.sets.length, min: set.target.min, max: set.target.max });
              return (
                <Card key={e.slot} title={t(`exercise.${e.exerciseId}.name` as MessageKey)} testID={`first-session-${e.slot}`}>
                  <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>
                    {set.loadKg !== null ? `${dose} ${t('firstWorkout.plan.load', { load: formatMass(set.loadKg, unitSystem, i18n) })}` : dose}
                  </Text>
                  {set.reasonCodes.slice(0, 2).map((code) => (
                    <Text key={code} style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>
                      {t(`engine.reason.${code}` as MessageKey)}
                    </Text>
                  ))}
                </Card>
              );
            })}
          </View>
        ) : session?.status === 'unavailable' ? (
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }} testID="first-session-unavailable">
            {t(`engine.reason.${session.reasonCodes[session.reasonCodes.length - 1]!}` as MessageKey)}
          </Text>
        ) : (
          <Card testID="first-session-needs-assessment">
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('firstWorkout.plan.needsAssessment')}</Text>
            <Button label={t('firstWorkout.plan.assess')} onPress={() => router.push('/assessment')} testID="first-workout-assess" />
          </Card>
        )}
        {session?.status !== 'ok' ? <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('firstWorkout.builderPending')}</Text> : null}
        <Button label={t('firstWorkout.home')} variant="secondary" onPress={() => router.replace('/')} testID="first-workout-home" />
      </ScrollView>
    </SafeAreaView>
  );
}
