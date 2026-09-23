import type { Locale } from '@fitadapt/i18n';
import { I18nProvider } from '@fitadapt/i18n/react';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { ThemeProvider } from './theme/ThemeProvider';
import type { ColorScheme } from './theme/tokens';

export interface RenderOptions {
  locale?: Locale;
  gymMode?: boolean;
  scheme?: ColorScheme;
}

export function renderUI(ui: ReactElement, { locale = 'en', gymMode = false, scheme = 'light' }: RenderOptions = {}) {
  return render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider scheme={scheme} gymMode={gymMode}>
        {ui}
      </ThemeProvider>
    </I18nProvider>,
  );
}

export function flatStyle(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;
}
