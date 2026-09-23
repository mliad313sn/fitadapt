import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ChipProps {
  /** Visible text and accessibility label (already translated). */
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Screen-reader hint (already translated). */
  hint?: string;
  testID?: string;
}

/**
 * A selectable filter chip. Announced as a toggle button with its selected
 * state; selection is shown by fill and border weight, never by colour alone.
 * Touch target ≥ 48 dp (56 dp in gym mode).
 */
export function Chip({ label, selected, onPress, hint, testID }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: theme.minTouchTarget,
        minWidth: theme.minTouchTarget,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
      }}
    >
      <Text style={{ color: selected ? theme.colors.onPrimary : theme.colors.text, fontSize: theme.fontSize.label, fontWeight: selected ? theme.fontWeight.bold : theme.fontWeight.medium }}>
        {label}
      </Text>
    </Pressable>
  );
}
