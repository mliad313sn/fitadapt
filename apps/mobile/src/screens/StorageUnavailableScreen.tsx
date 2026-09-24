import { resolveLocale, type Locale } from '@fitadapt/i18n';
import { I18nProvider, useI18n } from '@fitadapt/i18n/react';
import { ThemeProvider, useTheme } from '@fitadapt/ui';
import { ScrollView, Text, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/**
 * Shown instead of the app when the encrypted database cannot be opened (no
 * cipher in the SQLite build, or the OS keystore failed): the app fails
 * closed (ADR-020). Nothing is opened, read or written, no network call is
 * made, and no unencrypted fallback exists. It needs no store at all.
 */
function Body() {
  const { t } = useI18n();
  const theme = useTheme();
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="storage-unavailable">
        <Text accessibilityRole="header" style={{ ...text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('storage.unavailable.title')}
        </Text>
        <Text style={text}>{t('storage.unavailable.body')}</Text>
        <Text style={text}>{t('storage.unavailable.action')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export function StorageUnavailableScreen({ languageTags }: { languageTags: readonly string[] }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const locale: Locale = resolveLocale([...languageTags]);
  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={locale}>
        <ThemeProvider scheme={scheme}>
          <Body />
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
