import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface CardProps {
  /** Heading (already translated). */
  title?: string;
  children?: ReactNode;
  /** When set, the whole card is one button with this accessibility label. */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ title, children, onPress, accessibilityLabel, style, testID }: CardProps) {
  const theme = useTheme();
  const containerStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    onPress ? { minHeight: theme.minTouchTarget, minWidth: theme.minTouchTarget } : null,
    style,
  ];
  const content = (
    <>
      {title ? (
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
          {title}
        </Text>
      ) : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        onPress={onPress}
        style={containerStyle}
        testID={testID}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} style={containerStyle} testID={testID}>
      {content}
    </View>
  );
}
