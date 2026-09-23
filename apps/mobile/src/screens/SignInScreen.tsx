import { isMessageKey, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { EmailSchema, OtpCodeSchema } from '@fitadapt/shared';
import { OfflineError } from '@fitadapt/sync';
import { Button, Input, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError } from '../auth/auth-api';
import { reportError } from '../observability';
import { useSession, useSessionStatus } from '../profile/ProfileProvider';

type Stage = 'email' | 'code' | 'done';

function errorKey(error: unknown): MessageKey {
  if (error instanceof OfflineError) return 'signIn.offline';
  if (error instanceof ApiRequestError && error.code) {
    const key = `errors.${error.code}`;
    if (isMessageKey(key)) return key;
  }
  return 'errors.generic';
}

/**
 * Sign-in and sign-up with an emailed one-time code (ADR-003). Optional: the
 * app works offline without an account; signing in uploads the device
 * ledgers and syncs (ADR-013).
 */
export function SignInScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const session = useSession();
  const status = useSessionStatus();
  const [stage, setStage] = useState<Stage>(status === 'signed_in' ? 'done' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      reportError(e, { area: 'auth' });
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const onSend = () => {
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) return setError('signIn.invalidEmail');
    void run(async () => {
      await session!.getState().requestCode(parsed.data, locale);
      setStage('code');
    });
  };

  const onVerify = () => {
    const parsed = OtpCodeSchema.safeParse(code.trim());
    if (!parsed.success) return setError('signIn.invalidCode');
    void run(async () => {
      await session!.getState().verifyCode(EmailSchema.parse(email), parsed.data);
      setStage('done');
    });
  };

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="sign-in">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('signIn.title')}
        </Text>
        {stage === 'done' ? (
          <Text style={text} accessibilityLiveRegion="polite">
            {t('signIn.done')}
          </Text>
        ) : (
          <Text style={{ ...text, color: theme.colors.textMuted }}>{t('signIn.intro')}</Text>
        )}
        {stage === 'email' ? (
          <>
            <Input label={t('signIn.email')} hint={t('signIn.emailHint')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" testID="sign-in-email" />
            <Button label={t('signIn.sendCode')} onPress={onSend} disabled={busy} testID="sign-in-send" />
          </>
        ) : null}
        {stage === 'code' ? (
          <>
            <Text style={text} accessibilityLiveRegion="polite">
              {t('signIn.codeSent')}
            </Text>
            <Input label={t('signIn.code')} hint={t('signIn.codeHint')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" testID="sign-in-code" />
            <Button label={t('signIn.verify')} onPress={onVerify} disabled={busy} testID="sign-in-verify" />
            <Button label={t('signIn.resend')} variant="secondary" onPress={onSend} disabled={busy} testID="sign-in-resend" />
          </>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }} testID="sign-in-error">
            {t(error)}
          </Text>
        ) : null}
        <Button label={t('signIn.close')} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="sign-in-close" />
      </ScrollView>
    </SafeAreaView>
  );
}
