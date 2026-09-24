import { useRouter } from 'expo-router';
import { ProgressScreen } from '../src/screens/ProgressScreen';

export default function Progress() {
  const router = useRouter();
  return <ProgressScreen onExit={() => router.replace('/')} onOpenPhotos={() => router.push('/photos')} onOpenPrivacy={() => router.push('/privacy')} />;
}
