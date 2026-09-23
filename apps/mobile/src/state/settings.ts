import { create } from 'zustand';

interface SettingsState {
  gymMode: boolean;
  toggleGymMode: () => void;
}

/** Device-local UI preferences. Locale and units live in the I18nProvider. */
export const useSettings = create<SettingsState>((set) => ({
  gymMode: false,
  toggleGymMode: () => set((s) => ({ gymMode: !s.gymMode })),
}));
