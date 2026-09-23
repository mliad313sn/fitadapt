import type { RenderedDocument } from '@fitadapt/legal';
import { useTheme } from '@fitadapt/ui';
import { Text, View } from 'react-native';

/** A legal text exactly as rendered by packages/legal (the hash of this text is what an acceptance records). */
export function DocumentView({ document, showTitle = true, testID }: { document: RenderedDocument; showTitle?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }} testID={testID}>
      <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label, fontWeight: theme.fontWeight.bold }}>{document.draftBanner}</Text>
      {showTitle ? (
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
          {document.title}
        </Text>
      ) : null}
      {document.sections.map((section) => (
        <Text key={section.key} style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>
          {section.text}
        </Text>
      ))}
    </View>
  );
}
