/**
 * M01 onboarding screen order (docs/specs/M01): goals and experience, schedule,
 * places and equipment, then health-data consent (needed before any health
 * data is entered), about you (optional biometrics), screening and its
 * result, then the L2 acceptances (Terms and Privacy, exercise risk) before
 * the first workout. From a fresh install — age gate (M17), welcome, these
 * nine steps, first workout — that is 12 screens (goal condition 1).
 */
export const ONBOARDING_STEPS = ['goals', 'schedule', 'equipment', 'health-consent', 'about', 'screening', 'result', 'terms', 'exercise-risk'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_WORKOUT_PATH = '/first-workout';

export const stepPath = (step: OnboardingStep) => `/onboarding/${step}` as const;

export function stepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export function nextPath(step: OnboardingStep): string {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
  return next ? stepPath(next) : FIRST_WORKOUT_PATH;
}
