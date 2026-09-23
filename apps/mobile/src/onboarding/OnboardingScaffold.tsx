import { useI18n } from '@fitadapt/i18n/react';
import { Button, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ONBOARDING_STEPS, stepNumber, type OnboardingStep } from './steps';

export interface OnboardingScaffoldProps {
  step: OnboardingStep;
  title: string;
  children?: ReactNode;
  /** Primary action; omitted on screens whose actions are in the body. */
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  /** Shown under the primary action (e.g. why it is disabled). */
  error?: string | null;
  testID?: string;
}

/** Shared frame of every onboarding step: progress, heading, body, Back and Continue. */
export function OnboardingScaffold({ step, title, children, onNext, nextLabel, nextDisabled = false, error, testID }: OnboardingScaffoldProps) {
  const theme = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID={testID ?? `onboarding-${step}`}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('onboarding.progress', { step: stepNumber(step), total: ONBOARDING_STEPS.length })}</Text>
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {title}
        </Text>
        {children}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>
            {error}
          </Text>
        ) : null}
        <View style={{ gap: theme.spacing.md }}>
          {onNext ? <Button label={nextLabel ?? t('onboarding.next')} onPress={onNext} disabled={nextDisabled} testID="onboarding-next" /> : null}
          {router.canGoBack() ? <Button label={t('onboarding.back')} variant="secondary" onPress={() => router.back()} testID="onboarding-back" /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Body text in the onboarding style. */
export function Paragraph({ children, muted = false }: { children?: ReactNode; muted?: boolean }) {
  const theme = useTheme();
  return <Text style={{ color: muted ? theme.colors.textMuted : theme.colors.text, fontSize: theme.fontSize.body }}>{children}</Text>;
}

/** A sub-heading inside a step. */
export function SectionTitle({ children }: { children?: ReactNode }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
      {children}
    </Text>
  );
}
