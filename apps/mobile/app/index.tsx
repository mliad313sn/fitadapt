import { useRouter } from 'expo-router';
import { HomeScreen } from '../src/screens/HomeScreen';

export default function Index() {
  const router = useRouter();
  return <HomeScreen onOpenPrivacy={() => router.push('/privacy')} onOpenLibrary={() => router.push('/library')} />;
}
