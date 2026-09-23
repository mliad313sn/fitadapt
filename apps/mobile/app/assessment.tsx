import { useRouter } from 'expo-router';
import { AssessmentScreen } from '../src/screens/AssessmentScreen';

export default function Assessment() {
  const router = useRouter();
  return <AssessmentScreen onExit={() => router.replace('/')} onFirstWorkout={() => router.replace('/first-workout')} />;
}
