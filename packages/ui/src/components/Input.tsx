import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface InputProps {
  /** Visible label and accessibility label (already translated). */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  hint?: string;
  /** Error message (already translated); announced with the field. */
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoComplete?: 'email' | 'one-time-code' | 'off';
  testID?: string;
}

export function Input({ label, value, onChangeText, hint, error, keyboardType, secureTextEntry, autoComplete, testID }: InputProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.label, fontWeight: theme.fontWeight.medium }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoComplete={autoComplete}
        testID={testID}
        style={{
          minHeight: theme.minTouchTarget,
          borderWidth: error ? 2 : 1,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          color: theme.colors.text,
          backgroundColor: theme.colors.background,
          fontSize: theme.fontSize.body,
        }}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.caption }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
