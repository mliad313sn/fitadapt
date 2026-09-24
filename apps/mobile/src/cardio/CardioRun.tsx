import { cueSchedule, segmentAt, type CardioCue, type SegmentTime } from '@fitadapt/engine';
import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import type { CardioPlan, CardioSegment, HeartRateSample } from '@fitadapt/shared';
import { Button, Card, Chip, useTheme } from '@fitadapt/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { clock } from '../clock';
import { backgroundAudio, cueOutput } from './cue-output';
import { heartRateSource } from './heart-rate';
import { IntervalRunner, type Timers } from './interval-runner';

export interface CardioResult {
  readonly spent: SegmentTime[];
  readonly endedEarly: boolean;
  /** AMRAP: the rounds the user reported (null: not asked or skipped). */
  readonly rounds: number | null;
}

export interface CardioRunProps {
  readonly cardio: CardioPlan;
  readonly onFinished: (result: CardioResult) => void;
  /** Controls the parent keeps visible in every state (L4 stop, pain). */
  readonly controls: ReactNode;
  /** Set to true to end the block now (e.g. a red pain rating during it). */
  readonly endRequested?: boolean;
  /** Test seam: the timers the runner aims its cues with. */
  readonly timers?: Timers;
}

const nowMs = () => clock.now().getTime();

function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Runs a cardio block eyes-free: the engine's cue schedule is played by the
 * wall-clock IntervalRunner through the system voice (FR/EN) and haptics,
 * with the screen as a large, glanceable repeat (step, countdown, round,
 * movement, effort target). The audio session is set to keep playing with
 * the screen locked. Pause, skip a step and skip the block are always there
 * (L4), next to the parent's stop control.
 */
export function CardioRun({ cardio, onFinished, controls, endRequested, timers }: CardioRunProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const cues = useMemo(() => cueSchedule(cardio), [cardio]);
  const [, setFrame] = useState(0);
  const [askRounds, setAskRounds] = useState<SegmentTime[] | null>(null);
  const [live, setLive] = useState<HeartRateSample | null>(null);
  const runner = useRef<IntervalRunner | null>(null);
  const done = useRef(false);
  // The latest callback (the parent's run state changes while the block runs).
  const report = useRef(onFinished);
  report.current = onFinished;
  const name = (id: string | null) => (id ? t(`exercise.${id}.name` as MessageKey) : t('cardio.run.anyMovement'));
  const speechOf = (cue: CardioCue) => t(cue.speech as MessageKey, { ...cue.params, exercise: name(cue.exerciseId) });

  const finish = (endedEarly: boolean) => {
    const r = runner.current;
    if (!r || done.current) return;
    r.stop();
    const spent = r.spent();
    if (cardio.protocol === 'amrap' && !endedEarly) {
      setAskRounds(spent);
      return;
    }
    done.current = true;
    report.current({ spent, endedEarly, rounds: null });
  };

  useEffect(() => {
    void backgroundAudio().enable();
    const r = new IntervalRunner({
      cues,
      totalSeconds: cardio.totalSeconds,
      segments: cardio.timeline,
      now: nowMs,
      timers,
      onCue: (cue) => {
        const out = cueOutput();
        if (cue.haptic) out.haptic(cue.haptic);
        out.speak(speechOf(cue), locale);
        setFrame((f) => f + 1);
      },
      onFinish: () => finish(false),
    });
    runner.current = r;
    r.start();
    const refresh = setInterval(() => setFrame((f) => f + 1), 250);
    const sub = AppState.addEventListener('change', (state) => {
      // Back in the foreground: re-aim from the clock (a suspended JS thread catches up; stale countdowns are not replayed).
      if (state === 'active') {
        r.resync();
        setFrame((f) => f + 1);
      }
    });
    const unsubscribe = heartRateSource().subscribe?.((sample) => setLive(sample));
    return () => {
      clearInterval(refresh);
      sub.remove();
      unsubscribe?.();
      r.stop();
      cueOutput().stop();
      void backgroundAudio().disable();
    };
    // The block is fixed for the life of this component.
  }, [cardio]);

  useEffect(() => {
    if (endRequested) finish(true);
  }, [endRequested]);

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;

  if (askRounds) {
    return (
      <Card title={t('cardio.run.rounds')} testID="cardio-rounds">
        {controls}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {Array.from({ length: 16 }, (_, i) => i).map((n) => (
            <Chip
              key={n}
              label={t('cardio.run.roundsChip', { count: n })}
              selected={false}
              onPress={() => {
                done.current = true;
                report.current({ spent: askRounds, endedEarly: false, rounds: n });
              }}
              testID={`cardio-rounds-${n}`}
            />
          ))}
        </View>
        <Button
          label={t('cardio.run.skip')}
          hint={t('cardio.run.skipHint')}
          variant="secondary"
          onPress={() => {
            done.current = true;
            report.current({ spent: askRounds, endedEarly: false, rounds: null });
          }}
          testID="cardio-rounds-skip"
        />
      </Card>
    );
  }

  const r = runner.current;
  const elapsed = r ? r.elapsedMs() : 0;
  const at = segmentAt(cardio, elapsed / 1000);
  const segment: CardioSegment = at?.segment ?? cardio.timeline[cardio.timeline.length - 1]!;
  const remainingMs = at ? Math.max(0, (segment.startSeconds + segment.durationSeconds) * 1000 - elapsed) : 0;
  const next = cardio.timeline[segment.index + 1];
  const zone = cardio.zones.zones.find((z) => z.intensity === segment.intensity)!;
  const aim =
    zone.minBpm !== null && zone.maxBpm !== null
      ? `${t(`cardio.zone.${zone.intensity}` as MessageKey)} · ${t('cardio.zone.bpm', { min: zone.minBpm, max: zone.maxBpm })}`
      : `${t(`cardio.zone.${zone.intensity}` as MessageKey)} · ${t('cardio.zone.rpe', { min: zone.rpeMin, max: zone.rpeMax })}`;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <View style={{ gap: theme.spacing.lg }} testID="cardio-run">
      {controls}
      <Card title={t(`cardio.segment.${segment.kind}` as MessageKey)} testID={`cardio-segment-${segment.index}`}>
        <Text
          accessibilityRole="timer"
          accessibilityLabel={t('ui.timer.remaining', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })}
          style={{ color: theme.colors.text, fontSize: theme.fontSize.display, fontWeight: theme.fontWeight.bold, fontVariant: ['tabular-nums'] }}
          testID="cardio-remaining"
        >
          {clockText(remainingMs)}
        </Text>
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="cardio-movement">
          {segment.kind === 'amrap' ? cardio.movements.map((m) => name(m.exerciseId)).join(' · ') : name(segment.exerciseId)}
        </Text>
        {segment.round !== null && segment.rounds !== null ? <Text style={text}>{t('cardio.run.round', { round: segment.round, rounds: segment.rounds })}</Text> : null}
        {segment.reps !== null ? <Text style={text}>{t('cardio.run.reps', { reps: segment.reps })}</Text> : null}
        <Text style={text} testID="cardio-aim">
          {t('cardio.run.aim', { zone: aim })}
        </Text>
        <Text style={muted}>{t(`cardio.talk.${zone.talkTest}` as MessageKey)}</Text>
        {live ? <Text style={text} testID="cardio-live-hr">{t('cardio.run.liveHr', { bpm: live.bpm })}</Text> : null}
        {next ? <Text style={muted}>{t('cardio.run.next', { step: `${t(`cardio.segment.${next.kind}` as MessageKey)} · ${next.kind === 'amrap' ? '' : name(next.exerciseId)}`.replace(/ · $/, '') })}</Text> : null}
        {r?.isPaused ? (
          <Text accessibilityLiveRegion="polite" style={text} testID="cardio-paused">
            {t('cardio.run.paused')}
          </Text>
        ) : null}
      </Card>
      <View style={{ gap: theme.spacing.sm }}>
        {r?.isPaused ? (
          <Button label={t('cardio.run.resume')} hint={t('cardio.run.resumeHint')} onPress={() => (r.resume(), setFrame((f) => f + 1))} testID="cardio-resume" />
        ) : (
          <Button label={t('cardio.run.pause')} hint={t('cardio.run.pauseHint')} variant="secondary" onPress={() => (r?.pause(), setFrame((f) => f + 1))} testID="cardio-pause" />
        )}
        <Button label={t('cardio.run.skip')} hint={t('cardio.run.skipHint')} variant="secondary" onPress={() => next ? (r?.skipTo(next.startSeconds), setFrame((f) => f + 1)) : finish(true)} testID="cardio-skip" />
        <Button label={t('cardio.run.skipBlock')} hint={t('cardio.run.skipBlockHint')} variant="secondary" onPress={() => finish(true)} testID="cardio-skip-block" />
      </View>
      <Text style={muted}>{t('cardio.preview.eyesFree')}</Text>
    </View>
  );
}
