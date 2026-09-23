import { useI18n } from '@fitadapt/i18n/react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ToggleProps {
  /** Visible label and accessibility label (already translated). */
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Short explanation under the label (already translated). */
  description?: string;
  /** Screen-reader hint (already translated). */
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * An on/off switch row. The whole row is the touch target (≥ 48 dp, 56 dp in
 * gym mode) and is announced as a switch with its checked state. The state is
 * also written out ("On"/"Off"), so it never relies on colour alone.
 */
export function Toggle({ label, value, onValueChange, description, hint, disabled = false, testID }: ToggleProps) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      testID={testID}
      style={{
        minHeight: theme.minTouchTarget,
        minWidth: theme.minTouchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.bold }}>{label}</Text>
        {description ? <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{description}</Text> : null}
      </View>
      <Text
        style={{
          color: value ? theme.colors.onPrimary : theme.colors.text,
          backgroundColor: value ? theme.colors.primary : theme.colors.background,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          fontSize: theme.fontSize.label,
          fontWeight: theme.fontWeight.bold,
        }}
      >
        {value ? t('ui.toggle.on') : t('ui.toggle.off')}
      </Text>
    </Pressable>
  );
}
