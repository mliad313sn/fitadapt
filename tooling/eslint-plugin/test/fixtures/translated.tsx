// Fixture: the compliant version of hardcoded-string.tsx. It must pass.
import { Text, View } from 'react-native';

declare function t(key: string): string;

export function Greeting() {
  return (
    <View accessibilityLabel={t('home.title')}>
      <Text>{t('home.subtitle')}</Text>
      <Text> · </Text>
      <Text>{42}</Text>
    </View>
  );
}
