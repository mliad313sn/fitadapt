import { useRouter } from 'expo-router';
import { CoachScreen } from '../src/screens/CoachScreen';

export default function Coach() {
  const router = useRouter();
  return <CoachScreen onExit={() => router.replace('/')} onOpenPrivacy={() => router.push('/privacy')} onOpenWorkout={() => router.push('/workout')} />;
}
