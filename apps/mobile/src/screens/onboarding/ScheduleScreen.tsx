import { useI18n } from '@fitadapt/i18n/react';
import { DAYS_PER_WEEK_OPTIONS, SESSION_MINUTES_OPTIONS, TRAINING_TIMES } from '@fitadapt/shared';
import { Chip, ChoiceGroup, Toggle, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { OnboardingScaffold, Paragraph, SectionTitle } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { useProfile } from '../../profile/ProfileProvider';

/** Step 3: days per week, minutes per session, preferred times, reminders. */
export function ScheduleScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const schedule = useProfile((s) => s.draft.schedule);
  const update = useProfile((s) => s.updateDraft);
  const set = (patch: Partial<typeof schedule>) => update({ schedule: { ...schedule, ...patch } });
  return (
    <OnboardingScaffold step="schedule" title={t('onboarding.schedule.title')} onNext={() => router.push(nextPath('schedule'))}>
      <Paragraph muted>{t('onboarding.schedule.intro')}</Paragraph>
      <ChoiceGroup
        label={t('onboarding.schedule.days')}
        options={DAYS_PER_WEEK_OPTIONS.map((n) => ({ value: String(n), label: t('onboarding.schedule.dayOption', { count: n }) }))}
        value={String(schedule.daysPerWeek)}
        onChange={(v) => set({ daysPerWeek: Number(v) })}
        horizontal
        testID="schedule-days"
      />
      <ChoiceGroup
        label={t('onboarding.schedule.minutes')}
        options={SESSION_MINUTES_OPTIONS.map((n) => ({ value: String(n), label: t('onboarding.schedule.minuteOption', { count: n }) }))}
        value={String(schedule.minutesPerSession)}
        onChange={(v) => set({ minutesPerSession: Number(v) })}
        horizontal
        testID="schedule-minutes"
      />
      <SectionTitle>{t('onboarding.schedule.times')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {TRAINING_TIMES.map((time) => {
          const selected = schedule.preferredTimes.includes(time);
          return (
            <Chip
              key={time}
              label={t(`trainingTime.${time}`)}
              selected={selected}
              onPress={() => set({ preferredTimes: selected ? schedule.preferredTimes.filter((x) => x !== time) : TRAINING_TIMES.filter((x) => x === time || schedule.preferredTimes.includes(x)) })}
              testID={`time-${time}`}
            />
          );
        })}
      </View>
      <Toggle
        label={t('onboarding.schedule.reminders')}
        description={t('onboarding.schedule.remindersDescription')}
        value={schedule.remindersEnabled}
        onValueChange={(remindersEnabled) => set({ remindersEnabled })}
        testID="schedule-reminders"
      />
    </OnboardingScaffold>
  );
}
