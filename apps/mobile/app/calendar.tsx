import { useRouter } from 'expo-router';
import { CalendarScreen } from '../src/screens/CalendarScreen';

export default function Calendar() {
  const router = useRouter();
  return <CalendarScreen onExit={() => router.replace('/')} />;
}
