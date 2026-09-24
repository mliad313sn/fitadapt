import { useI18n } from '@fitadapt/i18n/react';
import { renderEmergencyGuidance } from '@fitadapt/legal';
import type { MessageKey } from '@fitadapt/i18n';
import { useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { OnboardingScaffold, Paragraph, SectionTitle } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { trainingHoldFlags } from '@fitadapt/safety';
import { useLegal, useProfile, useSafetyProfile } from '../../profile/ProfileProvider';

/**
 * Step 8: the screening outcome in plain words, with the reasons ("why").
 * No diagnosis: it says what the app will do, and when to talk to a professional.
 */
export function ResultScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const safety = useSafetyProfile();
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const onboarded = useProfile((s) => s.profile?.onboardingCompletedAt != null);
  const outcome = safety.screeningOutcome;
  // FIX-B (CS-1): a symptom flag before clearance holds all training; say so plainly, with the emergency guidance.
  const held = trainingHoldFlags(safety).length > 0;
  const emergency = renderEmergencyGuidance(locale, jurisdiction);
  return (
    <OnboardingScaffold
      step="result"
      title={held ? t('onboarding.result.hold.title') : t(`onboarding.result.title.${outcome}`)}
      onNext={() => (onboarded ? router.replace('/') : router.push(nextPath('result')))}
      testID={`onboarding-result-${outcome}`}
    >
      {held ? (
        <View style={{ gap: theme.spacing.sm }} testID="result-hold">
          <Paragraph>{t('onboarding.result.hold.body')}</Paragraph>
          <Paragraph>{t('onboarding.result.hold.urgent')}</Paragraph>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.bold }} testID="result-hold-emergency">
            {emergency}
          </Text>
        </View>
      ) : (
        <Paragraph>{t(`onboarding.result.body.${outcome}`)}</Paragraph>
      )}
      {safety.specialPopulation === 'pregnancy_postpartum' ? <Paragraph>{t('onboarding.result.pregnancy')}</Paragraph> : null}
      {safety.unresolvedFlags.length > 0 ? <Paragraph muted>{t('onboarding.result.clearanceLater')}</Paragraph> : null}
      <SectionTitle>{t('onboarding.result.why')}</SectionTitle>
      <View style={{ gap: theme.spacing.sm }} testID="safety-reasons">
        {safety.reasonCodes.map((code) => (
          <Text key={code} style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>
            {t(`reason.${code}` as MessageKey)}
          </Text>
        ))}
      </View>
    </OnboardingScaffold>
  );
}
