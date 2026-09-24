import RootLayout from '../app/_layout';
import AgeGate from '../app/age-gate';
import Assessment from '../app/assessment';
import Calendar from '../app/calendar';
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
import Workout from '../app/workout';
import Pair from '../app/pair';
import Progress from '../app/progress';
import Photos from '../app/photos';

/** M01 routes declared by the root layout (the map every router test passes to renderRouter), plus the M07 assessment the M08 calendar and the M02 workout behind the same gate. */
export const m01Routes = {
  'sign-in': SignIn,
  assessment: Assessment,
  calendar: Calendar,
  workout: Workout,
  pair: Pair,
  progress: Progress,
  photos: Photos,
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
