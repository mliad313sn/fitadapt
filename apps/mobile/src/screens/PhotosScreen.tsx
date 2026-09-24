import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { PHOTO_POSES, type PhotoPose, type ProgressPhoto } from '@fitadapt/shared';
import { Button, Card, Chip, Input, Toggle, useTheme } from '@fitadapt/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { reportError } from '../observability';
import { useFeature, usePrivacy } from '../privacy/PrivacyProvider';
import { localIsoDate } from '../profile/selectors';
import { formatIsoDate } from '../progress/format';
import { WrongRecoveryCodeError } from '../progress/photo-backup';
import { useScreenCaptureProtection } from '../privacy/screen-capture';
import { usePhotoBackup, useProgress, useProgressContext } from '../progress/ProgressProvider';

export interface PhotosScreenProps {
  onExit: () => void;
}

type Message =
  | 'photos.added'
  | 'photos.failed'
  | 'photos.permission'
  | 'photos.deleted'
  | 'photos.backup.done'
  | 'photos.backup.failed'
  | 'photos.backup.disabled'
  | 'photos.restore.failed'
  | { key: 'photos.restore.done' | 'photos.backup.joined'; count: number; skipped: number };

/**
 * M04 progress photos: encrypted on this device (AES-256-GCM, key in the OS
 * keystore), side-by-side comparison with a pose-guide overlay, and the
 * optional end-to-end-encrypted backup. Nothing is uploaded unless the user
 * turns the backup on (CLAUDE.md rule 7). While the app is not in the
 * foreground (app switcher), the photos are not drawn.
 */
/**
 * Photos are hidden while the app is in the app switcher (`inactive`) or in
 * the background. Any other state counts as the foreground: iOS can report
 * `unknown` at launch until its first event, and photos must not stay hidden
 * then.
 */
const isForeground = (state: unknown) => state !== 'background' && state !== 'inactive';

export function PhotosScreen({ onExit }: PhotosScreenProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { vault, io } = useProgressContext();
  const allowed = useFeature('photos.progress');
  const { analytics } = usePrivacy();
  const [photos, setPhotos] = useState<ProgressPhoto[]>(() => (vault && allowed ? vault.list() : []));
  const [pose, setPose] = useState<PhotoPose>('front');
  const [selected, setSelected] = useState<string[]>([]);
  const [guide, setGuide] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const backup = usePhotoBackup();
  const backupAllowed = useFeature('photos.backup');
  const backupEnabled = useProgress((s) => s.photoBackupEnabled);
  const setBackupEnabled = useProgress((s) => s.setPhotoBackupEnabled);

  // MOB-12: decrypted photos and the recovery code are never captured (screenshots, recordings, the recents preview).
  useScreenCaptureProtection('photos');
  useEffect(() => {
    analytics.track('screen_viewed', { screen: 'photos' });
  }, [analytics]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(isForeground(state)));
    return () => sub.remove();
  }, []);
  const reload = useCallback(() => setPhotos(vault && allowed ? vault.list() : []), [vault, allowed]);
  useEffect(reload, [reload]);

  const canBackUp = backup !== null && backupAllowed && backupEnabled;
  const runBackup = useCallback(async () => {
    if (!backup || !canBackUp) return;
    try {
      await backup.run();
      setMessage('photos.backup.done');
    } catch (error) {
      reportError(error, { area: 'photos' });
      setMessage('photos.backup.failed');
    }
    reload();
  }, [backup, canBackUp, reload]);

  const add = async (source: 'camera' | 'library') => {
    if (!vault) return;
    try {
      const picked = await io.capturePhoto(source);
      if (!picked) return;
      if ('denied' in picked) {
        setMessage('photos.permission');
        return;
      }
      vault.add({ image: picked.image, mimeType: picked.mimeType, pose, takenOn: localIsoDate(clock.now()) });
      setMessage('photos.added');
      reload();
      // Only with the backup turned on (and the consent and an account): the encrypted file is uploaded.
      if (canBackUp) await runBackup();
    } catch (error) {
      reportError(error, { area: 'photos' });
      setMessage('photos.failed');
    }
  };

  const remove = (p: ProgressPhoto) => {
    vault?.remove(p.id);
    setSelected((s) => s.filter((id) => id !== p.id));
    setMessage('photos.deleted');
    reload();
  };

  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const poseName = (p: PhotoPose) => t(`photos.pose.${p}` as MessageKey);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const compare = useMemo(() => photos.filter((p) => selected.includes(p.id)).sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.at.localeCompare(b.at)), [photos, selected]);
  const messageText =
    message === null
      ? null
      : typeof message === 'string'
        ? t(message)
        : [t(message.key, { count: message.count }), message.skipped > 0 ? t('photos.restore.skipped', { count: message.skipped }) : null].filter((part): part is string => part !== null).join(' ');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="photos-screen">
        <Text accessibilityRole="header" style={{ ...text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('photos.title')}
        </Text>
        <Text style={muted}>{t('photos.intro')}</Text>
        {!allowed || !vault ? (
          <Text style={text} testID="photos-needs-consent">
            {t('photos.needsConsent')}
          </Text>
        ) : (
          <>
            <Card testID="photos-add">
              <Text style={muted}>{t('photos.pose')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {PHOTO_POSES.map((p) => (
                  <Chip key={p} label={poseName(p)} selected={pose === p} onPress={() => setPose(p)} testID={`photos-pose-${p}`} />
                ))}
              </View>
              <Text style={muted}>{t('photos.poseGuide')}</Text>
              <Button label={t('photos.take')} hint={t('photos.addHint')} onPress={() => void add('camera')} testID="photos-take" />
              <Button label={t('photos.choose')} hint={t('photos.addHint')} variant="secondary" onPress={() => void add('library')} testID="photos-choose" />
            </Card>
            {messageText ? (
              <Text accessibilityLiveRegion="polite" style={muted} testID="photos-message">
                {messageText}
              </Text>
            ) : null}
            <Text style={text} testID="photos-count">
              {t('photos.count', { count: photos.length })}
            </Text>
            {photos.map((p) => {
              const date = formatIsoDate(p.takenOn, locale);
              const label = t('photos.item', { pose: poseName(p.pose), date });
              return (
                <Card key={p.id} testID={`photos-item-${p.id}`}>
                  <Text style={text}>{label}</Text>
                  {foreground ? <PhotoImage photoId={p.id} mimeType={p.mimeType} label={t('photos.image', { pose: poseName(p.pose), date })} size={96} /> : null}
                  <Chip label={t('photos.select', { pose: poseName(p.pose), date })} selected={selected.includes(p.id)} onPress={() => toggleSelect(p.id)} testID={`photos-select-${p.id}`} />
                  <Button label={t('photos.delete', { pose: poseName(p.pose), date })} variant="danger" onPress={() => remove(p)} testID={`photos-delete-${p.id}`} />
                </Card>
              );
            })}
            <Card title={t('photos.compare.title')} testID="photos-compare">
              {compare.length < 2 ? (
                <Text style={muted}>{t('photos.compare.hint')}</Text>
              ) : (
                <>
                  <Toggle label={t('photos.compare.guide')} hint={t('photos.compare.guideHint')} value={guide} onValueChange={setGuide} testID="photos-compare-guide" />
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    {compare.map((p, i) => {
                      const date = formatIsoDate(p.takenOn, locale);
                      return (
                        <View key={p.id} style={{ flex: 1, gap: theme.spacing.xs }} testID={`photos-compare-${i === 0 ? 'left' : 'right'}`}>
                          <Text style={muted}>{i === 0 ? t('photos.compare.left', { date }) : t('photos.compare.right', { date })}</Text>
                          <View>
                            {foreground ? <PhotoImage photoId={p.id} mimeType={p.mimeType} label={t('photos.image', { pose: poseName(p.pose), date })} size={160} /> : null}
                            {guide ? <PoseGuide testID={`photos-guide-${i === 0 ? 'left' : 'right'}`} /> : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </Card>
            <BackupCard
              available={backup !== null && backupAllowed}
              enabled={backupEnabled}
              total={photos.length}
              backed={photos.filter((p) => p.backedUpAt !== null).length}
              hasExisting={async () => {
                if (!backup) return null;
                try {
                  return await backup.exists();
                } catch (error) {
                  reportError(error, { area: 'photos' });
                  setMessage('photos.backup.failed');
                  return null;
                }
              }}
              onEnable={async (code) => {
                if (!backup) return;
                try {
                  // MOB-02: an existing backup is joined with its own code, never replaced.
                  const outcome = await backup.enable(code);
                  setBackupEnabled(true);
                  analytics.track('photo_backup_toggled', { enabled: true });
                  await backup.run();
                  setMessage(outcome.joinedExisting ? { key: 'photos.backup.joined', count: outcome.restored, skipped: outcome.unreadable } : 'photos.backup.done');
                } catch (error) {
                  if (!(error instanceof WrongRecoveryCodeError)) reportError(error, { area: 'photos' });
                  setMessage(error instanceof WrongRecoveryCodeError ? 'photos.restore.failed' : 'photos.backup.failed');
                }
                reload();
              }}
              onRun={() => void runBackup()}
              onDisable={async () => {
                if (!backup) return;
                try {
                  await backup.disable();
                  setBackupEnabled(false);
                  analytics.track('photo_backup_toggled', { enabled: false });
                  setMessage('photos.backup.disabled');
                } catch (error) {
                  reportError(error, { area: 'photos' });
                  setMessage('photos.backup.failed');
                }
                reload();
              }}
              onRestore={async (code) => {
                if (!backup) return;
                try {
                  const outcome = await backup.restoreWithReport(code);
                  setMessage({ key: 'photos.restore.done', count: outcome.restored, skipped: outcome.unreadable });
                } catch (error) {
                  if (!(error instanceof WrongRecoveryCodeError)) reportError(error, { area: 'photos' });
                  setMessage(error instanceof WrongRecoveryCodeError ? 'photos.restore.failed' : 'photos.backup.failed');
                }
                reload();
              }}
              newCode={() => backup?.newRecoveryCode() ?? ''}
            />
          </>
        )}
        <Button label={t('photos.back')} variant="secondary" onPress={onExit} testID="photos-back" />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Decrypted in memory for display only; never written back in plaintext. */
function PhotoImage({ photoId, mimeType, label, size }: { photoId: string; mimeType: string; label: string; size: number }) {
  const { vault } = useProgressContext();
  // MOB-05: decrypted once per app run (the vault's in-memory display cache), not on every mount or return to the foreground.
  const uri = useMemo(() => {
    try {
      return vault ? vault.displayUri(photoId, mimeType) : null;
    } catch (error) {
      reportError(error, { area: 'photos' });
      return null;
    }
  }, [vault, photoId, mimeType]);
  if (!uri) return null;
  return <Image accessibilityLabel={label} accessibilityRole="image" source={{ uri }} style={{ width: '100%', height: size, resizeMode: 'contain' }} testID={`photo-image-${photoId}`} />;
}

/** The same outline over both photos (head, shoulders, hips, centre line) to line up pose and distance; drawn, not an image asset. */
function PoseGuide({ testID }: { testID: string }) {
  const theme = useTheme();
  const line = { position: 'absolute' as const, borderColor: theme.colors.focus };
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} testID={testID}>
      <View style={{ ...line, left: '50%', top: 0, bottom: 0, borderLeftWidth: 1, borderStyle: 'dashed' }} />
      <View style={{ ...line, left: '40%', width: '20%', top: '4%', height: '16%', borderWidth: 2, borderRadius: 999 }} />
      <View style={{ ...line, left: '25%', width: '50%', top: '24%', borderTopWidth: 2 }} />
      <View style={{ ...line, left: '32%', width: '36%', top: '55%', borderTopWidth: 2 }} />
    </View>
  );
}

interface BackupCardProps {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly total: number;
  readonly backed: number;
  /** MOB-02: whether the account already holds a backup (null: it could not be checked). */
  readonly hasExisting: () => Promise<boolean | null>;
  readonly onEnable: (code: string) => Promise<void>;
  readonly onRun: () => void;
  readonly onDisable: () => Promise<void>;
  readonly onRestore: (code: string) => Promise<void>;
  readonly newCode: () => string;
}

function BackupCard({ available, enabled, total, backed, hasExisting, onEnable, onRun, onDisable, onRestore, newCode }: BackupCardProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const [code, setCode] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'checking' | 'existing'>('idle');
  const [existingCode, setExistingCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [restoreCode, setRestoreCode] = useState('');
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <Card title={t('photos.backup.title')} testID="photos-backup">
      {!available ? (
        <Text style={text} testID="photos-backup-unavailable">
          {t('photos.backup.needsSignIn')}
        </Text>
      ) : enabled ? (
        <>
          <Text style={text} testID="photos-backup-status">
            {t('photos.backup.on', { backed, total })}
          </Text>
          <Button label={t('photos.backup.run')} onPress={onRun} testID="photos-backup-run" />
          <Button label={t('photos.backup.disable')} variant="danger" onPress={() => void onDisable()} testID="photos-backup-disable" />
        </>
      ) : stage === 'checking' ? (
        <Text accessibilityLiveRegion="polite" style={text} testID="photos-backup-checking">
          {t('photos.backup.checking')}
        </Text>
      ) : stage === 'existing' ? (
        <>
          <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
            {t('photos.backup.existing.title')}
          </Text>
          <Text style={text} testID="photos-backup-existing">
            {t('photos.backup.existing.body')}
          </Text>
          <Input label={t('photos.backup.existing.code')} hint={t('photos.backup.existing.codeHint')} value={existingCode} onChangeText={setExistingCode} autoComplete="off" testID="photos-backup-existing-code" />
          <Button
            label={t('photos.backup.existing.join')}
            disabled={existingCode.trim() === ''}
            onPress={() => {
              const c = existingCode;
              setExistingCode('');
              setStage('idle');
              void onEnable(c);
            }}
            testID="photos-backup-existing-join"
          />
          <Button
            label={t('photos.backup.existing.cancel')}
            variant="secondary"
            onPress={() => {
              setExistingCode('');
              setStage('idle');
            }}
            testID="photos-backup-existing-cancel"
          />
        </>
      ) : code === null ? (
        <>
          <Text style={text} testID="photos-backup-off">
            {t('photos.backup.off')}
          </Text>
          <Button
            label={t('photos.backup.enable')}
            hint={t('photos.backup.enableHint')}
            onPress={() => {
              // MOB-02: a new recovery code only when the account holds no backup yet.
              setStage('checking');
              void hasExisting().then((exists) => {
                setStage(exists === true ? 'existing' : 'idle');
                if (exists === false) setCode(newCode());
              });
            }}
            testID="photos-backup-enable"
          />
        </>
      ) : (
        <>
          <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
            {t('photos.backup.code.title')}
          </Text>
          <Text style={{ ...text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }} selectable testID="photos-backup-code">
            {code}
          </Text>
          <Text style={text}>{t('photos.backup.code.body')}</Text>
          <Toggle label={t('photos.backup.code.confirm')} value={confirmed} onValueChange={setConfirmed} testID="photos-backup-confirm" />
          <Button
            label={t('photos.backup.enable')}
            hint={t('photos.backup.enableHint')}
            disabled={!confirmed}
            onPress={() => {
              const c = code;
              setCode(null);
              setConfirmed(false);
              void onEnable(c);
            }}
            testID="photos-backup-start"
          />
        </>
      )}
      {available ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
            {t('photos.restore.title')}
          </Text>
          <Input label={t('photos.restore.code')} hint={t('photos.restore.codeHint')} value={restoreCode} onChangeText={setRestoreCode} autoComplete="off" testID="photos-restore-code" />
          <Button label={t('photos.restore.run')} variant="secondary" disabled={restoreCode.trim() === ''} onPress={() => void onRestore(restoreCode)} testID="photos-restore-run" />
        </View>
      ) : null}
    </Card>
  );
}
