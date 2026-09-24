import { useRouter } from 'expo-router';
import { PhotosScreen } from '../src/screens/PhotosScreen';

export default function Photos() {
  const router = useRouter();
  return <PhotosScreen onExit={() => router.replace('/progress')} />;
}
