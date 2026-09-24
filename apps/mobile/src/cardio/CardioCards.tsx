import type { AerobicMinutesLedger, CardioPlan, CardioProtocol } from '@fitadapt/shared';
import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { Button, Card, Chip, Stepper, useTheme } from '@fitadapt/ui';
import { Text, View } from 'react-native';
import { useManualHeartRate } from './heart-rate';

/** The protocols offered on the cardio screen (custom work/rest is engine-only for now: docs/status/M03.md). */
export const CARDIO_SCREEN_PROTOCOLS: readonly CardioProtocol[] = ['steady', 'hiit', 'tabata', 'emom', 'amrap'];

export interface CardioOptionsProps {
  readonly protocol: CardioProtocol;
  readonly onProtocol: (p: CardioProtocol) => void;
  /** Protocols the gates refuse today (HIIT and Tabata before S1 clearance or two weeks of training). */
  readonly locked: readonly CardioProtocol[];
  /** The low-impact default applies (knee/ankle/hip flag, BMI ≥ 35): offer the opt-up. */
  readonly lowImpactDefault: boolean;
  readonly impactOptIn: boolean;
  readonly onImpactOptIn: (v: boolean) => void;
  /** A wearable (M12) provides the resting heart rate: no manual entry. */
  readonly wearable: boolean;
}

/** Cardio choices: type, impact opt-up, optional resting heart rate. Every control is labelled (≥ 48 dp through packages/ui). */
export function CardioOptions({ protocol, onProtocol, locked, lowImpactDefault, impactOptIn, onImpactOptIn, wearable }: CardioOptionsProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const resting = useManualHeartRate((s) => s.restingBpm);
  const setResting = useManualHeartRate((s) => s.setRestingBpm);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const title = { color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold } as const;
  return (
    <View style={{ gap: theme.spacing.md }} testID="cardio-options">
      <Text style={title}>{t('cardio.protocol.title')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {CARDIO_SCREEN_PROTOCOLS.map((p) => {
          const label = t(`cardio.protocol.${p}` as MessageKey);
          return <Chip key={p} label={locked.includes(p) ? t('cardio.protocol.locked', { protocol: label }) : label} hint={t('cardio.protocol.hint')} selected={protocol === p} onPress={() => onProtocol(p)} testID={`cardio-protocol-${p}`} />;
        })}
      </View>
      {lowImpactDefault ? (
        impactOptIn ? (
          <Button label={t('cardio.impact.optDown')} hint={t('cardio.impact.optDownHint')} variant="secondary" onPress={() => onImpactOptIn(false)} testID="cardio-impact-down" />
        ) : (
          <Button label={t('cardio.impact.optUp')} hint={t('cardio.impact.optUpHint')} variant="secondary" onPress={() => onImpactOptIn(true)} testID="cardio-impact-up" />
        )
      ) : null}
      <Card title={t('cardio.hr.title')} testID="cardio-hr">
        {wearable ? (
          <Text style={text}>{t('cardio.hr.source.wearable')}</Text>
        ) : resting === null ? (
          <>
            <Text style={text}>{t('cardio.hr.none')}</Text>
            <Button label={t('cardio.hr.add')} hint={t('cardio.hr.addHint')} variant="secondary" onPress={() => setResting(60)} testID="cardio-hr-add" />
          </>
        ) : (
          <>
            <Stepper label={t('cardio.hr.restingLabel')} value={resting} step={1} min={30} max={120} onChange={(v) => setResting(Math.round(v))} testID="cardio-hr-resting" />
            <Button label={t('cardio.hr.clear')} hint={t('cardio.hr.clearHint')} variant="secondary" onPress={() => setResting(null)} testID="cardio-hr-clear" />
          </>
        )}
      </Card>
    </View>
  );
}

/** What the cardio block is: structure, movements, the effort guide (heart rate or effort and talk test). */
export function CardioSummary({ cardio, name }: { cardio: CardioPlan; name: (id: string) => string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const main = cardio.timeline.filter((s) => s.kind !== 'warm_up' && s.kind !== 'cool_down');
  const mainMinutes = Math.round(main.reduce((s, x) => s + x.durationSeconds, 0) / 60);
  const i = cardio.interval;
  const structure =
    cardio.protocol === 'tabata' && i
      ? t('cardio.preview.blocks', { blocks: i.blocks, rounds: i.rounds, work: i.workSeconds, rest: i.restSeconds })
      : cardio.protocol === 'emom' && i
        ? t('cardio.preview.emom', { rounds: i.rounds, reps: main[0]?.reps ?? 1 })
        : cardio.protocol === 'amrap'
          ? t('cardio.preview.amrap', { minutes: mainMinutes, reps: main[0]?.reps ?? 1 })
          : i
            ? t('cardio.preview.intervals', { rounds: i.rounds, work: i.workSeconds, rest: i.restSeconds })
            : t('cardio.preview.steady', { minutes: mainMinutes });
  const target = cardio.zones.zones.find((z) => z.intensity === cardio.targetIntensity)!;
  return (
    <Card title={t(`cardio.protocol.${cardio.protocol}` as MessageKey)} testID="cardio-summary">
      <Text style={text} testID="cardio-structure">
        {structure}
      </Text>
      <Text style={muted}>{t('cardio.preview.total', { minutes: Math.round(cardio.totalSeconds / 60) })}</Text>
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('cardio.preview.movements')}</Text>
      {cardio.movements.length > 0 ? (
        cardio.movements.map((m) => (
          <Text key={m.exerciseId} style={text} testID={`cardio-movement-${m.exerciseId}`}>
            {name(m.exerciseId)}
          </Text>
        ))
      ) : (
        <Text style={text}>{t('cardio.preview.anyEasy')}</Text>
      )}
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('cardio.zone.title')}</Text>
      <Text style={text} testID="cardio-zone">
        {t(`cardio.zone.${target.intensity}` as MessageKey)}
        {target.minBpm !== null && target.maxBpm !== null ? ` · ${t('cardio.zone.bpm', { min: target.minBpm, max: target.maxBpm })}` : ''}
        {` · ${t('cardio.zone.rpe', { min: target.rpeMin, max: target.rpeMax })}`}
      </Text>
      <Text style={muted}>{t(`cardio.talk.${target.talkTest}` as MessageKey)}</Text>
      {cardio.zones.hrMaxBpm !== null ? <Text style={muted}>{t('cardio.zone.hrMax', { bpm: cardio.zones.hrMaxBpm })}</Text> : null}
      {[...cardio.zones.reasonCodes, ...cardio.reasonCodes.filter((c) => c.startsWith('cardio.impact.') || c.startsWith('cardio.movement.'))].map((code) => (
        <Text key={code} style={muted}>
          {t(`engine.reason.${code}` as MessageKey)}
        </Text>
      ))}
      <Text style={muted}>{t('cardio.preview.eyesFree')}</Text>
    </Card>
  );
}

/** The week's aerobic minutes against the WHO range (vigorous minutes count double). */
export function AerobicLedgerCard({ ledger }: { ledger: AerobicMinutesLedger }) {
  const { t } = useI18n();
  const theme = useTheme();
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  return (
    <Card title={t('cardio.ledger.title')} testID="cardio-ledger">
      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="cardio-ledger-summary">
        {t('cardio.ledger.summary', { minutes: Math.round(ledger.equivalentMinutes), min: ledger.targetMin, max: ledger.targetMax })}
      </Text>
      <Text style={text} testID="cardio-ledger-detail">
        {t('cardio.ledger.detail', { mod: Math.round(ledger.moderateMinutes), vig: Math.round(ledger.vigorousMinutes) })}
      </Text>
      {ledger.reasonCodes.map((code) => (
        <Text key={code} style={muted}>
          {t(`engine.reason.${code}` as MessageKey)}
        </Text>
      ))}
    </Card>
  );
}
