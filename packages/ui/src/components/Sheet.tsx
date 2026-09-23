import { useI18n } from '@fitadapt/i18n/react';
import type { ReactNode } from 'react';
import { Modal, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Heading (already translated). */
  title: string;
  children?: ReactNode;
  testID?: string;
}

/** Bottom sheet; always has a visible, labelled close control (L4: user stays in control). */
export function Sheet({ visible, onClose, title, children, testID }: SheetProps) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID={testID}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.backdrop }}>
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold, flexShrink: 1 }}>
              {title}
            </Text>
            <Button label={t('ui.sheet.close')} display="✕" variant="secondary" onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
