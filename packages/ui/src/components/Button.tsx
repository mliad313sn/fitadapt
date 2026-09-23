import { Pressable, StyleSheet, Text, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  /** Visible text and accessibility label (already translated). */
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Screen-reader hint (already translated). */
  hint?: string;
  /** Visible content when it differs from the label (e.g. "+"); the label stays the accessible name. */
  display?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, hint, display, style, testID }: ButtonProps) {
  const theme = useTheme();
  const palette = {
    primary: [theme.colors.primary, theme.colors.onPrimary],
    secondary: [theme.colors.secondary, theme.colors.onSecondary],
    danger: [theme.colors.danger, theme.colors.onDanger],
  } as const;
  const [background, foreground] = palette[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={0}
      style={[
        styles.base,
        {
          minHeight: theme.minTouchTarget,
          minWidth: theme.minTouchTarget,
          backgroundColor: background,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.lg,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: foreground, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.bold }}>{display ?? label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
