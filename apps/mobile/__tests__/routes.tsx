import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Equipment from '../app/equipment';
import FirstWorkout from '../app/first-workout';
import Index from '../app/index';
import Library from '../app/library';
import About from '../app/onboarding/about';
import OnboardingEquipment from '../app/onboarding/equipment';
import ExerciseRisk from '../app/onboarding/exercise-risk';
import Goals from '../app/onboarding/goals';
import HealthConsent from '../app/onboarding/health-consent';
import Result from '../app/onboarding/result';
import Schedule from '../app/onboarding/schedule';
import Screening from '../app/onboarding/screening';
import Terms from '../app/onboarding/terms';
import Privacy from '../app/privacy';
import SignIn from '../app/sign-in';

/** M01 routes declared by the root layout (the map every router test passes to renderRouter). */
export const m01Routes = {
  'sign-in': SignIn,
  equipment: Equipment,
  'first-workout': FirstWorkout,
  'onboarding/goals': Goals,
  'onboarding/schedule': Schedule,
  'onboarding/equipment': OnboardingEquipment,
  'onboarding/health-consent': HealthConsent,
  'onboarding/about': About,
  'onboarding/screening': Screening,
  'onboarding/result': Result,
  'onboarding/terms': Terms,
  'onboarding/exercise-risk': ExerciseRisk,
};

/** Every route of the app. */
export const appRoutes = { _layout: RootLayout, index: Index, 'age-gate': AgeGate, privacy: Privacy, library: Library, ...m01Routes };
