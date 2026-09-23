import { createContext, useContext, type ReactNode } from 'react';
import type { LibraryStore } from './library-store';

const LibraryContext = createContext<LibraryStore | null>(null);

export function LibraryProvider({ store, children }: { store: LibraryStore | null; children?: ReactNode }) {
  return <LibraryContext.Provider value={store}>{children}</LibraryContext.Provider>;
}

/** The on-device exercise library, or null when the app was started without one (tests of other screens). */
export function useLibraryStore(): LibraryStore | null {
  return useContext(LibraryContext);
}
