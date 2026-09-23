import { useI18n } from '@fitadapt/i18n/react';
import { Text, View, type AccessibilityActionEvent } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface StepperProps {
  /** What is being adjusted (already translated). */
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  testID?: string;
}

/** Large +/- control; also operable by screen-reader swipe gestures (adjustable role). */
export function Stepper({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, testID }: StepperProps) {
  const theme = useTheme();
  const i18n = useI18n();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const decrement = () => onChange(clamp(value - step));
  const increment = () => onChange(clamp(value + step));
  const formatted = i18n.formatNumber(value);

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') increment();
    if (event.nativeEvent.actionName === 'decrement') decrement();
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        ...(Number.isFinite(min) ? { min } : {}),
        ...(Number.isFinite(max) ? { max } : {}),
        now: value,
        text: i18n.t('ui.stepper.value', { label, value: formatted }),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
      testID={testID}
    >
      <Button
        label={i18n.t('ui.stepper.decrease', { label })}
        display="−"
        variant="secondary"
        disabled={value <= min}
        onPress={decrement}
      />
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.headline,
          fontWeight: theme.fontWeight.bold,
          minWidth: theme.minTouchTarget,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatted}
      </Text>
      <Button
        label={i18n.t('ui.stepper.increase', { label })}
        display="+"
        variant="secondary"
        disabled={value >= max}
        onPress={increment}
      />
    </View>
  );
}
