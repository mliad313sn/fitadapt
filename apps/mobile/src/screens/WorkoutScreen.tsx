import { createEngineContext, type GenerateSessionInput } from '@fitadapt/engine';
import { autoregulateRemainingSets, generateSession, painAdjustments, replacementsFor } from '@fitadapt/exercise-library';
import { formatMass, kgToLb, lbToKg, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { NOTICES, notice, noticesToShow, renderNotice } from '@fitadapt/legal';
import { JOINTS, RED_FLAG_SYMPTOMS, SESSION_MINUTES_OPTIONS, type Joint, type PerformedSet, type PlannedExercise, type PlannedSet, type RedFlagSymptom, type SessionPlan, type WorkoutSessionRecord } from '@fitadapt/shared';
import { Button, Card, Chip, Sheet, Stepper, useTheme } from '@fitadapt/ui';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clock } from '../clock';
import { useCapacity, useIntensityLock, useJointFlags, useLegal, useProfile, useProgram, useReflows, useSafetyProfile, useSessionHistory } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { useRestRemaining } from '../workout/rest-timer';
import { seedFrom, todayInput } from '../workout/today';

export interface WorkoutScreenProps {
  onExit: () => void;
  onOpenCalendar?: () => void;
  onOpenAssessment?: () => void;
}

type Phase = 'set' | 'rest' | 'done' | 'ended' | 'red_flag';
type SheetKind = 'swap' | 'pain' | 'stop' | null;

interface Run {
  readonly record: WorkoutSessionRecord;
  /** The live plan: swaps and in-session autoregulation change it; the record keeps what was prescribed. */
  readonly plan: SessionPlan;
  readonly exercise: number;
  readonly set: number;
  readonly phase: Phase;
  readonly restEndsAt: number | null;
  readonly logged: number;
  readonly skipped: readonly number[];
}

const nowMs = () => clock.now().getTime();

/**
 * M02 session execution, fully offline: today's session from the engine
 * (program day, place, time, history, pain flags, S3 lock), the "why"
 * behind every exercise and load, then set by set with 2-tap logging (reps,
 * then reps in reserve), an on-device rest timer, swap, skip and pain flag.
 * L4: a stop control and a skip control are visible in every execution
 * state. L3: the first-workout notice is shown and acknowledged before the
 * first session starts. L11: starting a session stores the executed
 * prescription (with its inputs) and logs "prescription issued" (engine and
 * rules versions, reason codes) and its safety events to the device buffer;
 * the server logs them again in the sync transaction.
 */
export function WorkoutScreen({ onExit, onOpenCalendar, onOpenAssessment }: WorkoutScreenProps) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const theme = useTheme();
  const profile = useProfile((s) => s.profile);
  const places = useProfile((s) => s.equipment);
  const workouts = useProfile((s) => s.workouts);
  const saveWorkout = useProfile((s) => s.saveWorkout);
  const logSetRecord = useProfile((s) => s.logSet);
  const logExecution = useProfile((s) => s.logExecution);
  const safetyProfile = useSafetyProfile();
  const program = useProgram();
  const reflows = useReflows();
  const capacity = useCapacity();
  const history = useSessionHistory();
  const jointFlags = useJointFlags();
  const intensityLock = useIntensityLock();
  const impressions = useLegal((s) => s.notices);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const recordNotice = useLegal((s) => s.recordNotice);
  const logPrescription = useLegal((s) => s.logPrescription);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const logSafetyAttested = useLegal((s) => s.logSafetyAttested);

  const [placeId, setPlaceId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [why, setWhy] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reps, setReps] = useState<number | null>(null);
  const [loadKg, setLoadKg] = useState<number | null>(null);
  const [painJoint, setPainJoint] = useState<Joint | null>(null);
  const [painScore, setPainScore] = useState<number | null>(null);
  const [needReps, setNeedReps] = useState(false);

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const title = { color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold } as const;
  const exerciseName = (id: string) => t(`exercise.${id}.name` as MessageKey);
  const reason = (code: string, params: PlannedSet['reasonParams'] = {}) => t(`engine.reason.${code}` as MessageKey, params);
  const mass = (kg: number) => formatMass(kg, unitSystem, i18n);

  // ---- Today's session (preview): the engine, on the device.
  const today = localIsoDate(clock.now());
  const facts = profile ? todayInput({ profile, safetyProfile, places, program, reflows, capacity, history, jointFlags, intensityLock, today, placeId, minutes }) : null;
  // The facts object is rebuilt each render; its content is what matters.
  const factsKey = JSON.stringify(facts);
  const preview = useMemo(() => {
    if (!facts || facts.status !== 'ready') return null;
    const at = nowMs();
    return { input: facts.input, result: generateSession(facts.input, createEngineContext({ clock: { now: () => at }, seed: seedFrom(at) })) };
  }, [factsKey]);
  const pendingNotices = noticesToShow('workout.start', impressions, NOTICES);

  // L3: record that the first-workout notice was shown (once per version until acknowledged).
  useEffect(() => {
    if (run) return;
    for (const n of noticesToShow('workout.start', impressions, NOTICES)) {
      if (!impressions.some((i) => i.noticeId === n.id && i.version === n.version && i.kind === 'shown')) recordNotice(n, 'shown', locale);
    }
  }, [impressions, locale, recordNotice, run]);

  const restRemaining = useRestRemaining(run?.phase === 'rest' ? run.restEndsAt : null);

  const input: GenerateSessionInput | null = run ? (run.record.input as GenerateSessionInput) : (preview?.input ?? null);
  const current: PlannedExercise | null = run ? (run.plan.exercises[run.exercise] ?? null) : null;
  const currentSet: PlannedSet | null = current && run ? (current.sets[run.set] ?? null) : null;

  // New set: reset the entries (the planned load is the default; 0 = not entered).
  useEffect(() => {
    setReps(null);
    setNeedReps(false);
    setLoadKg(currentSet?.loadKg ?? null);
  }, [run?.exercise, run?.set, currentSet?.loadKg]);

  // ---- Run control
  const nextIndex = (r: Run, fromExercise: number, skipped: readonly number[]): number => {
    for (let i = fromExercise + 1; i < r.plan.exercises.length; i++) if (!skipped.includes(i)) return i;
    return -1;
  };
  const end = (r: Run, reasonCode: 'completed' | 'user_stop' | 'red_flag', phase: Phase) => {
    logExecution({ kind: 'ended', planId: r.plan.planId, reason: reasonCode, at: clock.now().toISOString() });
    setSheet(null);
    setRun({ ...r, phase, restEndsAt: null });
  };
  /** After a set (done or skipped): the next set, or the next exercise, or the end. */
  const afterSet = (r: Run, rest: number | null) => {
    const ex = r.plan.exercises[r.exercise]!;
    if (r.set + 1 < ex.sets.length) {
      setRun({ ...r, set: r.set + 1, phase: rest !== null ? 'rest' : 'set', restEndsAt: rest !== null ? nowMs() + rest * 1000 : null });
      return;
    }
    const next = nextIndex(r, r.exercise, r.skipped);
    if (next < 0) {
      end(r, 'completed', 'done');
      return;
    }
    setRun({ ...r, exercise: next, set: 0, phase: rest !== null ? 'rest' : 'set', restEndsAt: rest !== null ? nowMs() + rest * 1000 : null });
  };

  const start = () => {
    if (!preview || preview.result.status !== 'ok' || pendingNotices.length > 0) return;
    const { plan, safetyEvents } = preview.result;
    const record = saveWorkout({ schemaVersion: 1, input: preview.input as WorkoutSessionRecord['input'], plan, safetyEvents: [...safetyEvents], startedAt: clock.now().toISOString(), jurisdiction, firstWorkout: workouts.length === 0 });
    // L11 on the device: the executed prescription and the safety gates it applied.
    const codes = [...new Set([...plan.reasonCodes, ...plan.exercises.flatMap((e) => [...e.reasonCodes, ...e.sets.flatMap((x) => x.reasonCodes)])])];
    logPrescription({ prescriptionId: plan.planId, engineVersion: plan.engineVersion, rulesVersion: plan.rulesVersion, reasonCodes: codes });
    for (const event of safetyEvents) logSafetyEvent(event);
    setMessage(null);
    setRun({ record, plan, exercise: 0, set: 0, phase: 'set', restEndsAt: null, logged: 0, skipped: [] });
  };

  const logSet = (rir: number) => {
    if (!run || !current || !currentSet) return;
    if (reps === null) {
      setNeedReps(true);
      return;
    }
    const performed: PerformedSet = {
      index: currentSet.index,
      status: 'done',
      reps: currentSet.target.kind === 'reps' ? reps : null,
      seconds: currentSet.target.kind === 'hold' ? reps : null,
      loadKg: loadKg !== null && loadKg > 0 ? loadKg : null,
      rir,
    };
    logSetRecord({ schemaVersion: 1, planId: run.plan.planId, exerciseIndex: run.exercise, exerciseId: current.exerciseId, set: performed, loggedAt: clock.now().toISOString(), correctionOf: null });
    // RIR autoregulation: a set much harder than planned makes the remaining sets lighter (never heavier).
    const adjusted = autoregulateRemainingSets(run.record.input as GenerateSessionInput, current, performed);
    const plan = adjusted === current ? run.plan : { ...run.plan, exercises: run.plan.exercises.map((e, i) => (i === run.exercise ? adjusted : e)) };
    afterSet({ ...run, plan, logged: run.logged + 1 }, currentSet.restSeconds);
  };

  const skipSet = () => {
    if (!run || !current || !currentSet) return;
    logSetRecord({ schemaVersion: 1, planId: run.plan.planId, exerciseIndex: run.exercise, exerciseId: current.exerciseId, set: { index: currentSet.index, status: 'skipped', reps: null, seconds: null, loadKg: null, rir: null }, loggedAt: clock.now().toISOString(), correctionOf: null });
    afterSet(run, null);
  };

  const skipExercise = (r: Run | null = run) => {
    if (!r) return;
    logExecution({ kind: 'exercise_skipped', planId: r.plan.planId, exerciseIndex: r.exercise, at: clock.now().toISOString() });
    setSheet(null);
    const skipped = [...r.skipped, r.exercise];
    const next = nextIndex(r, r.exercise, skipped);
    if (next < 0) end({ ...r, skipped }, 'completed', 'done');
    else setRun({ ...r, skipped, exercise: next, set: 0, phase: 'set', restEndsAt: null });
  };

  const applySwap = (r: Run, index: number, replacement: PlannedExercise, why: 'user' | 'pain'): Run => {
    logExecution({ kind: 'swapped', planId: r.plan.planId, exerciseIndex: index, fromExerciseId: r.plan.exercises[index]!.exerciseId, replacement, reason: why, at: clock.now().toISOString() });
    return { ...r, plan: { ...r.plan, exercises: r.plan.exercises.map((e, i) => (i === index ? replacement : e)) } };
  };

  const swapTo = (replacement: PlannedExercise) => {
    if (!run) return;
    const next = applySwap(run, run.exercise, replacement, 'user');
    setSheet(null);
    setRun({ ...next, set: Math.min(run.set, replacement.sets.length - 1), phase: 'set', restEndsAt: null });
  };

  const savePain = () => {
    if (!run || painJoint === null || painScore === null) return;
    logExecution({ kind: 'pain', planId: run.plan.planId, joint: painJoint, score: painScore, at: clock.now().toISOString() });
    // S2 now: a red joint (≥ 6) swaps or skips the rest of the session's exercises that load it.
    const changes = painAdjustments(run.record.input as GenerateSessionInput, run.plan, run.exercise, painJoint, painScore, nowMs());
    let next = run;
    const notes: string[] = [];
    for (const change of changes) {
      const from = exerciseName(next.plan.exercises[change.exerciseIndex]!.exerciseId);
      if (change.replacement) {
        next = applySwap(next, change.exerciseIndex, change.replacement, 'pain');
        notes.push(t('workout.pain.swapped', { from, to: exerciseName(change.replacement.exerciseId) }));
      } else {
        logExecution({ kind: 'exercise_skipped', planId: next.plan.planId, exerciseIndex: change.exerciseIndex, at: clock.now().toISOString() });
        next = { ...next, skipped: [...next.skipped, change.exerciseIndex] };
        notes.push(t('workout.pain.skipped', { exercise: from }));
      }
    }
    setPainJoint(null);
    setPainScore(null);
    setSheet(null);
    setMessage(notes.length > 0 ? notes.join(' ') : t('workout.pain.saved'));
    if (next.skipped.includes(next.exercise)) {
      const after = nextIndex(next, next.exercise, next.skipped);
      if (after < 0) end(next, 'completed', 'done');
      else setRun({ ...next, exercise: after, set: 0, phase: 'set', restEndsAt: null });
    } else {
      setRun({ ...next, set: Math.min(next.set, next.plan.exercises[next.exercise]!.sets.length - 1) });
    }
  };

  const redFlag = (symptom: RedFlagSymptom) => {
    if (!run) return;
    const at = clock.now().toISOString();
    logExecution({ kind: 'red_flag', planId: run.plan.planId, symptom, at });
    // S3 on the device buffer (L11): the session ends and intensity locks until a medical review is attested.
    logSafetyEvent({ invariant: 'S3', reasonCode: `safety.s3.${symptom}`, action: 'session_ended', engineVersion: run.plan.engineVersion });
    logSafetyEvent({ invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: run.plan.engineVersion });
    recordNotice(notice('seek_care'), 'shown', locale);
    end(run, 'red_flag', 'red_flag');
  };

  const attestReview = () => {
    logExecution({ kind: 'medical_review_attested', at: clock.now().toISOString() });
    logSafetyAttested({ invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: preview?.result.status === 'ok' ? preview.result.plan.engineVersion : (run?.plan.engineVersion ?? '0.0.0') });
  };

  // ---- Controls visible in every execution state (L4)
  const stopButton = <Button label={t('workout.stop')} hint={t('workout.stopHint')} variant="danger" onPress={() => setSheet('stop')} testID="workout-stop" />;
  const sheetControls = (
    <View style={{ gap: theme.spacing.sm }}>
      <Button label={t('workout.skipExercise')} hint={t('workout.skipHint')} variant="secondary" onPress={() => skipExercise()} testID="workout-sheet-skip" />
      <Button label={t('workout.stop.end')} hint={t('workout.stopHint')} variant="danger" onPress={() => run && end(run, 'user_stop', 'ended')} testID="workout-sheet-stop" />
    </View>
  );

  const dose = (e: PlannedExercise) => {
    const s = e.sets[0]!;
    const base = s.target.kind === 'hold' ? t('workout.hold', { sets: e.sets.length, seconds: s.target.seconds }) : t('workout.reps', { sets: e.sets.length, min: s.target.min, max: s.target.max });
    if (s.loadKg !== null) return `${base} ${t('workout.load', { load: mass(s.loadKg) })}`;
    return s.reasonCodes.includes('session.load.self_select_light') ? `${base} ${t('workout.chooseLoad')}` : base;
  };

  // ---------------------------------------------------------------- render
  if (run && (run.phase === 'done' || run.phase === 'ended' || run.phase === 'red_flag')) {
    const seekCare = renderNotice(notice('seek_care'), locale, jurisdiction);
    const acknowledged = impressions.some((i) => i.noticeId === 'seek_care' && i.kind === 'acknowledged');
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID={`workout-${run.phase}`}>
          <Text accessibilityRole="header" style={{ ...title, fontSize: theme.fontSize.headline }}>
            {run.phase === 'done' ? t('workout.done.title') : run.phase === 'ended' ? t('workout.ended.title') : t('workout.redFlag.title')}
          </Text>
          {run.phase === 'red_flag' ? (
            <Card title={seekCare.title} testID="notice-seek_care">
              <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{seekCare.draftBanner}</Text>
              <Text style={text}>{seekCare.body}</Text>
              {seekCare.emergency ? <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{seekCare.emergency}</Text> : null}
              <Text style={text}>{t('workout.redFlag.body')}</Text>
              {!acknowledged ? <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => recordNotice(notice('seek_care'), 'acknowledged', locale)} testID="notice-seek_care-ack" /> : null}
            </Card>
          ) : null}
          <Text style={text} testID="workout-summary">
            {t('workout.done.summary', { done: run.logged })}
          </Text>
          <Text style={muted}>{t('workout.done.saved')}</Text>
          <Button label={t('workout.back')} variant="secondary" onPress={onExit} testID="workout-back" />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (run && current && currentSet) {
    const target = currentSet.target;
    const repOptions = target.kind === 'reps' ? range(Math.max(0, target.min - 2), target.max + 2) : [target.seconds - 10, target.seconds - 5, target.seconds, target.seconds + 5, target.seconds + 10].filter((x) => x > 0);
    const loaded = currentSet.loadKg !== null || currentSet.reasonCodes.includes('session.load.self_select_light');
    const displayLoad = loadKg === null ? 0 : unitSystem === 'imperial' ? Math.round(kgToLb(loadKg) * 2) / 2 : loadKg;
    const next = run.plan.exercises[run.set + 1 < current.sets.length ? run.exercise : nextIndex(run, run.exercise, run.skipped)];
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID={`workout-phase-${run.phase}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md }}>
            <Text style={muted} testID="workout-progress">
              {t('workout.progress', { exercise: run.exercise + 1, exercises: run.plan.exercises.length, set: run.set + 1, sets: current.sets.length })}
            </Text>
            {stopButton}
          </View>
          {message ? (
            <Text accessibilityLiveRegion="polite" style={text} testID="workout-message">
              {message}
            </Text>
          ) : null}
          {run.phase === 'rest' ? (
            <Card title={t('workout.rest.title')} testID="workout-rest">
              <Text accessibilityRole="timer" accessibilityLabel={t('ui.timer.remaining', { minutes: Math.floor(Math.ceil(restRemaining / 1000) / 60), seconds: Math.ceil(restRemaining / 1000) % 60 })} style={{ color: theme.colors.text, fontSize: theme.fontSize.display, fontWeight: theme.fontWeight.bold }} testID="workout-rest-remaining">
                {clockText(restRemaining)}
              </Text>
              {restRemaining === 0 ? <Text style={text}>{t('workout.rest.over')}</Text> : null}
              {next ? <Text style={muted}>{t('workout.rest.next', { exercise: exerciseName(next.exerciseId) })}</Text> : null}
              <Button label={restRemaining === 0 ? t('workout.continue') : t('workout.rest.skip')} hint={t('workout.skipHint')} variant={restRemaining === 0 ? 'primary' : 'secondary'} onPress={() => setRun({ ...run, phase: 'set', restEndsAt: null })} testID="workout-skip" />
            </Card>
          ) : (
            <Card title={exerciseName(current.exerciseId)} testID={`workout-set-${run.exercise}-${run.set}`}>
              <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="workout-target">
                {target.kind === 'reps' ? t('workout.target.reps', { min: target.min, max: target.max }) : t('workout.target.hold', { seconds: target.seconds })}
                {currentSet.loadKg !== null ? ` · ${mass(currentSet.loadKg)}` : ''}
              </Text>
              <Text style={muted}>{t('workout.target.reserve', { rir: currentSet.targetRir })}</Text>
              {currentSet.tempo ? <Text style={muted}>{t('workout.target.tempo', { seconds: currentSet.tempo.eccentricSeconds })}</Text> : null}
              {current.supersetGroup ? <Text style={muted}>{t('workout.superset')}</Text> : null}
              {currentSet.reasonCodes.slice(1, 3).map((code) => (
                <Text key={code} style={muted}>
                  {reason(code, currentSet.reasonParams)}
                </Text>
              ))}
              {loaded ? (
                <Stepper
                  label={unitSystem === 'imperial' ? t('workout.loadLabelLb') : t('workout.loadLabel')}
                  value={displayLoad}
                  step={unitSystem === 'imperial' ? 5 : 2.5}
                  min={0}
                  onChange={(v) => setLoadKg(unitSystem === 'imperial' ? Math.round(lbToKg(v) * 100) / 100 : v)}
                  testID="workout-load"
                />
              ) : (
                <Text style={muted}>{t('workout.bodyweight')}</Text>
              )}
              <Text style={text}>{target.kind === 'reps' ? t('workout.repsQuestion') : t('workout.secondsQuestion')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {repOptions.map((n) => (
                  <Chip key={n} label={target.kind === 'reps' ? t('workout.repsChip', { count: n }) : t('workout.secondsChip', { count: n })} selected={reps === n} onPress={() => setReps(n)} testID={`workout-reps-${n}`} />
                ))}
              </View>
              <Text style={text}>{target.kind === 'reps' ? t('workout.rirQuestion') : t('workout.effortQuestion')}</Text>
              {needReps ? (
                <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>
                  {t('workout.pickRepsFirst')}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <Chip key={n} label={t('workout.rirChip', { count: n })} hint={t('workout.rirHint')} selected={false} onPress={() => logSet(n)} testID={`workout-rir-${n}`} />
                ))}
              </View>
              <Button label={t('workout.skipSet')} hint={t('workout.skipHint')} variant="secondary" onPress={skipSet} testID="workout-skip" />
              <Button label={t('workout.skipExercise')} hint={t('workout.skipHint')} variant="secondary" onPress={() => skipExercise()} testID="workout-skip-exercise" />
              <Button label={t('workout.swap')} hint={t('workout.swapHint')} variant="secondary" onPress={() => setSheet('swap')} testID="workout-swap" />
              <Button label={t('workout.pain')} hint={t('workout.painHint')} variant="secondary" onPress={() => setSheet('pain')} testID="workout-pain" />
            </Card>
          )}
          <Text style={muted}>{t('workout.draftNote')}</Text>
        </ScrollView>

        <Sheet visible={sheet === 'swap'} onClose={() => setSheet(null)} title={t('workout.swap.title')} testID="workout-sheet-swap">
          <SwapOptions input={input!} plan={run.plan} index={run.exercise} onPick={swapTo} name={exerciseName} />
          {sheetControls}
        </Sheet>
        <Sheet visible={sheet === 'pain'} onClose={() => setSheet(null)} title={t('workout.pain.title')} testID="workout-sheet-pain">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {JOINTS.map((j) => (
              <Chip key={j} label={t(`library.joint.${j}` as MessageKey)} selected={painJoint === j} onPress={() => setPainJoint(j)} testID={`workout-pain-joint-${j}`} />
            ))}
          </View>
          <Text style={text}>{t('workout.pain.score')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {range(0, 10).map((n) => (
              <Chip key={n} label={t('workout.pain.scoreChip', { score: n })} selected={painScore === n} onPress={() => setPainScore(n)} testID={`workout-pain-score-${n}`} />
            ))}
          </View>
          <Button label={t('workout.pain.save')} disabled={painJoint === null || painScore === null} onPress={savePain} testID="workout-pain-save" />
          {sheetControls}
        </Sheet>
        <Sheet visible={sheet === 'stop'} onClose={() => setSheet(null)} title={t('workout.stop.title')} testID="workout-sheet-stop-menu">
          <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('workout.stop.unwell')}</Text>
          {RED_FLAG_SYMPTOMS.map((s) => (
            <Button key={s} label={t(`workout.stop.symptom.${s}` as MessageKey)} hint={t('workout.stop.symptomHint')} variant="danger" onPress={() => redFlag(s)} testID={`workout-stop-symptom-${s}`} />
          ))}
          {sheetControls}
        </Sheet>
      </SafeAreaView>
    );
  }

  // ---- Preview
  const result = preview?.result ?? null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="workout-preview">
        <Text accessibilityRole="header" style={{ ...title, fontSize: theme.fontSize.headline }}>
          {t('workout.title')}
        </Text>
        {intensityLock.locked ? (
          <Card title={t('workout.locked.title')} testID="workout-locked">
            <Text style={text}>{t('workout.locked.body')}</Text>
            <Button label={t('workout.locked.attest')} hint={t('workout.locked.attestHint')} onPress={attestReview} testID="workout-attest" />
          </Card>
        ) : null}
        {pendingNotices.map((n) => {
          const rendered = renderNotice(n, locale, jurisdiction);
          return (
            <Card key={n.id} title={rendered.title} testID={`notice-${n.id}`}>
              <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{rendered.draftBanner}</Text>
              <Text style={text}>{rendered.body}</Text>
              <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => recordNotice(n, 'acknowledged', locale)} testID={`notice-${n.id}-ack`} />
            </Card>
          );
        })}
        {places.length > 1 ? (
          <>
            <Text style={title}>{t('workout.where')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {places.map((p) => (
                <Chip key={p.id} label={t(`location.${p.data.location}` as MessageKey)} hint={t('workout.whereHint')} selected={facts?.status === 'ready' && facts.placeId === p.id} onPress={() => setPlaceId(p.id)} testID={`workout-place-${p.data.location}`} />
              ))}
            </View>
          </>
        ) : null}
        <Text style={title}>{t('workout.time')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {SESSION_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={t('onboarding.schedule.minuteOption', { count: m })} hint={t('workout.timeHint')} selected={(minutes ?? profile?.schedule.minutesPerSession) === m} onPress={() => setMinutes(m)} testID={`workout-minutes-${m}`} />
          ))}
        </View>
        {facts?.status === 'rest_day' ? (
          <Text style={text} testID="workout-rest-day">
            {t('workout.restDay')}
          </Text>
        ) : null}
        {result?.status === 'unavailable' ? (
          <Card testID="workout-unavailable">
            <Text style={text}>{t('workout.unavailable')}</Text>
            <Text style={text}>{reason(result.reasonCodes[result.reasonCodes.length - 1]!)}</Text>
            {onOpenCalendar && result.reasonCodes.includes('session.unavailable.no_program') ? <Button label={t('workout.openCalendar')} variant="secondary" onPress={onOpenCalendar} testID="workout-open-calendar" /> : null}
            {onOpenAssessment && result.reasonCodes.includes('session.unavailable.no_program') ? <Button label={t('workout.assess')} variant="secondary" onPress={onOpenAssessment} testID="workout-assess" /> : null}
          </Card>
        ) : null}
        {result?.status === 'ok' ? (
          <View style={{ gap: theme.spacing.md }} testID="workout-plan">
            <Text style={text} testID="workout-minutes">
              {t('workout.minutes', { minutes: Math.round(result.plan.estimatedMinutes) })}
            </Text>
            <Text style={muted}>{t('workout.warmUp', { minutes: result.plan.warmUp.minutes })}</Text>
            <Text style={muted}>{t('workout.reserve', { rir: result.plan.targetRir })}</Text>
            {result.plan.conditioning ? <Text style={muted}>{t(result.plan.conditioning.placement === 'finisher' ? 'workout.conditioning.finisher' : 'workout.conditioning.session', { minutes: result.plan.conditioning.minutes })}</Text> : null}
            {result.plan.reasonCodes.map((code) => (
              <Text key={code} style={muted}>
                {reason(code)}
              </Text>
            ))}
            {result.plan.exercises.map((e, i) => (
              <Card key={`${e.exerciseId}-${i}`} title={exerciseName(e.exerciseId)} testID={`workout-exercise-${i}`}>
                <Text style={text}>{dose(e)}</Text>
                {e.supersetGroup ? <Text style={muted}>{t('workout.superset')}</Text> : null}
                <Button label={`${t('workout.why')} ${exerciseName(e.exerciseId)}`} display={t('workout.why')} hint={t('workout.whyHint')} variant="secondary" onPress={() => setWhy(why === i ? null : i)} testID={`workout-why-${i}`} />
                {why === i
                  ? e.sets[0]!.reasonCodes.map((code) => (
                      <Text key={code} style={muted} testID={`workout-why-${i}-${code}`}>
                        {reason(code, e.sets[0]!.reasonParams)}
                      </Text>
                    ))
                  : null}
              </Card>
            ))}
            {pendingNotices.length > 0 ? <Text style={text}>{t('workout.noticeFirst')}</Text> : null}
            <Button label={t('workout.start')} hint={t('workout.startHint')} disabled={pendingNotices.length > 0} onPress={start} testID="workout-start" />
          </View>
        ) : null}
        <Text style={muted}>{t('workout.draftNote')}</Text>
        <Button label={t('workout.back')} variant="secondary" onPress={onExit} testID="workout-back" />
      </ScrollView>
    </SafeAreaView>
  );
}

function SwapOptions({ input, plan, index, onPick, name }: { input: GenerateSessionInput; plan: SessionPlan; index: number; onPick: (e: PlannedExercise) => void; name: (id: string) => string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const options = useMemo(() => replacementsFor(input, plan, index, nowMs(), 'user'), [input, plan, index]);
  if (options.length === 0) return <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('workout.swap.none')}</Text>;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {options.map((o) => (
        <Button key={o.exerciseId} label={t('workout.swap.option', { exercise: name(o.exerciseId) })} onPress={() => onPick(o)} testID={`workout-swap-option-${o.exerciseId}`} />
      ))}
    </View>
  );
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
