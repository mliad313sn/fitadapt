import { acceptanceState, type LegalDocumentId } from '@fitadapt/legal';
import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { clock } from '../../clock';
import { DocumentView } from '../../legal/DocumentView';
import { currentLegalRegistry } from '../../legal/registry';
import { OnboardingScaffold, Paragraph } from '../../onboarding/OnboardingScaffold';
import { FIRST_WORKOUT_PATH, nextPath } from '../../onboarding/steps';
import { useFirstWorkoutAccess, useLegal, useProfile } from '../../profile/ProfileProvider';

function useAcceptance(documentId: LegalDocumentId) {
  const acceptances = useLegal((s) => s.acceptances);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  return acceptanceState(acceptances, documentId, { jurisdiction, now: clock.now(), registry: currentLegalRegistry() });
}

/** One legal text: status, the full text on request, and "I accept" once it has been opened (informed acceptance, L2). */
function AcceptanceCard({ documentId }: { documentId: 'terms' | 'privacy' }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const render = useLegal((s) => s.render);
  const accept = useLegal((s) => s.accept);
  const state = useAcceptance(documentId);
  const [open, setOpen] = useState(false);
  const document = render(documentId, locale);
  const accepted = state.status === 'accepted';
  const status = accepted ? t('onboarding.terms.accepted', { version: state.acceptedVersion ?? state.versionInForce }) : state.status === 'needs_reacceptance' ? t('legal.status.needsReacceptance') : t('legal.status.needsAcceptance');
  return (
    <Card title={document.title} testID={`legal-${documentId}`}>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }} testID={`legal-${documentId}-status`}>
        {status}
      </Text>
      {accepted && state.updatedSinceAcceptance ? <Paragraph muted>{t('legal.status.changedMinor')}</Paragraph> : null}
      <Button label={open ? t('onboarding.terms.hide') : t('legal.action.readFull')} variant="secondary" onPress={() => setOpen(!open)} testID={`legal-${documentId}-read`} />
      {open ? <DocumentView document={document} showTitle={false} testID={`legal-${documentId}-text`} /> : null}
      {open && !accepted ? <Button label={t('legal.action.accept')} hint={t('legal.action.acceptHint')} onPress={() => accept(documentId, locale)} testID={`legal-${documentId}-accept`} /> : null}
    </Card>
  );
}

/** Step 9: Terms of Use and Privacy Policy (L2; drafts marked "requires counsel review"). Also used for re-acceptance. */
export function TermsScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const onboarded = useProfile((s) => s.profile?.onboardingCompletedAt != null);
  const terms = useAcceptance('terms');
  const privacy = useAcceptance('privacy');
  const risk = useAcceptance('exercise_risk');
  const [error, setError] = useState(false);
  const both = terms.status === 'accepted' && privacy.status === 'accepted';
  return (
    <OnboardingScaffold
      step="terms"
      title={t('onboarding.terms.title')}
      error={error && !both ? t('onboarding.terms.required') : null}
      onNext={() => {
        if (!both) return setError(true);
        if (onboarded && risk.status === 'accepted') router.replace('/');
        else router.push(nextPath('terms'));
      }}
    >
      <Paragraph muted>{t('onboarding.terms.intro')}</Paragraph>
      <View style={{ gap: theme.spacing.lg }}>
        <AcceptanceCard documentId="terms" />
        <AcceptanceCard documentId="privacy" />
      </View>
    </OnboardingScaffold>
  );
}

/** Step 10: the exercise-risk acknowledgment, on one screen, accepted before the first workout (L2). */
export function ExerciseRiskScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const render = useLegal((s) => s.render);
  const accept = useLegal((s) => s.accept);
  const complete = useProfile((s) => s.completeOnboarding);
  const state = useAcceptance('exercise_risk');
  const access = useFirstWorkoutAccess();
  const [done, setDone] = useState(false);
  const document = render('exercise_risk', locale);
  const accepted = state.status === 'accepted';

  // Navigate once the gate has re-evaluated with the new acceptance (the first-workout route is protected).
  useEffect(() => {
    if (done && access.allowed) router.push(FIRST_WORKOUT_PATH);
  }, [done, access.allowed, router]);

  return (
    <OnboardingScaffold
      step="exercise-risk"
      title={document.title}
      nextLabel={accepted ? t('onboarding.next') : t('onboarding.risk.accept')}
      error={done && !access.allowed ? t('legal.status.needsAcceptance') : null}
      onNext={() => {
        if (!accepted) accept('exercise_risk', locale);
        complete();
        setDone(true);
      }}
    >
      <DocumentView document={document} showTitle={false} testID="legal-exercise_risk-text" />
    </OnboardingScaffold>
  );
}
