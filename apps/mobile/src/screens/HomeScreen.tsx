import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, useTheme } from '@fitadapt/ui';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../state/settings';
import { useSync } from '../sync/SyncProvider';

/** `onOpenPrivacy` is wired by the route (app/index.tsx); without it the entry is hidden. */
export function HomeScreen({ onOpenPrivacy }: { onOpenPrivacy?: () => void } = {}) {
  const theme = useTheme();
  const { t, locale, setLocale, unitSystem, setUnitSystem } = useI18n();
  const { pendingCount } = useSync();
  const gymMode = useSettings((s) => s.gymMode);
  const toggleGymMode = useSettings((s) => s.toggleGymMode);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="home-screen">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('home.title')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>{t('home.subtitle')}</Text>

        <Card title={t('home.offlineCard.title')}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('home.offlineCard.body')}</Text>
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }} testID="sync-status">
            {t('home.syncStatus', { count: pendingCount })}
          </Text>
        </Card>

        <Button
          label={t('home.language.switch')}
          hint={t('home.language.switchHint')}
          onPress={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
          testID="switch-language"
        />
        <Button
          label={gymMode ? t('home.gymMode.disable') : t('home.gymMode.enable')}
          hint={t('home.gymMode.hint')}
          variant="secondary"
          onPress={toggleGymMode}
          testID="toggle-gym-mode"
        />
        <Button
          label={unitSystem === 'metric' ? t('home.units.metric') : t('home.units.imperial')}
          hint={t('home.units.switchHint')}
          variant="secondary"
          onPress={() => setUnitSystem(unitSystem === 'metric' ? 'imperial' : 'metric')}
          testID="toggle-units"
        />
        {onOpenPrivacy ? (
          <Button label={t('home.privacy.open')} hint={t('home.privacy.openHint')} variant="secondary" onPress={onOpenPrivacy} testID="open-privacy" />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
