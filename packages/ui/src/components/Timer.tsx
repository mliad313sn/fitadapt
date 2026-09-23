import { useI18n } from '@fitadapt/i18n/react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface TimerProps {
  /** Remaining time in milliseconds. The timer state lives on the device, never on the server. */
  remainingMs: number;
  running: boolean;
  onToggle: () => void;
  onReset?: () => void;
  testID?: string;
}

export function splitDuration(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** Presentational countdown (mm:ss) with start/pause and reset controls. */
export function Timer({ remainingMs, running, onToggle, onReset, testID }: TimerProps) {
  const theme = useTheme();
  const { t } = useI18n();
  const { minutes, seconds } = splitDuration(remainingMs);
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md }} testID={testID}>
      <Text
        accessibilityRole="timer"
        accessibilityLabel={t('ui.timer.remaining', { minutes, seconds })}
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.display,
          fontWeight: theme.fontWeight.bold,
          fontVariant: ['tabular-nums'],
        }}
      >
        {clock}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Button label={running ? t('ui.timer.pause') : t('ui.timer.start')} onPress={onToggle} />
        {onReset ? <Button label={t('ui.timer.reset')} variant="secondary" onPress={onReset} /> : null}
      </View>
    </View>
  );
}
