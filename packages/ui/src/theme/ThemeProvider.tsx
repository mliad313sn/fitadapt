import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { colors, radius, spacing, touchTarget, typography, type ColorScheme, type ColorTokens } from './tokens';

export interface Theme {
  scheme: ColorScheme;
  gymMode: boolean;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: Record<keyof (typeof typography)['size'], number>;
  fontWeight: (typeof typography)['weight'];
  /** Minimum touch target for the current mode (48 dp, or 56 dp in gym mode). */
  minTouchTarget: number;
}

export function createTheme(scheme: ColorScheme, gymMode: boolean): Theme {
  return {
    scheme,
    gymMode,
    colors: colors[scheme],
    spacing,
    radius,
    fontSize: gymMode ? typography.gymSize : typography.size,
    fontWeight: typography.weight,
    minTouchTarget: gymMode ? touchTarget.gym : touchTarget.standard,
  };
}

const ThemeContext = createContext<Theme>(createTheme('light', false));

export interface ThemeProviderProps {
  scheme?: ColorScheme;
  gymMode?: boolean;
  children?: ReactNode;
}

export function ThemeProvider({ scheme = 'light', gymMode = false, children }: ThemeProviderProps) {
  const theme = useMemo(() => createTheme(scheme, gymMode), [scheme, gymMode]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
