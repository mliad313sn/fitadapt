import { useRouter } from 'expo-router';
import { PairScreen } from '../src/screens/PairScreen';

export default function Pair() {
  const router = useRouter();
  return <PairScreen onExit={() => router.replace('/')} />;
}
