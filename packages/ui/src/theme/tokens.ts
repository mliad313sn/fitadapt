/**
 * Design tokens. Colours are checked against WCAG 2.2 AA contrast in
 * tokens.test.ts; touch targets follow CLAUDE.md rule 9 (48 dp, 56 dp in gym mode).
 * Typography uses the platform system font (no bundled font files, L6).
 */
export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  danger: string;
  onDanger: string;
  success: string;
  onSuccess: string;
  focus: string;
  backdrop: string;
}

export const colors: Readonly<Record<ColorScheme, ColorTokens>> = {
  light: {
    background: '#FFFFFF',
    surface: '#F3F4F6',
    text: '#111827',
    textMuted: '#4B5563',
    border: '#6B7280',
    primary: '#1D4ED8',
    onPrimary: '#FFFFFF',
    secondary: '#E5E7EB',
    onSecondary: '#111827',
    danger: '#B91C1C',
    onDanger: '#FFFFFF',
    success: '#166534',
    onSuccess: '#FFFFFF',
    focus: '#1D4ED8',
    backdrop: 'rgba(17, 24, 39, 0.6)',
  },
  dark: {
    background: '#0B0F14',
    surface: '#161B22',
    text: '#F3F4F6',
    textMuted: '#9CA3AF',
    border: '#8B949E',
    primary: '#60A5FA',
    onPrimary: '#0B0F14',
    secondary: '#30363D',
    onSecondary: '#F3F4F6',
    danger: '#F87171',
    onDanger: '#0B0F14',
    success: '#4ADE80',
    onSuccess: '#0B0F14',
    focus: '#93C5FD',
    backdrop: 'rgba(0, 0, 0, 0.7)',
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 4, md: 8, lg: 16, pill: 999 } as const;

export const typography = {
  /** undefined = platform system font (San Francisco / Roboto). */
  fontFamily: undefined,
  size: { caption: 13, label: 15, body: 17, title: 22, headline: 28, display: 40 },
  /** Gym mode: glanceable numbers readable at arm's length. */
  gymSize: { caption: 15, label: 18, body: 20, title: 26, headline: 34, display: 64 },
  weight: { regular: '400', medium: '500', bold: '700' },
} as const;

/** Minimum touch target sizes in dp (CLAUDE.md rule 9). */
export const touchTarget = { standard: 48, gym: 56 } as const;

/** WCAG 2.2 AA thresholds (SC 1.4.3 text, SC 1.4.11 non-text UI). */
export const contrastRequirement = { text: 4.5, largeText: 3, nonText: 3 } as const;
