import { NOTICES, noticesToShow, renderNotice } from '@fitadapt/legal';
import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, Chip, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibraryStore } from '../library/LibraryProvider';
import { useLegal, useProfile, useSafetyProfile } from '../profile/ProfileProvider';

/**
 * The first-workout screen (reachable only through the L2 gate, see
 * app/_layout.tsx). Shows the L3 first-workout notice, lets the user choose
 * today's place (M01: location chosen at session start) and shows the
 * exercise pool of that place under the SafetyProfile. Prescriptions come
 * from the engine (M02), which is not built yet.
 */
export function FirstWorkoutScreen() {
  const { t, locale } = useI18n();
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

  const active = equipment.find((p) => p.id === activeId) ?? equipment[0];
  const pending = noticesToShow('workout.start', impressions, NOTICES);
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
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('firstWorkout.builderPending')}</Text>
        <Button label={t('firstWorkout.home')} variant="secondary" onPress={() => router.replace('/')} testID="first-workout-home" />
      </ScrollView>
    </SafeAreaView>
  );
}
