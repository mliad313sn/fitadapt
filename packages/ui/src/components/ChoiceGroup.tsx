import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ChoiceOption<V extends string> {
  value: V;
  /** Visible text (already translated). */
  label: string;
}

export interface ChoiceGroupProps<V extends string> {
  /** The question or field name (already translated); announced for the group and each option. */
  label: string;
  options: readonly ChoiceOption<V>[];
  /** Selected value, or null while nothing is chosen. */
  value: V | null;
  onChange: (value: V) => void;
  /** Screen-reader hint for each option (already translated). */
  hint?: string;
  /** Lay options out side by side (short answers such as yes / no). */
  horizontal?: boolean;
  testID?: string;
}

/**
 * Single choice among a few options (radio group). Each option is a radio
 * whose accessibility label names the question as well as the option, so a
 * screen reader announces "Question, Yes". Selection is shown by a filled
 * marker and border weight, never by colour alone. Touch target ≥ 48 dp
 * (56 dp in gym mode).
 */
export function ChoiceGroup<V extends string>({ label, options, value, onChange, hint, horizontal = false, testID }: ChoiceGroupProps<V>) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID} style={{ gap: theme.spacing.sm }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.medium }}>{label}</Text>
      <View style={{ flexDirection: horizontal ? 'row' : 'column', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${label}, ${option.label}`}
              accessibilityHint={hint}
              accessibilityState={{ checked: selected, selected }}
              onPress={() => onChange(option.value)}
              testID={testID ? `${testID}-${option.value}` : undefined}
              style={{
                minHeight: theme.minTouchTarget,
                minWidth: theme.minTouchTarget,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : 'transparent',
                }}
              />
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.label, fontWeight: selected ? theme.fontWeight.bold : theme.fontWeight.regular }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
