import { useI18n } from '@fitadapt/i18n/react';
import type { MessageKey } from '@fitadapt/i18n';
import { useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { OnboardingScaffold, Paragraph, SectionTitle } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { useProfile, useSafetyProfile } from '../../profile/ProfileProvider';

/**
 * Step 8: the screening outcome in plain words, with the reasons ("why").
 * No diagnosis: it says what the app will do, and when to talk to a professional.
 */
export function ResultScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const safety = useSafetyProfile();
  const onboarded = useProfile((s) => s.profile?.onboardingCompletedAt != null);
  const outcome = safety.screeningOutcome;
  return (
    <OnboardingScaffold
      step="result"
      title={t(`onboarding.result.title.${outcome}`)}
      onNext={() => (onboarded ? router.replace('/') : router.push(nextPath('result')))}
      testID={`onboarding-result-${outcome}`}
    >
      <Paragraph>{t(`onboarding.result.body.${outcome}`)}</Paragraph>
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
