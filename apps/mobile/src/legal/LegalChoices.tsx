import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import type { AcknowledgmentStatement, RenderedDocument } from '@fitadapt/legal';
import { ChoiceGroup, Toggle, useTheme } from '@fitadapt/ui';
import { Text, View } from 'react-native';
import { useLegal } from '../profile/ProfileProvider';
import { RESIDENCE_CHOICES, type ResidenceChoice as Residence } from './presentation';

/**
 * FIX-B (B pre-review §1.5 item 1): "Where do you live?", asked explicitly. The
 * phone's language or region is never taken as the answer; nothing is chosen
 * for the user. The choice decides the text variants, the emergency number and
 * the age rules, and is recorded with every acceptance (jurisdictionSource).
 */
export function ResidenceChoice({ testID = 'residence' }: { testID?: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const confirmed = useLegal((s) => s.jurisdictionSource === 'user_confirmed');
  const confirm = useLegal((s) => s.confirmResidence);
  const value = confirmed ? ((RESIDENCE_CHOICES as readonly string[]).includes(jurisdiction) ? (jurisdiction as Residence) : 'ZZ') : null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('legal.residence.intro')}</Text>
      <ChoiceGroup<Residence>
        label={t('legal.residence.question')}
        options={RESIDENCE_CHOICES.map((c) => ({ value: c, label: t(`legal.residence.country.${c}` as MessageKey) }))}
        value={value}
        onChange={confirm}
        hint={t('legal.residence.hint')}
        testID={testID}
      />
    </View>
  );
}

/**
 * FIX-B (B pre-review §1.5 item 3): the exercise-risk acknowledgment as the
 * rendered text (so what is hashed is what is shown), with each statement as
 * its own switch, OFF until the user turns it on. Other sections (the advice
 * to see a professional, "this does not limit your legal rights") are plain text.
 */
export function RiskStatements({
  document,
  statements,
  ticked,
  onToggle,
  testIDPrefix = 'risk-statement',
}: {
  document: RenderedDocument;
  statements: readonly AcknowledgmentStatement[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  testIDPrefix?: string;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const byKey = new Map(statements.map((s) => [s.key as string, s.id]));
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label, fontWeight: theme.fontWeight.bold }}>{document.draftBanner}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('legal.risk.statementsHint')}</Text>
      {document.sections.map((section) => {
        const id = byKey.get(section.key);
        return id ? (
          <Toggle key={section.key} label={section.text} value={ticked.has(id)} onValueChange={(on) => onToggle(id, on)} hint={t('legal.risk.statementHint')} testID={`${testIDPrefix}-${id}`} />
        ) : (
          <Text key={section.key} style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>
            {section.text}
          </Text>
        );
      })}
    </View>
  );
}
