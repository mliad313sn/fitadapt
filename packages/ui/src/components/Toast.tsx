import { useI18n } from '@fitadapt/i18n/react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastProps {
  visible: boolean;
  /** Message (already translated). */
  message: string;
  onDismiss: () => void;
  tone?: ToastTone;
  testID?: string;
}

/** Non-blocking notification announced by screen readers; dismissible, never auto-hidden before it is read. */
export function Toast({ visible, message, onDismiss, tone = 'info', testID }: ToastProps) {
  const theme = useTheme();
  const { t } = useI18n();
  if (!visible) return null;
  const tones = {
    info: [theme.colors.text, theme.colors.background],
    success: [theme.colors.success, theme.colors.onSuccess],
    danger: [theme.colors.danger, theme.colors.onDanger],
  } as const;
  const [background, foreground] = tones[tone];
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        backgroundColor: background,
        borderRadius: theme.radius.md,
        paddingLeft: theme.spacing.lg,
      }}
    >
      {/* The message itself is the live region, so the dismiss button stays separately focusable. */}
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: foreground, fontSize: theme.fontSize.body, flex: 1 }}>
        {message}
      </Text>
      <Button label={t('ui.toast.dismiss')} display="✕" variant="secondary" onPress={onDismiss} />
    </View>
  );
}
