import { useI18n } from '@fitadapt/i18n/react';
import type { CalendarDate } from '@fitadapt/safety';
import { Button, Input, useTheme } from '@fitadapt/ui';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localToday } from '../privacy/age-gate';
import { useAgeGate } from '../privacy/PrivacyProvider';

type ErrorKey = 'ageGate.error.not_a_date' | 'ageGate.error.in_future';

const toInt = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/**
 * S7 age gate, shown before anything else. Neutral: it asks for a date of
 * birth without revealing the threshold, and keeps only the outcome.
 */
export function AgeGateScreen({ today = localToday }: { today?: () => CalendarDate }) {
  const theme = useTheme();
  const { t } = useI18n();
  const status = useAgeGate((s) => s.status);
  const submit = useAgeGate((s) => s.submit);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<ErrorKey | null>(null);

  const heading = { color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold } as const;
  const body = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;

  if (status === 'blocked') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="age-gate-blocked">
          <Text accessibilityRole="header" style={heading}>
            {t('ageGate.blocked.title')}
          </Text>
          <Text style={body}>{t('ageGate.blocked.body')}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const onContinue = () => {
    const outcome = submit({ year: toInt(year), month: toInt(month), day: toInt(day) }, today());
    setError(outcome.status === 'invalid' ? (`ageGate.error.${outcome.reasonCode.replace('age_gate.', '')}` as ErrorKey) : null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="age-gate">
        <Text accessibilityRole="header" style={heading}>
          {t('ageGate.title')}
        </Text>
        <Text style={body}>{t('ageGate.body')}</Text>
        <Input label={t('ageGate.day')} hint={t('ageGate.dayHint')} value={day} onChangeText={setDay} keyboardType="number-pad" testID="age-gate-day" />
        <Input label={t('ageGate.month')} hint={t('ageGate.monthHint')} value={month} onChangeText={setMonth} keyboardType="number-pad" testID="age-gate-month" />
        <Input
          label={t('ageGate.year')}
          hint={t('ageGate.yearHint')}
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          error={error ? t(error) : undefined}
          testID="age-gate-year"
        />
        <Button label={t('ageGate.continue')} onPress={onContinue} testID="age-gate-continue" />
      </ScrollView>
    </SafeAreaView>
  );
}
