import { useI18n } from '@fitadapt/i18n/react';
import { Button, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DocumentView } from '../../legal/DocumentView';
import { OnboardingScaffold, Paragraph } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { featureOn } from '../../privacy/consents';
import { useConsents } from '../../privacy/PrivacyProvider';
import { useLegal } from '../../profile/ProfileProvider';

/**
 * Step 5: explicit health-data consent (GDPR Art. 9, L2, L9) before any health
 * data is entered. Declining is always possible; the first workout then stays
 * locked (M20 decision, open question for counsel) and S1 treats screening as
 * not done.
 */
export function HealthConsentScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const render = useLegal((s) => s.render);
  const records = useConsents((s) => s.records);
  const decide = useConsents((s) => s.decide);
  const [declined, setDeclined] = useState(false);
  const granted = featureOn('health.screening', records);
  const document = render('consent.health', locale);
  return (
    <OnboardingScaffold step="health-consent" title={t('onboarding.healthConsent.title')}>
      <Paragraph muted>{t('onboarding.healthConsent.intro')}</Paragraph>
      <DocumentView document={document} testID="health-consent-text" />
      <View style={{ gap: theme.spacing.md }}>
        <Button
          label={granted ? t('onboarding.next') : t('onboarding.healthConsent.agree')}
          hint={granted ? undefined : t('onboarding.healthConsent.agreeHint')}
          onPress={() => {
            if (!granted) decide('health', true, locale);
            router.push(nextPath('health-consent'));
          }}
          testID="health-consent-agree"
        />
        {granted ? null : <Button label={t('onboarding.healthConsent.decline')} variant="secondary" onPress={() => setDeclined(true)} testID="health-consent-decline" />}
        {declined ? <Paragraph>{t('onboarding.healthConsent.declined')}</Paragraph> : null}
        {declined ? <Button label={t('firstWorkout.home')} variant="secondary" onPress={() => router.replace('/')} testID="health-consent-home" /> : null}
      </View>
    </OnboardingScaffold>
  );
}
