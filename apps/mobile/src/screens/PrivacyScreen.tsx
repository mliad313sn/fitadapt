import { useI18n } from '@fitadapt/i18n/react';
import { retentionDays } from '@fitadapt/privacy';
import type { ConsentDataType } from '@fitadapt/shared';
import { Button, Sheet, Toggle, useTheme } from '@fitadapt/ui';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reportError } from '../observability';
import { statesOf } from '../privacy/consents';
import { useConsents, usePrivacy } from '../privacy/PrivacyProvider';

type Notice = 'privacy.export.done' | 'privacy.delete.done' | 'errors.generic' | null;

const labelKey = (type: ConsentDataType) => `privacy.consent.${type}.label` as const;
const descriptionKey = (type: ConsentDataType) => `privacy.consent.${type}.description` as const;

/** Consent per data type, data export and account deletion (M17). */
export function PrivacyScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { client, analytics, wipeLocalData } = usePrivacy();
  const records = useConsents((s) => s.records);
  const decide = useConsents((s) => s.decide);
  const clearConsents = useConsents((s) => s.clear);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const states = statesOf(records);

  const onToggle = (dataType: ConsentDataType, granted: boolean) => {
    decide(dataType, granted, locale);
    // Sent only if analytics consent is on after this decision.
    analytics.track('consent_changed', { dataType, decision: granted ? 'granted' : 'withdrawn' });
  };

  const onExport = async () => {
    if (!client) return;
    setBusy(true);
    try {
      analytics.track('data_export_requested', {});
      const document = await client.exportData();
      await Share.share({ title: t('privacy.export.button'), message: JSON.stringify(document, null, 2) });
      setNotice('privacy.export.done');
    } catch (error) {
      reportError(error, { area: 'ui' });
      setNotice('errors.generic');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!client) return;
    setBusy(true);
    try {
      analytics.track('account_deletion_requested', {});
      await client.deleteAccount();
      wipeLocalData();
      clearConsents();
      setConfirming(false);
      setNotice('privacy.delete.done');
    } catch (error) {
      reportError(error, { area: 'ui' });
      setConfirming(false);
      setNotice('errors.generic');
    } finally {
      setBusy(false);
    }
  };

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="privacy-screen">
        <Text accessibilityRole="header" style={{ ...text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('privacy.title')}
        </Text>
        <Text style={text}>{t('privacy.intro')}</Text>

        {states.map((state) => (
          <View key={state.dataType} style={{ gap: theme.spacing.xs }}>
            <Toggle
              label={t(labelKey(state.dataType))}
              description={t(descriptionKey(state.dataType))}
              hint={t('privacy.consentHint')}
              value={state.granted}
              onValueChange={(next) => onToggle(state.dataType, next)}
              testID={`consent-${state.dataType}`}
            />
            {state.needsRenewal ? <Text style={muted}>{t('privacy.consent.renewal')}</Text> : null}
          </View>
        ))}

        {notice ? (
          <Text accessibilityLiveRegion="polite" style={text} testID="privacy-notice">
            {t(notice)}
          </Text>
        ) : null}
        {client ? null : <Text style={muted}>{t('privacy.signedOut')}</Text>}
        <Button label={t('privacy.export.button')} hint={t('privacy.export.hint')} variant="secondary" disabled={!client || busy} onPress={onExport} testID="privacy-export" />
        <Button label={t('privacy.delete.button')} hint={t('privacy.delete.hint')} variant="danger" disabled={!client || busy} onPress={() => setConfirming(true)} testID="privacy-delete" />
      </ScrollView>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title={t('privacy.delete.confirmTitle')} testID="privacy-delete-sheet">
        <Text style={text}>{t('privacy.delete.confirmBody', { days: retentionDays('backupRetentionDays') })}</Text>
        <Button label={t('privacy.delete.confirm')} variant="danger" disabled={busy} onPress={onDelete} testID="privacy-delete-confirm" />
        <Button label={t('privacy.delete.cancel')} variant="secondary" onPress={() => setConfirming(false)} testID="privacy-delete-cancel" />
      </Sheet>
    </SafeAreaView>
  );
}
