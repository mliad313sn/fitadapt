import { useRouter } from 'expo-router';
import { HomeScreen } from '../src/screens/HomeScreen';

export default function Index() {
  const router = useRouter();
  return (
    <HomeScreen
      onOpenPrivacy={() => router.push('/privacy')}
      onOpenLibrary={() => router.push('/library')}
      onStartOnboarding={() => router.push('/onboarding/goals')}
      onOpenFirstWorkout={() => router.push('/first-workout')}
      onOpenAssessment={() => router.push('/assessment')}
      onOpenCalendar={() => router.push('/calendar')}
      onOpenWorkout={() => router.push('/workout')}
      onOpenPair={() => router.push('/pair')}
      onOpenProgress={() => router.push('/progress')}
      onOpenNutrition={() => router.push('/nutrition')}
      onOpenCoach={() => router.push('/coach')}
      // A missing health consent is renewed in Privacy settings; changed texts on the terms screen.
      onReviewLegal={(missing) => router.push(missing.every((id) => id.startsWith('consent.')) ? '/privacy' : '/onboarding/terms')}
      onRescreen={(reason) => router.push({ pathname: '/onboarding/screening', params: { reason } })}
      onOpenEquipment={() => router.push('/equipment')}
      onSignIn={() => router.push('/sign-in')}
    />
  );
}
