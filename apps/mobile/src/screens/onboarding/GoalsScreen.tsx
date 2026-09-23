import { useI18n } from '@fitadapt/i18n/react';
import { EXPERIENCE_LEVELS, GOAL_IDS, type ExperienceLevel, type GoalId } from '@fitadapt/shared';
import { ChoiceGroup } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { OnboardingScaffold } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { useProfile } from '../../profile/ProfileProvider';

const NONE = 'none';

/** Step 1: main and (optional) second goal, and training experience. */
export function GoalsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const draft = useProfile((s) => s.draft);
  const update = useProfile((s) => s.updateDraft);
  const [error, setError] = useState<'goal' | 'experience' | null>(null);
  const goals = GOAL_IDS.map((id) => ({ value: id, label: t(`goal.${id}`) }));
  return (
    <OnboardingScaffold
      step="goals"
      title={t('onboarding.goals.title')}
      error={error === 'goal' && !draft.primaryGoal ? t('onboarding.goals.required') : error === 'experience' && !draft.experience ? t('onboarding.experience.required') : null}
      onNext={() => {
        if (!draft.primaryGoal) return setError('goal');
        if (!draft.experience) return setError('experience');
        router.push(nextPath('goals'));
      }}
    >
      <ChoiceGroup<GoalId>
        label={t('onboarding.goals.primary')}
        options={goals}
        value={draft.primaryGoal}
        onChange={(primaryGoal) => {
          update({ primaryGoal, secondaryGoal: draft.secondaryGoal === primaryGoal ? null : draft.secondaryGoal });
        }}
        testID="goal-primary"
      />
      <ChoiceGroup<GoalId | typeof NONE>
        label={t('onboarding.goals.secondary')}
        options={[{ value: NONE, label: t('onboarding.goals.none') }, ...goals.filter((g) => g.value !== draft.primaryGoal)]}
        value={draft.secondaryGoal ?? NONE}
        onChange={(v) => update({ secondaryGoal: v === NONE ? null : v })}
        testID="goal-secondary"
      />
      <ChoiceGroup<ExperienceLevel>
        label={t('onboarding.experience.title')}
        options={EXPERIENCE_LEVELS.map((id) => ({ value: id, label: t(`experience.${id}`) }))}
        value={draft.experience}
        onChange={(experience) => update({ experience })}
        testID="experience"
      />
    </OnboardingScaffold>
  );
}
