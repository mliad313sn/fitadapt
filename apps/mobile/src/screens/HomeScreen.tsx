import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, useTheme } from '@fitadapt/ui';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../state/settings';
import { useSync } from '../sync/SyncProvider';
import { useCapacity, useFirstWorkoutAccess, useProfile, useReassessment, useRescreen, useSession, useSessionStatus } from '../profile/ProfileProvider';

export interface HomeScreenProps {
  onOpenPrivacy?: () => void;
  onOpenLibrary?: () => void;
  /** M01 entries (onboarding, first workout, legal review, re-screen, places, sign-in). */
  onStartOnboarding?: () => void;
  onOpenFirstWorkout?: () => void;
  /** M07: first assessment, end-of-mesocycle re-assessment prompt, re-test on demand. */
  onOpenAssessment?: () => void;
  /** M08: the week of the training plan. */
  onOpenCalendar?: () => void;
  /** M02: today's session (execution, offline). */
  onOpenWorkout?: () => void;
  /** M09: train together (Fair Pair), behind the same L2 gate. */
  onOpenPair?: () => void;
  /** M04: the progress dashboard (history, body trends, milestones, photos, export). */
  onOpenProgress?: () => void;
  /** M10: nutrition (targets or habits, quick log, food search), behind the same L2 gate. */
  onOpenNutrition?: () => void;
  /** M11: the AI coach, behind the same L2 gate (its own consent and AI disclosure inside). */
  onOpenCoach?: () => void;
  onReviewLegal?: (missing: readonly string[]) => void;
  onRescreen?: (reason: 'annual' | 'new_condition') => void;
  onOpenEquipment?: () => void;
  onSignIn?: () => void;
}

/** The entries are wired by the route (app/index.tsx); without their callbacks they are hidden. */
export function HomeScreen({ onOpenPrivacy, onOpenLibrary, onStartOnboarding, onOpenFirstWorkout, onOpenAssessment, onOpenCalendar, onOpenWorkout, onOpenPair, onOpenProgress, onOpenNutrition, onOpenCoach, onReviewLegal, onRescreen, onOpenEquipment, onSignIn }: HomeScreenProps = {}) {
  const theme = useTheme();
  const { t, locale, setLocale, unitSystem, setUnitSystem } = useI18n();
  const { pendingCount } = useSync();
  const gymMode = useSettings((s) => s.gymMode);
  const toggleGymMode = useSettings((s) => s.toggleGymMode);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="home-screen">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('home.title')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('home.subtitle')}</Text>

        {onStartOnboarding ? <M01Entries {...{ onStartOnboarding, onOpenFirstWorkout, onOpenAssessment, onOpenCalendar, onOpenWorkout, onOpenPair, onOpenNutrition, onOpenCoach, onReviewLegal, onRescreen, onOpenEquipment, onSignIn }} /> : null}

        <Card title={t('home.offlineCard.title')}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('home.offlineCard.body')}</Text>
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }} testID="sync-status">
            {t('home.syncStatus', { count: pendingCount })}
          </Text>
        </Card>

        <Button
          label={t('home.language.switch')}
          hint={t('home.language.switchHint')}
          onPress={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
          testID="switch-language"
        />
        <Button
          label={gymMode ? t('home.gymMode.disable') : t('home.gymMode.enable')}
          hint={t('home.gymMode.hint')}
          variant="secondary"
          onPress={toggleGymMode}
          testID="toggle-gym-mode"
        />
        <Button
          label={unitSystem === 'metric' ? t('home.units.metric') : t('home.units.imperial')}
          hint={t('home.units.switchHint')}
          variant="secondary"
          onPress={() => setUnitSystem(unitSystem === 'metric' ? 'imperial' : 'metric')}
          testID="toggle-units"
        />
        {onOpenProgress && onStartOnboarding ? <Button label={t('home.progress.open')} hint={t('home.progress.openHint')} variant="secondary" onPress={onOpenProgress} testID="open-progress" /> : null}
        {onOpenLibrary ? <Button label={t('library.open')} hint={t('library.openHint')} variant="secondary" onPress={onOpenLibrary} testID="open-library" /> : null}
        {onOpenPrivacy ? (
          <Button label={t('home.privacy.open')} hint={t('home.privacy.openHint')} variant="secondary" onPress={onOpenPrivacy} testID="open-privacy" />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** M01: what to do next — set up, train, review changed texts, update health answers, places, account. */
function M01Entries({ onStartOnboarding, onOpenFirstWorkout, onOpenAssessment, onOpenCalendar, onOpenWorkout, onOpenPair, onOpenNutrition, onOpenCoach, onReviewLegal, onRescreen, onOpenEquipment, onSignIn }: Omit<HomeScreenProps, 'onOpenPrivacy' | 'onOpenLibrary'>) {
  const theme = useTheme();
  const { t } = useI18n();
  const access = useFirstWorkoutAccess();
  const rescreen = useRescreen();
  const capacity = useCapacity();
  const reassessment = useReassessment();
  const started = useProfile((s) => s.draft.primaryGoal !== null);
  const reportNewCondition = useProfile((s) => s.reportNewCondition);
  const session = useSession();
  const status = useSessionStatus();
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <>
      {!access.onboardingComplete ? (
        <Button label={started ? t('home.onboarding.continue') : t('home.onboarding.start')} hint={t('home.onboarding.startHint')} onPress={onStartOnboarding} testID="start-onboarding" />
      ) : null}
      {access.allowed && onOpenFirstWorkout ? <Button label={t('home.firstWorkout.open')} hint={t('home.firstWorkout.openHint')} onPress={onOpenFirstWorkout} testID="open-first-workout" /> : null}
      {access.allowed && onOpenWorkout ? <Button label={t('home.workout.open')} hint={t('home.workout.openHint')} onPress={onOpenWorkout} testID="open-workout" /> : null}
      {access.allowed && onOpenPair ? <Button label={t('home.pair.open')} hint={t('home.pair.openHint')} onPress={onOpenPair} testID="open-pair" /> : null}
      {access.allowed && onOpenNutrition ? <Button label={t('nutrition.home.open')} hint={t('nutrition.home.openHint')} variant="secondary" onPress={onOpenNutrition} testID="open-nutrition" /> : null}
      {access.allowed && onOpenCoach ? <Button label={t('coach.open')} hint={t('coach.openHint')} variant="secondary" onPress={onOpenCoach} testID="open-coach" /> : null}
      {access.allowed && onOpenCalendar ? <Button label={t('home.calendar.open')} hint={t('home.calendar.openHint')} onPress={onOpenCalendar} testID="open-calendar" /> : null}
      {access.allowed && onOpenAssessment && capacity === null ? (
        <Button label={t('home.assessment.start')} hint={t('home.assessment.startHint')} variant="secondary" onPress={onOpenAssessment} testID="open-assessment" />
      ) : null}
      {access.allowed && onOpenAssessment && capacity !== null && reassessment.status === 'due' ? (
        <Card testID="reassessment-prompt">
          <Text style={text}>{t('home.assessment.due')}</Text>
          <Button label={t('home.assessment.retest')} onPress={onOpenAssessment} testID="reassess" />
        </Card>
      ) : null}
      {access.allowed && onOpenAssessment && capacity !== null && reassessment.status !== 'due' ? (
        <Button label={t('home.assessment.again')} variant="secondary" onPress={onOpenAssessment} testID="reassess-on-demand" />
      ) : null}
      {access.onboardingComplete && !access.allowed && access.missingLegal.length > 0 && onReviewLegal ? (
        <Card testID="legal-review">
          <Text style={text}>{t('legal.status.needsReacceptance')}</Text>
          <Button label={t('home.legal.review')} hint={t('home.legal.reviewHint')} onPress={() => onReviewLegal(access.missingLegal)} testID="review-legal" />
        </Card>
      ) : null}
      {access.onboardingComplete && rescreen.status === 'due' && onRescreen ? (
        <Card testID="rescreen-prompt">
          <Text style={text}>{rescreen.reason === 'annual' ? t('home.rescreen.annual') : t('home.rescreen.newCondition')}</Text>
          <Button label={t('home.rescreen.button')} onPress={() => onRescreen(rescreen.reason)} testID="rescreen" />
        </Card>
      ) : null}
      {access.onboardingComplete && rescreen.status !== 'due' ? (
        <Button label={t('home.newCondition.report')} hint={t('home.newCondition.reportHint')} variant="secondary" onPress={reportNewCondition} testID="report-new-condition" />
      ) : null}
      {access.onboardingComplete && onOpenEquipment ? <Button label={t('home.equipment.open')} hint={t('home.equipment.openHint')} variant="secondary" onPress={onOpenEquipment} testID="open-equipment" /> : null}
      {session && status === 'signed_in' ? (
        <Card testID="account-signed-in">
          <Text style={text}>{t('home.account.signedIn')}</Text>
          <Button label={t('home.account.signOut')} hint={t('home.account.signOutHint')} variant="secondary" onPress={() => void session.getState().signOut()} testID="sign-out" />
        </Card>
      ) : null}
      {session && status !== 'signed_in' && onSignIn ? <Button label={t('home.account.signIn')} hint={t('home.account.signInHint')} variant="secondary" onPress={onSignIn} testID="open-sign-in" /> : null}
    </>
  );
}
