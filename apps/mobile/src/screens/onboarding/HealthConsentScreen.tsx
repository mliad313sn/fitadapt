import { useI18n } from '@fitadapt/i18n/react';
import { Button, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DocumentView } from '../../legal/DocumentView';
import { ResidenceChoice } from '../../legal/LegalChoices';
import { OnboardingScaffold, Paragraph } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { featureOn } from '../../privacy/consents';
import { useConsents } from '../../privacy/PrivacyProvider';
import { useLegal } from '../../profile/ProfileProvider';

/**
 * Step 5: explicit health-data consent (GDPR Art. 9, L2, L9) before any health
 * data is entered. Declining is always possible; the first workout then stays
 * locked and S1 treats screening as not done (fail closed). FIX-B (B pre-review
 * §1.5 item 4, GDPR Art. 7(4)): no screening-free mode exists, so the consent
 * text now says exactly that (training features locked, library available)
 * instead of promising "the most cautious training"; B1 to confirm the basis.
 */
export function HealthConsentScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const render = useLegal((s) => s.render);
  const records = useConsents((s) => s.records);
  const decide = useConsents((s) => s.decide);
  const [declined, setDeclined] = useState(false);
  const [needResidence, setNeedResidence] = useState(false);
  const granted = featureOn('health.screening', records);
  // FIX-B (B pre-review §1.5 item 1): the first legal text asks where the user lives (never inferred from the locale).
  const residenceConfirmed = useLegal((s) => s.jurisdictionSource === 'user_confirmed');
  const document = render('consent.health', locale);
  return (
    <OnboardingScaffold step="health-consent" title={t('onboarding.healthConsent.title')}>
      <ResidenceChoice />
      {needResidence && !residenceConfirmed ? <Paragraph testID="residence-required">{t('legal.residence.required')}</Paragraph> : null}
      <Paragraph muted>{t('onboarding.healthConsent.intro')}</Paragraph>
      <DocumentView document={document} testID="health-consent-text" />
      <View style={{ gap: theme.spacing.md }}>
        <Button
          label={granted ? t('onboarding.next') : t('onboarding.healthConsent.agree')}
          hint={granted ? undefined : t('onboarding.healthConsent.agreeHint')}
          onPress={() => {
            if (!residenceConfirmed) return setNeedResidence(true);
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
