import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { notice, renderNotice } from '@fitadapt/legal';
import { JOINTS, RED_FLAG_SYMPTOMS, type Joint, type RedFlagSymptom, type SessionPlan } from '@fitadapt/shared';
import { Button, Card, Chip, useTheme } from '@fitadapt/ui';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLegal } from '../profile/ProfileProvider';

/**
 * M05 cards of the workout screen: the S3 seek-care guidance (with the
 * jurisdiction's emergency number from packages/legal), the optional
 * 10-second readiness check with its red-flag screen, the pain check after
 * a session, the next-morning check, and what the warm-up is. The screen
 * only gathers answers; packages/safety and packages/engine decide.
 */

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** S3: stop and seek care — the notice (L3, every time), the emergency guidance of the jurisdiction, an acknowledgement. */
export function SeekCare({ after }: { after?: string }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const impressions = useLegal((s) => s.notices);
  const recordNotice = useLegal((s) => s.recordNotice);
  const seekCare = renderNotice(notice('seek_care'), locale, jurisdiction);
  const acknowledged = impressions.some((i) => i.noticeId === 'seek_care' && i.kind === 'acknowledged');
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <Card title={seekCare.title} testID="notice-seek_care">
      <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{seekCare.draftBanner}</Text>
      <Text style={text}>{seekCare.body}</Text>
      {seekCare.emergency ? (
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="notice-seek_care-emergency">
          {seekCare.emergency}
        </Text>
      ) : null}
      {after ? <Text style={text}>{after}</Text> : null}
      {!acknowledged ? <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => recordNotice(notice('seek_care'), 'acknowledged', locale)} testID="notice-seek_care-ack" /> : null}
    </Card>
  );
}

type Answer = 'sleep' | 'soreness' | 'stress' | 'energy';
const QUESTIONS: readonly Answer[] = ['sleep', 'soreness', 'stress', 'energy'];

/** The optional 10-second readiness check (never blocking: it can be skipped) and the red-flag screen. */
export function ReadinessCheckCard({ onSave, onSkip, onRedFlag }: { onSave: (answers: Record<Answer, number>) => void; onSkip: () => void; onRedFlag: (s: RedFlagSymptom) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [answers, setAnswers] = useState<Partial<Record<Answer, number>>>({});
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const complete = QUESTIONS.every((q) => answers[q] !== undefined);
  return (
    <Card title={t('recovery.readiness.title')} testID="recovery-readiness">
      <Text style={muted}>{t('recovery.readiness.intro')}</Text>
      {QUESTIONS.map((q) => (
        <View key={q} style={{ gap: theme.spacing.xs }}>
          <Text style={text}>{t(`recovery.readiness.${q}` as MessageKey)}</Text>
          <Text style={muted}>
            {t(`recovery.readiness.${q}.low` as MessageKey)} · {t(`recovery.readiness.${q}.high` as MessageKey)}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {range(1, 5).map((v) => (
              <Chip key={v} label={t('recovery.readiness.chip', { value: v })} hint={t('recovery.readiness.chipHint', { value: v })} selected={answers[q] === v} onPress={() => setAnswers({ ...answers, [q]: v })} testID={`recovery-readiness-${q}-${v}`} />
            ))}
          </View>
        </View>
      ))}
      <Button label={t('recovery.readiness.save')} hint={t('recovery.readiness.saveHint')} disabled={!complete} onPress={() => complete && onSave(answers as Record<Answer, number>)} testID="recovery-readiness-save" />
      <Button label={t('recovery.readiness.skip')} hint={t('recovery.readiness.skipHint')} variant="secondary" onPress={onSkip} testID="recovery-readiness-skip" />
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('recovery.redFlag.checkin.title')}</Text>
      <Text style={muted}>{t('recovery.redFlag.checkin.body')}</Text>
      {RED_FLAG_SYMPTOMS.map((s) => (
        <Button key={s} label={t(`workout.stop.symptom.${s}` as MessageKey)} hint={t('recovery.redFlag.checkin.symptomHint')} variant="danger" onPress={() => onRedFlag(s)} testID={`recovery-redflag-${s}`} />
      ))}
    </Card>
  );
}

/** After a session: "how do your joints feel?" (0–10 per joint, optional). */
export function PainCheck({ onSave, onDone }: { onSave: (joint: Joint, score: number) => void; onDone: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [joint, setJoint] = useState<Joint | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <Card title={t('recovery.pain.after.title')} testID="recovery-pain-after">
      <Text style={text}>{t('recovery.pain.after.body')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {JOINTS.map((j) => (
          <Chip key={j} label={t(`library.joint.${j}` as MessageKey)} selected={joint === j} onPress={() => setJoint(j)} testID={`recovery-pain-joint-${j}`} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {range(0, 10).map((n) => (
          <Chip key={n} label={t('workout.pain.scoreChip', { score: n })} selected={score === n} onPress={() => setScore(n)} testID={`recovery-pain-score-${n}`} />
        ))}
      </View>
      <Button
        label={t('recovery.pain.after.save')}
        hint={t('recovery.pain.after.saveHint')}
        disabled={joint === null || score === null}
        onPress={() => {
          if (joint === null || score === null) return;
          onSave(joint, score);
          setJoint(null);
          setScore(null);
        }}
        testID="recovery-pain-save"
      />
      <Button label={t('recovery.pain.after.skip')} hint={t('recovery.pain.after.skipHint')} variant="secondary" onPress={onDone} testID="recovery-pain-done" />
    </Card>
  );
}

/** The next-morning check for the joints rated yesterday: pain now (0–10) and "back to how it usually is?". */
export function MorningCheck({ joints, onSave, onSkip }: { joints: readonly Joint[]; onSave: (answers: { joint: Joint; score: number; settled: boolean }[]) => void; onSkip: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [answers, setAnswers] = useState<Partial<Record<Joint, { score?: number; settled?: boolean }>>>({});
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const complete = joints.every((j) => answers[j]?.score !== undefined && answers[j]?.settled !== undefined);
  const set = (j: Joint, patch: { score?: number; settled?: boolean }) => setAnswers({ ...answers, [j]: { ...answers[j], ...patch } });
  return (
    <Card title={t('recovery.pain.morning.title')} testID="recovery-morning">
      <Text style={text}>{t('recovery.pain.morning.body')}</Text>
      {joints.map((j) => (
        <View key={j} style={{ gap: theme.spacing.xs }}>
          <Text style={text}>{t(`recovery.pain.morning.joint.${j}` as MessageKey)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {range(0, 10).map((n) => (
              <Chip key={n} label={t('workout.pain.scoreChip', { score: n })} selected={answers[j]?.score === n} onPress={() => set(j, { score: n })} testID={`recovery-morning-${j}-score-${n}`} />
            ))}
          </View>
          <Text style={text}>{t('recovery.pain.morning.settled')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Chip label={t('recovery.pain.morning.settledYes')} selected={answers[j]?.settled === true} onPress={() => set(j, { settled: true })} testID={`recovery-morning-${j}-settled-yes`} />
            <Chip label={t('recovery.pain.morning.settledNo')} selected={answers[j]?.settled === false} onPress={() => set(j, { settled: false })} testID={`recovery-morning-${j}-settled-no`} />
          </View>
        </View>
      ))}
      <Button
        label={t('recovery.pain.morning.save')}
        hint={t('recovery.pain.morning.saveHint')}
        disabled={!complete}
        onPress={() => complete && onSave(joints.map((j) => ({ joint: j, score: answers[j]!.score!, settled: answers[j]!.settled! })))}
        testID="recovery-morning-save"
      />
      <Button label={t('recovery.pain.morning.skip')} hint={t('recovery.pain.morning.skipHint')} variant="secondary" onPress={onSkip} testID="recovery-morning-skip" />
    </Card>
  );
}

/** What the warm-up is: general movement, ramp-up sets before the first heavy lift, mobility for today's patterns. */
export function WarmUpDetails({ plan, name, mass }: { plan: SessionPlan; name: (id: string) => string; mass: (kg: number) => string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const w = plan.warmUp.content!;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  return (
    <Card title={t('recovery.warmup.title', { minutes: plan.warmUp.minutes })} testID="recovery-warmup">
      <Text style={muted} testID="recovery-warmup-general">
        {w.general.exerciseId ? t('recovery.warmup.general', { exercise: name(w.general.exerciseId), seconds: w.general.seconds }) : t('recovery.warmup.generalAny', { seconds: w.general.seconds })}
      </Text>
      {w.mobility.map((d) => (
        <Text key={d.exerciseId} style={muted} testID={`recovery-warmup-drill-${d.exerciseId}`}>
          {t('recovery.warmup.drill', { exercise: name(d.exerciseId), seconds: d.seconds })}
        </Text>
      ))}
      {w.rampUp ? (
        <View testID="recovery-warmup-ramp">
          <Text style={muted}>{t('recovery.warmup.ramp', { exercise: name(w.rampUp.exerciseId) })}</Text>
          {w.rampUp.sets.map((s) => (
            <Text key={s.percent} style={muted}>
              {s.loadKg > 0 ? t('recovery.warmup.rampSet', { reps: s.reps, load: mass(s.loadKg) }) : t('recovery.warmup.rampSetNoLoad', { reps: s.reps })}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
