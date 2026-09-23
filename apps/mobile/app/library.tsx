import { useRouter } from 'expo-router';
import { useLibraryStore } from '../src/library/LibraryProvider';
import { LibraryScreen } from '../src/screens/LibraryScreen';

export default function Library() {
  const router = useRouter();
  const store = useLibraryStore();
  // The root layout always provides the on-device library; without it there is nothing to show.
  return store ? <LibraryScreen store={store} onBack={() => router.back()} /> : null;
}
