// Fixture for goal condition 4: this file MUST fail the i18n lint rule.
import { Text, View } from 'react-native';

export function Greeting() {
  return (
    <View accessibilityLabel="Greeting card">
      <Text>Hello athlete</Text>
    </View>
  );
}
