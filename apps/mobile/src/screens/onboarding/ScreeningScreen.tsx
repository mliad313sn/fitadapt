import { useI18n } from '@fitadapt/i18n/react';
import { SCREENING_CONFIG, SCREENING_QUESTIONS, SCREENING_RULES, holdsUntilClearance } from '@fitadapt/safety';
import { SCREENING_REASONS, type ScreeningAnswer, type ScreeningRecord } from '@fitadapt/shared';
import { ChoiceGroup, Toggle } from '@fitadapt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { clock } from '../../clock';
import { OnboardingScaffold, Paragraph } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { localToday } from '../../privacy/age-gate';
import { useProfile } from '../../profile/ProfileProvider';

const MONTHS_PARAM: Partial<Record<(typeof SCREENING_QUESTIONS)[number], number>> = {
  chest_discomfort: SCREENING_CONFIG.symptomLookbackMonths.value,
  fainting_or_dizziness: SCREENING_CONFIG.symptomLookbackMonths.value,
  pregnancy_or_recent_birth: SCREENING_CONFIG.postpartumWindowMonths.value,
};

/**
 * Step 7: health screening (S1, S4, S7). Original questions, licence check
 * pending, awaiting seat A1 review. Every question needs an answer; "unsure"
 * means yes. Also used for the yearly re-screen and after a reported change.
 */
export function ScreeningScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const reason: ScreeningRecord['reason'] = (SCREENING_REASONS as readonly string[]).includes(params.reason ?? '') ? (params.reason as ScreeningRecord['reason']) : 'onboarding';
  const answers = useProfile((s) => s.draft.answers);
  const clearanceAttested = useProfile((s) => s.draft.clearanceAttested);
  const update = useProfile((s) => s.updateDraft);
  const save = useProfile((s) => s.saveScreening);
  const [error, setError] = useState(false);
  const yesNo = [
    { value: 'yes' as const, label: t('screening.yes') },
    { value: 'no' as const, label: t('screening.no') },
  ];
  const flagged = SCREENING_QUESTIONS.some((q) => answers[q] === 'yes' && SCREENING_RULES[q].kind === 'clearance_flag');
  // FIX-B (CS-1): say before the result that some answers hold training until a professional agrees.
  const holding = SCREENING_QUESTIONS.some((q) => answers[q] === 'yes' && holdsUntilClearance(q));
  const complete = SCREENING_QUESTIONS.every((q) => answers[q] !== undefined);

  return (
    <OnboardingScaffold
      step="screening"
      title={t('screening.title')}
      nextLabel={t('screening.continue')}
      error={error && !complete ? t('screening.incomplete') : null}
      onNext={() => {
        if (!complete) return setError(true);
        save(reason, localToday(clock.now()));
        router.push({ pathname: nextPath('screening'), params: { reason } });
      }}
    >
      <Paragraph muted>{t('screening.intro')}</Paragraph>
      <Paragraph muted>{t('screening.contentStatus')}</Paragraph>
      {SCREENING_QUESTIONS.map((q) => (
        <ChoiceGroup<ScreeningAnswer>
          key={q}
          label={t(`screening.question.${q}`, { months: MONTHS_PARAM[q] ?? 0 })}
          options={yesNo}
          value={answers[q] ?? null}
          onChange={(v) => update({ answers: { ...answers, [q]: v } })}
          hint={t('screening.answerHint')}
          horizontal
          testID={`screening-${q}`}
        />
      ))}
      {holding ? <Paragraph testID="screening-hold-notice">{t('screening.hold.notice')}</Paragraph> : null}
      {flagged ? (
        <Toggle
          label={t('screening.clearance.label')}
          description={t('screening.clearance.description')}
          value={clearanceAttested}
          onValueChange={(v) => update({ clearanceAttested: v })}
          testID="screening-clearance"
        />
      ) : null}
    </OnboardingScaffold>
  );
}
