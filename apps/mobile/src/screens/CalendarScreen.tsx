import { addDays, createEngineContext, effectiveWeeks, reflowRecord, weekdayOf, type EffectiveSession } from '@fitadapt/engine';
import { generateProgram } from '@fitadapt/exercise-library';
import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import type { IsoDate, ReflowOutcome } from '@fitadapt/shared';
import { Button, Card, useTheme } from '@fitadapt/ui';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { programInputFrom, programReason } from '../program/program-input';
import { useLegal, useProfile, useProgram, useReflows, useSafetyProfile } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';

export interface CalendarScreenProps {
  onExit: () => void;
}

/** A deterministic engine seed per generation (recorded in the program; the engine itself never reads the clock). */
const seedFrom = (ms: number) => Math.floor(ms / 1000) % 2_147_483_647;

/**
 * M08 calendar: the week of the current program, built and reflowed on the
 * device by the engine (offline; records sync later). A session the user
 * cannot do is shifted, merged or skipped by the engine's reflow rules, and
 * the copy that follows never blames or pressures (no-guilt, FR/EN).
 */
export function CalendarScreen({ onExit }: CalendarScreenProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const profile = useProfile((s) => s.profile);
  const equipment = useProfile((s) => s.equipment);
  const saveProgram = useProfile((s) => s.saveProgram);
  const saveReflow = useProfile((s) => s.saveReflow);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const safetyProfile = useSafetyProfile();
  const record = useProgram();
  const reflows = useReflows();
  const today = localIsoDate(clock.now());
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const program = record?.program ?? null;
  const weeks = useMemo(() => (program ? effectiveWeeks(program, reflows) : []), [program, reflows]);
  const currentIndex = Math.max(0, weeks.findIndex((w) => w.microcycle.startDate <= today && today <= w.microcycle.endDate));
  const index = Math.min(weeks.length - 1, Math.max(0, currentIndex + offset));
  const week = weeks[index];
  const needsProgram = profile !== null && (program === null || program.goal !== profile.goals.primary || today > program.endDate);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const dayName = (date: IsoDate) => t(`weekday.${weekdayOf(date)}` as MessageKey);
  const dayLabel = (date: IsoDate) => t('calendar.day', { day: dayName(date), date: Number(date.slice(8, 10)) });
  const focusName = (s: EffectiveSession) => t(`calendar.focus.${s.focus}` as MessageKey);

  const build = () => {
    if (!profile) return;
    const now = clock.now().getTime();
    const input = programInputFrom(profile, safetyProfile, equipment, today, record);
    const result = generateProgram(input, createEngineContext({ clock: { now: () => now }, seed: seedFrom(now) }));
    if (result.status !== 'ok') {
      setUnavailable(result.reasonCodes[result.reasonCodes.length - 1]!);
      return;
    }
    setUnavailable(null);
    // L11: the S1 caps the program applied go to the device defensibility buffer; the server logs the program on sync.
    for (const event of result.safetyEvents) logSafetyEvent(event);
    saveProgram({ reason: programReason(record, profile), input, program: result.program });
    setOffset(0);
    setMessage(null);
  };

  const cantMakeIt = (session: EffectiveSession) => {
    if (!program) return;
    const now = clock.now().getTime();
    const decided = reflowRecord(program, reflows, session.id, today, createEngineContext({ clock: { now: () => now }, seed: seedFrom(now) }));
    if (!decided) return;
    saveReflow(decided);
    setMessage(reflowMessage(decided.outcome, decided.reasonCodes, session));
  };

  const reflowMessage = (outcome: ReflowOutcome, reasonCodes: readonly string[], session: EffectiveSession): string => {
    const name = focusName(session);
    if (outcome.kind === 'shifted') return t('calendar.reflow.shifted', { session: name, day: dayName(outcome.toDate) });
    if (outcome.kind === 'merged') {
      const into = weeks.flatMap((w) => w.sessions).find((s) => s.id === outcome.intoSessionId)!;
      return t('calendar.reflow.merged', { session: name, day: dayName(into.date) });
    }
    return reasonCodes.includes('program.reflow.week_over') ? t('calendar.reflow.week_over') : t('calendar.reflow.skipped');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="calendar-screen">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('calendar.title')}
        </Text>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={text} testID="calendar-message">
            {message}
          </Text>
        ) : null}
        {!program ? <Text style={text}>{t('calendar.empty')}</Text> : null}
        {unavailable ? (
          <Card testID="calendar-unavailable">
            <Text style={text}>{t('calendar.unavailable')}</Text>
            <Text style={text}>{t(`engine.reason.${unavailable}` as MessageKey)}</Text>
          </Card>
        ) : null}
        {needsProgram ? <Button label={t('calendar.create')} hint={t('calendar.createHint')} onPress={build} testID="calendar-create" /> : null}

        {program && week ? (
          <View style={{ gap: theme.spacing.md }} testID={`calendar-week-${week.microcycle.week}`}>
            <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
              {t('calendar.week', { week: week.microcycle.week, total: weeks.length })}
            </Text>
            <Text style={text}>{t('calendar.block', { block: week.microcycle.mesocycle, intent: t(`calendar.intent.${program.mesocycles[week.microcycle.mesocycle - 1]!.intent}` as MessageKey) })}</Text>
            <Text style={text} testID="calendar-week-kind">
              {t(`calendar.kind.${week.microcycle.kind}` as MessageKey)}
            </Text>
            {today < program.startDate && index === 0 ? <Text style={text}>{t('calendar.startsOn', { day: dayName(program.startDate), date: Number(program.startDate.slice(8, 10)) })}</Text> : null}
            {week.microcycle.aerobicMinutes > 0 ? <Text style={muted}>{t('calendar.aerobic', { minutes: week.microcycle.aerobicMinutes })}</Text> : null}
            {Array.from({ length: 7 }, (_, d) => {
              const date = addDays(week.microcycle.startDate, d);
              const sessions = week.sessions.filter((s) => s.date === date && (s.state === 'planned' || s.state === 'shifted'));
              const gone = week.sessions.filter((s) => s.originalDate === date && (s.state === 'skipped' || s.state === 'merged_away'));
              const title = date === today ? t('calendar.dayToday', { day: dayName(date), date: Number(date.slice(8, 10)) }) : dayLabel(date);
              return (
                <Card key={date} title={title} testID={`calendar-day-${date}`}>
                  {sessions.length === 0 && gone.length === 0 ? <Text style={muted}>{t('calendar.restDay')}</Text> : null}
                  {sessions.map((s) => (
                    <View key={s.id} style={{ gap: theme.spacing.xs }} testID={`calendar-session-${s.id}`}>
                      <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{focusName(s)}</Text>
                      {s.state === 'shifted' ? <Text style={muted}>{t('calendar.movedFrom', { day: dayName(s.originalDate) })}</Text> : null}
                      {s.location ? <Text style={muted}>{t(`location.${s.location}` as MessageKey)}</Text> : null}
                      <Text style={muted}>{t('calendar.minutes', { minutes: s.estimatedMinutes })}</Text>
                      <Text style={muted}>{t('calendar.effort', { rpe: s.targetRpe })}</Text>
                      {s.slots.map((slot) => (
                        <Text key={`${slot.pattern}-${slot.role}`} style={muted}>
                          {t('calendar.slot', { pattern: t(`library.pattern.${slot.pattern}` as MessageKey), sets: t('calendar.sets', { count: slot.hardSets }) })}
                        </Text>
                      ))}
                      {s.conditioning ? (
                        <Text style={muted}>
                          {s.conditioning.placement === 'finisher'
                            ? t(s.conditioning.kind === 'intervals' ? 'calendar.conditioning.finisherIntervals' : 'calendar.conditioning.finisherSteady', { minutes: s.conditioning.minutes })
                            : t(`calendar.conditioning.${s.conditioning.kind}` as MessageKey, { minutes: s.conditioning.minutes })}
                        </Text>
                      ) : null}
                      {today <= week.microcycle.endDate ? (
                        <Button
                          label={t('calendar.cantMakeItFor', { session: focusName(s), day: dayName(s.date) })}
                          display={t('calendar.cantMakeIt')}
                          hint={t('calendar.cantMakeItHint')}
                          variant="secondary"
                          onPress={() => cantMakeIt(s)}
                          testID={`calendar-cant-${s.id}`}
                        />
                      ) : null}
                    </View>
                  ))}
                  {gone.map((s) => (
                    <Text key={s.id} style={muted} testID={`calendar-gone-${s.id}`}>
                      {t('calendar.goneLine', {
                        session: focusName(s),
                        status: s.state === 'skipped' ? t('calendar.skippedLabel') : t('calendar.mergedLabel', { day: dayName(week.sessions.find((x) => x.mergedFrom.includes(s.id))!.date) }),
                      })}
                    </Text>
                  ))}
                </Card>
              );
            })}
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {index > 0 ? <Button label={t('calendar.previousWeek')} hint={t('calendar.weekHint')} variant="secondary" onPress={() => setOffset(offset - 1)} testID="calendar-previous" /> : null}
              {index < weeks.length - 1 ? <Button label={t('calendar.nextWeek')} hint={t('calendar.weekHint')} variant="secondary" onPress={() => setOffset(offset + 1)} testID="calendar-next" /> : null}
            </View>
            <Text style={muted}>{t('calendar.draftNote')}</Text>
          </View>
        ) : null}
        <Button label={t('calendar.back')} variant="secondary" onPress={onExit} testID="calendar-back" />
      </ScrollView>
    </SafeAreaView>
  );
}
