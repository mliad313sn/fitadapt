import { runCoachTurn } from '@fitadapt/coach';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { isMessageKey, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { AI_PERSISTENT_LABEL, notice, renderNotice } from '@fitadapt/legal';
import type { CoachAction, CoachReply, ExecutionLog, ReflowRecord } from '@fitadapt/shared';
import { Button, Card, Input, useTheme } from '@fitadapt/ui';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { CoachRequestError } from '../coach/coach-client';
import { useCoach } from '../coach/CoachProvider';
import { useCoachContext } from '../coach/use-coach-context';
import { useFeature } from '../privacy/PrivacyProvider';
import { useLegal, useProfile } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { SeekCare } from '../workout/RecoveryCards';

export interface CoachScreenProps {
  onExit?: () => void;
  onOpenPrivacy?: () => void;
  onOpenWorkout?: () => void;
}

type Message =
  | { readonly id: string; readonly role: 'disclosure' }
  | { readonly id: string; readonly role: 'user'; readonly text: string }
  | { readonly id: string; readonly role: 'coach'; readonly reply: CoachReply; readonly actions: readonly CoachAction[] };

interface Conversation {
  /** The server's id, or null when the conversation runs on the device (offline). */
  readonly serverId: string | null;
  readonly messages: readonly Message[];
}

/**
 * M11 AI coach (ADR-031). L5: the "AI assistant" label is always on screen,
 * and every conversation opens with the AI disclosure (the M20 `ai_coach`
 * notice), recorded in the device ledger each time. Online, the API runs the
 * model; offline (or when the API cannot answer) the same coach runs on the
 * device without a model: the app's guide, the plan's reasons and the
 * engine's deterministic actions. A red flag in chat starts the M05 stop
 * flow here at once (session ended, seek-care guidance, intensity locked).
 * The coach never writes a prescription: a time or lighter-day change is the
 * engine's plan, used only if the user taps "Use this for today".
 */
export function CoachScreen({ onExit, onOpenPrivacy, onOpenWorkout }: CoachScreenProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const allowed = useFeature('ai_coach.chat');
  const { client, adjustments } = useCoach();
  const buildContext = useCoachContext(locale);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const recordNotice = useLegal((s) => s.recordNotice);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const logExecution = useProfile((s) => s.logExecution);
  const saveReflow = useProfile((s) => s.saveReflow);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [offline, setOffline] = useState(false);
  const [notice429, setNotice429] = useState(false);
  const [seekCare, setSeekCare] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const busy = useRef(false);

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const disclosure = renderNotice(notice('ai_coach'), locale, jurisdiction);

  const startConversation = useCallback(async () => {
    // L5: every conversation starts with the AI disclosure, recorded as shown (device ledger, L11).
    recordNotice(notice('ai_coach'), 'shown', locale);
    let serverId: string | null = null;
    if (client) {
      try {
        serverId = (await client.start(locale, jurisdiction)).conversationId;
        setOffline(false);
      } catch {
        setOffline(true);
      }
    } else setOffline(true);
    setConversation({ serverId, messages: [{ id: randomUUID(), role: 'disclosure' }] });
    setSeekCare(false);
    setApplied(null);
  }, [client, locale, jurisdiction, recordNotice]);

  useEffect(() => {
    if (allowed && !conversation) void startConversation();
  }, [allowed, conversation, startConversation]);

  /** What the engine decided, applied on the device. Records the server already stored are not written twice. */
  const handleActions = (actions: readonly CoachAction[], storedOnServer: boolean) => {
    for (const a of actions) {
      if (a.type === 'red_flag_stop') {
        // M05 stop flow (S3), on the device at once: the lock applies even before the next sync.
        logExecution(a.log);
        logSafetyEvent({ invariant: 'S3', reasonCode: `safety.s3.${a.symptom}`, action: 'session_ended', engineVersion: ENGINE_VERSION });
        logSafetyEvent({ invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: ENGINE_VERSION });
        recordNotice(notice('seek_care'), 'shown', locale);
        setSeekCare(true);
      } else if (a.type === 'record' && !storedOnServer) {
        if (a.collection === 'execution_logs') logExecution(a.data as unknown as ExecutionLog);
        else saveReflow(a.data as unknown as ReflowRecord);
      }
    }
  };

  const localTurn = async (message: string, history: readonly Message[]) => {
    const out = await runCoachTurn({
      text: message,
      context: buildContext(),
      history: history.flatMap((m) => (m.role === 'user' ? [{ role: 'user' as const, text: m.text }] : [])),
      model: null,
      env: { nowMs: clock.now().getTime(), seed: Math.floor(clock.now().getTime() / 1000) % 2_147_483_647, newId: randomUUID },
      noModelSource: 'offline',
    });
    return out.result;
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || !conversation || busy.current) return;
    busy.current = true;
    setDraft('');
    const before = conversation.messages;
    const withUser: Message[] = [...before, { id: randomUUID(), role: 'user', text: message }];
    setConversation({ ...conversation, messages: withUser });
    let result: { reply: CoachReply; actions: readonly CoachAction[] };
    let storedOnServer = false;
    if (client && conversation.serverId && !offline) {
      try {
        result = await client.send(conversation.serverId, message, buildContext());
        storedOnServer = true;
      } catch (error) {
        // Offline, rate-limited or the API unavailable: the coach answers on the device (workouts are unaffected).
        setNotice429(error instanceof CoachRequestError && error.status === 429);
        setOffline(!(error instanceof CoachRequestError && error.status === 429));
        result = await localTurn(message, before);
      }
    } else result = await localTurn(message, before);
    handleActions(result.actions, storedOnServer);
    setConversation((c) => (c ? { ...c, messages: [...withUser, { id: randomUUID(), role: 'coach', reply: result.reply, actions: result.actions }] } : c));
    busy.current = false;
  };

  const render = (reply: CoachReply) =>
    reply.parts
      .map((p) => {
        if (p.kind === 'model') return p.text;
        if (!isMessageKey(p.key)) return '';
        const values = Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, typeof v === 'object' ? (isMessageKey(v.key) ? t(v.key as MessageKey) : '') : v]));
        return t(p.key as MessageKey, values);
      })
      .filter(Boolean)
      .join(' ');
  const refName = (id: string) => {
    const key = id.startsWith('kb.') ? `coach.kb.${id.slice(3)}.title` : `exercise.${id.slice('exercise.'.length)}.name`;
    return isMessageKey(key) ? t(key as MessageKey) : '';
  };
  const apply = (a: Extract<CoachAction, { type: 'session_proposal' }>) => {
    const today = localIsoDate(clock.now());
    if (a.change === 'time') adjustments.getState().apply({ date: today, minutes: a.input.minutesAvailable });
    else if (a.change === 'deload') adjustments.getState().apply({ date: today, readiness: 'reduced' });
    setApplied(a.plan.planId);
  };

  const label = (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
      <Text style={{ ...text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>{t('coach.title')}</Text>
      {/* L5: persistent AI label, on screen in every state. */}
      <Text accessibilityLabel={t(AI_PERSISTENT_LABEL)} style={{ ...muted, fontWeight: theme.fontWeight.bold, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.sm }} testID="coach-ai-label">
        {t(AI_PERSISTENT_LABEL)}
      </Text>
    </View>
  );

  if (!allowed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="coach-consent-needed">
          {label}
          <Text style={text}>{t('coach.consent.needed')}</Text>
          {onOpenPrivacy ? <Button label={t('coach.consent.open')} hint={t('coach.consent.openHint')} onPress={onOpenPrivacy} testID="coach-open-privacy" /> : null}
          {onExit ? <Button label={t('coach.exit')} variant="secondary" onPress={onExit} testID="coach-exit" /> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="coach-screen">
        {label}
        <Text style={muted}>{t('coach.subtitle')}</Text>
        {offline ? (
          <Text style={muted} testID="coach-offline">
            {t('coach.offline.banner')}
          </Text>
        ) : null}
        {notice429 ? (
          <Text style={muted} testID="coach-rate-limited">
            {t('coach.error.rateLimited')}
          </Text>
        ) : null}
        {(conversation?.messages ?? []).map((m) => {
          if (m.role === 'disclosure') {
            return (
              <Card key={m.id} title={disclosure.title} testID="coach-disclosure">
                <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{disclosure.draftBanner}</Text>
                <Text style={text}>{disclosure.body}</Text>
              </Card>
            );
          }
          if (m.role === 'user') {
            return (
              <Text key={m.id} style={{ ...text, alignSelf: 'flex-end' }} testID="coach-user-message">
                {t('coach.message.user', { text: m.text })}
              </Text>
            );
          }
          const proposal = m.actions.find((a): a is Extract<CoachAction, { type: 'session_proposal' }> => a.type === 'session_proposal' && a.change !== 'pain');
          const swap = m.actions.find((a) => a.type === 'swap_proposal');
          const refs = m.reply.references.map(refName).filter(Boolean);
          return (
            <Card key={m.id} testID="coach-reply">
              <Text style={text}>{t('coach.message.coach', { text: render(m.reply) })}</Text>
              {refs.length ? (
                <Text style={muted} testID="coach-references">
                  {t('coach.references', { list: refs.join(', ') })}
                </Text>
              ) : null}
              {proposal && applied !== proposal.plan.planId ? <Button label={t('coach.action.apply')} hint={t('coach.action.applyHint')} onPress={() => apply(proposal)} testID="coach-apply" /> : null}
              {proposal && applied === proposal.plan.planId ? (
                <Text style={muted} testID="coach-applied">
                  {t('coach.action.applied')}
                </Text>
              ) : null}
              {(swap || proposal) && onOpenWorkout ? <Button label={t('coach.action.open')} hint={t('coach.action.openHint')} variant="secondary" onPress={onOpenWorkout} testID="coach-open-workout" /> : null}
            </Card>
          );
        })}
        {seekCare ? <SeekCare /> : null}
        <Input label={t('coach.input.label')} hint={t('coach.input.placeholder')} value={draft} onChangeText={setDraft} testID="coach-input" />
        <Button label={t('coach.send')} hint={t('coach.sendHint')} onPress={() => void send()} disabled={!conversation || draft.trim().length === 0} testID="coach-send" />
        <Button label={t('coach.newConversation')} hint={t('coach.newConversationHint')} variant="secondary" onPress={() => void startConversation()} testID="coach-new" />
        {onExit ? <Button label={t('coach.exit')} variant="secondary" onPress={onExit} testID="coach-exit" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
