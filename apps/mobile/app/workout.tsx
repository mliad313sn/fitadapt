import { useRouter } from 'expo-router';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';

export default function Workout() {
  const router = useRouter();
  return <WorkoutScreen onExit={() => router.replace('/')} onOpenCalendar={() => router.push('/calendar')} onOpenAssessment={() => router.push('/assessment')} />;
}
