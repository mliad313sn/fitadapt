import { useI18n } from '@fitadapt/i18n/react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface NumberDisplayProps {
  value: number;
  /** What the number is (already translated), e.g. "Reps". */
  label: string;
  /** Unit suffix (already translated), e.g. "kg". */
  unit?: string;
  maximumFractionDigits?: number;
  testID?: string;
}

/** Large, glanceable number; bigger in gym mode. Announced as "label: value unit". */
export function NumberDisplay({ value, label, unit, maximumFractionDigits = 1, testID }: NumberDisplayProps) {
  const theme = useTheme();
  const i18n = useI18n();
  const formatted = i18n.formatNumber(value, { maximumFractionDigits });
  const spoken = unit ? `${formatted} ${unit}` : formatted;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={i18n.t('ui.numberDisplay.value', { label, value: spoken })}
      testID={testID}
      style={{ alignItems: 'center' }}
    >
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{label}</Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.display,
          fontWeight: theme.fontWeight.bold,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatted}
        {unit ? <Text style={{ fontSize: theme.fontSize.title }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}
