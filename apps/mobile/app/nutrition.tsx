import { useRouter } from 'expo-router';
import { NutritionScreen } from '../src/screens/NutritionScreen';

export default function Nutrition() {
  const router = useRouter();
  return <NutritionScreen onExit={() => router.replace('/')} onOpenPrivacy={() => router.push('/privacy')} />;
}
