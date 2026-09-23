import { ASSESSMENT_PROTOCOLS, estimatedMinutes, recommendProtocol, type TestInstruction } from '@fitadapt/engine';
import { buildAssessmentPlan, buildCapacityModel, hasGymEquipment } from '@fitadapt/exercise-library';
import { formatMass, lbToKg, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { notice as noticeDefinition, renderNotice } from '@fitadapt/legal';
import { ASSESSMENT_PROTOCOL_IDS, type AssessmentProtocolId, type AssessmentTestResult, type CapacityModel } from '@fitadapt/shared';
import { Button, Card, ChoiceGroup, Input, useTheme } from '@fitadapt/ui';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { localToday } from '../privacy/age-gate';
import { useCapacity, useLegal, useProfile, useReassessment, useSafetyProfile } from '../profile/ProfileProvider';

type Phase = 'choose' | 'notice' | 'test' | 'result';
const WHOLE = /^\d{1,3}$/;
const LOAD = /^\d{1,3}([.,]\d{1,2})?$/;

function ageOn(birth: { year: number; month: number; day: number } | null, now: Date): number {
  if (!birth) return 0;
  const today = localToday(now);
  return today.year - birth.year - (today.month < birth.month || (today.month === birth.month && today.day < birth.day) ? 1 : 0);
}

export interface AssessmentScreenProps {
  onExit: () => void;
  onFirstWorkout: () => void;
}

/**
 * M07 guided assessment (offline: engine and library are on the device).
 * Choose a protocol → the L3 assessment notice (shown and acknowledged, both
 * recorded through packages/legal) → each test with its stop rule from the
 * engine (never to failure; RIR 3 while S1 caps effort) → the CapacityModel,
 * stored as an append-only sync record. "Stop the assessment" is always
 * visible (L4); a test can be skipped or stopped for discomfort.
 */
export function AssessmentScreen({ onExit, onFirstWorkout }: AssessmentScreenProps) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const theme = useTheme();
  const safetyProfile = useSafetyProfile();
  const equipmentProfiles = useProfile((s) => s.equipment);
  const profile = useProfile((s) => s.profile);
  const saveAssessment = useProfile((s) => s.saveAssessment);
  const recordNotice = useLegal((s) => s.recordNotice);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const previous = useCapacity();
  const reassessment = useReassessment();

  const active = equipmentProfiles.find((p) => p.id === profile?.activeEquipmentProfileId) ?? equipmentProfiles[0];
  const equipment = useMemo(() => active?.data.equipment ?? [], [active]);
  const recommended = recommendProtocol({ ageYears: ageOn(profile?.birthDate ?? null, clock.now()), hasGymEquipment: hasGymEquipment(equipment) });
  const [protocolId, setProtocolId] = useState<AssessmentProtocolId>(recommended);
  const [phase, setPhase] = useState<Phase>('choose');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AssessmentTestResult[]>([]);
  const [capacity, setCapacity] = useState<CapacityModel | null>(null);
  const startedAt = useRef<string>('');
  const plan = useMemo(() => buildAssessmentPlan(ASSESSMENT_PROTOCOLS[protocolId], { safetyProfile, equipment }), [protocolId, safetyProfile, equipment]);
  const rendered = renderNotice(noticeDefinition('assessment'), locale, jurisdiction);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const reason = (code: string) => t(`engine.reason.${code}` as MessageKey);

  const openNotice = () => {
    recordNotice(noticeDefinition('assessment'), 'shown', locale);
    setPhase('notice');
  };
  const begin = () => {
    if (plan.status !== 'available') return;
    recordNotice(noticeDefinition('assessment'), 'acknowledged', locale);
    // L11: the S1 gates that changed the tests go to the device defensibility buffer.
    for (const event of plan.safetyEvents) logSafetyEvent(event);
    startedAt.current = clock.now().toISOString();
    setResults([]);
    setIndex(0);
    setPhase('test');
  };
  const record = (r: AssessmentTestResult) => {
    if (plan.status !== 'available') return;
    const all = [...results, r];
    if (all.length < plan.instructions.length) {
      setResults(all);
      setIndex(all.length);
      return;
    }
    const result = { protocolId, protocolVersion: plan.protocolVersion, stopRir: plan.stopRir, startedAt: startedAt.current, completedAt: clock.now().toISOString(), tests: all };
    const model = buildCapacityModel(result);
    saveAssessment({ reason: previous === null ? 'first' : reassessment.status === 'due' ? 'mesocycle_end' : 'on_demand', result, capacity: model, cappedByS1: plan.cappedByS1 });
    setCapacity(model);
    setPhase('result');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="assessment">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {phase === 'result' ? t('assessment.result.title') : t('assessment.title')}
        </Text>

        {phase === 'choose' ? (
          <>
            <ChoiceGroup
              label={t('assessment.choose')}
              options={ASSESSMENT_PROTOCOL_IDS.map((id) => ({ value: id, label: `${t(`assessment.protocol.${id}.name`)}${id === recommended ? ` · ${t('assessment.recommended')}` : ''}` }))}
              value={protocolId}
              onChange={setProtocolId}
              testID="assessment-protocol"
            />
            <Text style={text}>{t(`assessment.protocol.${protocolId}.description`)}</Text>
            {plan.status === 'available' ? (
              <>
                <Text style={text} testID="assessment-intro">
                  {t('assessment.intro', { minutes: Math.ceil(estimatedMinutes(ASSESSMENT_PROTOCOLS[protocolId])) })}
                </Text>
                <Button label={t('assessment.start')} hint={t('assessment.startHint')} onPress={openNotice} testID="assessment-start" />
              </>
            ) : (
              <Text style={text} testID="assessment-unavailable">
                {reason(plan.reasonCode)}
              </Text>
            )}
          </>
        ) : null}

        {phase === 'notice' ? (
          <Card title={rendered.title} testID="notice-assessment">
            <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{rendered.draftBanner}</Text>
            <Text style={text}>{rendered.body}</Text>
            <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={begin} testID="notice-assessment-ack" />
          </Card>
        ) : null}

        {phase === 'test' && plan.status === 'available' ? (
          <TestStep key={index} instruction={plan.instructions[index]!} step={index + 1} total={plan.instructions.length} cappedByS1={plan.cappedByS1} onResult={record} />
        ) : null}

        {phase === 'result' && capacity ? (
          <>
            <Text style={text}>{t('assessment.result.intro')}</Text>
            {capacity.slots.map((slot) => (
              <Card key={slot.slot} title={t('assessment.result.slot', { slot: t(`assessment.slot.${slot.slot}`), exercise: t(`exercise.${slot.exerciseId}.name` as MessageKey) })} testID={`assessment-result-${slot.slot}`}>
                {slot.loadKg !== null ? <Text style={text}>{t('assessment.result.load', { load: formatMass(slot.loadKg, unitSystem, i18n) })}</Text> : null}
                <Text style={text}>{reason(slot.reasonCodes[0]!)}</Text>
              </Card>
            ))}
            <Button label={t('assessment.result.toSession')} onPress={onFirstWorkout} testID="assessment-to-session" />
          </>
        ) : null}

        {phase === 'result' ? (
          <Button label={t('assessment.back')} variant="secondary" onPress={onExit} testID="assessment-back" />
        ) : (
          <Button label={t('assessment.stop')} hint={t('assessment.stopHint')} variant="danger" onPress={onExit} testID="assessment-stop" />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TestStep({ instruction, step, total, cappedByS1, onResult }: { instruction: TestInstruction; step: number; total: number; cappedByS1: boolean; onResult: (r: AssessmentTestResult) => void }) {
  const i18n = useI18n();
  const { t, unitSystem } = i18n;
  const theme = useTheme();
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const [variant, setVariant] = useState<string | null>(instruction.options.length === 1 ? instruction.options[0]! : null);
  const [measure, setMeasure] = useState('');
  const [load, setLoad] = useState('');
  const [rir, setRir] = useState<string>(String(instruction.stop.rir));
  const [invalid, setInvalid] = useState(false);
  const [discomfort, setDiscomfort] = useState(false);
  const { stop, kind, testId } = instruction;
  const unit = t(unitSystem === 'metric' ? 'units.kg' : 'units.lb', { value: '' }).trim();

  const save = () => {
    const value = measure.trim();
    const kg = load.trim().replace(',', '.');
    if (!variant || !WHOLE.test(value) || (kind === 'load_reps' && !LOAD.test(kg))) return setInvalid(true);
    const loadKg = kind === 'load_reps' ? Math.round((unitSystem === 'metric' ? Number(kg) : lbToKg(Number(kg))) * 100) / 100 : null;
    onResult({ status: 'done', testId, exerciseId: variant, reps: kind === 'hold' ? null : Number(value), seconds: kind === 'hold' ? Number(value) : null, loadKg, rir: kind === 'load_reps' ? Number(rir) : null });
  };

  return (
    <View style={{ gap: theme.spacing.md }} testID={`assessment-test-${testId}`}>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('assessment.progress', { step, total })}</Text>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
        {t(`assessment.test.${instruction.messageId}.name` as MessageKey)}
      </Text>
      {instruction.skipReason ? (
        <>
          <Text style={text} testID="assessment-skipped">
            {t(instruction.skipReason === 'safety' ? 'assessment.skipped.safety' : 'assessment.skipped.equipment')}
          </Text>
          <Button label={t('assessment.next')} onPress={() => onResult({ status: 'skipped', testId, reason: instruction.skipReason! })} testID="assessment-next" />
        </>
      ) : discomfort ? (
        <>
          <Text style={text} testID="assessment-discomfort-note">
            {t('assessment.discomfortNote')}
          </Text>
          <Button label={t('assessment.next')} onPress={() => onResult({ status: 'skipped', testId, reason: 'discomfort' })} testID="assessment-next" />
        </>
      ) : (
        <>
          <Text style={text}>{t(`assessment.test.${instruction.messageId}.how` as MessageKey)}</Text>
          <Card testID="assessment-stop-rule">
            {stop.windowSeconds !== null ? <Text style={text}>{t('assessment.stopRule.window', { count: stop.windowSeconds })}</Text> : null}
            <Text style={text} testID="assessment-stop-reserve">
              {kind === 'hold' ? t('assessment.stopRule.hold', { rpe: stop.rpe }) : t('assessment.stopRule.reps', { rir: stop.rir })}
            </Text>
            {stop.capReps !== null ? <Text style={text}>{t('assessment.stopRule.capReps', { count: stop.capReps })}</Text> : null}
            {stop.capSeconds !== null ? <Text style={text}>{t('assessment.stopRule.capSeconds', { count: stop.capSeconds })}</Text> : null}
            {cappedByS1 ? <Text style={text} testID="assessment-s1-note">{t('assessment.stopRule.s1')}</Text> : null}
          </Card>
          {instruction.options.length > 1 ? (
            <ChoiceGroup
              label={t('assessment.level')}
              hint={t('assessment.levelHint')}
              options={instruction.options.map((id) => ({ value: id, label: t(`exercise.${id}.name` as MessageKey) }))}
              value={variant}
              onChange={setVariant}
              testID="assessment-level"
            />
          ) : null}
          {kind === 'load_reps' ? <Input label={t('assessment.input.load', { unit })} value={load} onChangeText={setLoad} keyboardType="decimal-pad" testID="assessment-load" /> : null}
          <Input
            label={kind === 'hold' ? t('assessment.input.seconds') : t('assessment.input.reps')}
            value={measure}
            onChangeText={setMeasure}
            keyboardType="number-pad"
            error={invalid ? t('assessment.input.invalid') : undefined}
            testID="assessment-measure"
          />
          {kind === 'load_reps' ? (
            <ChoiceGroup
              label={t('assessment.input.rir')}
              options={['0', '1', '2', '3', '4'].map((v) => ({ value: v, label: t('assessment.input.rirOption', { count: Number(v) }) }))}
              value={rir}
              onChange={setRir}
              horizontal
              testID="assessment-rir"
            />
          ) : null}
          <Button label={t('assessment.next')} onPress={save} testID="assessment-next" />
          <Button label={t('assessment.skip')} variant="secondary" onPress={() => onResult({ status: 'skipped', testId, reason: 'user_choice' })} testID="assessment-skip" />
          <Button label={t('assessment.discomfort')} variant="secondary" onPress={() => setDiscomfort(true)} testID="assessment-discomfort" />
        </>
      )}
    </View>
  );
}
