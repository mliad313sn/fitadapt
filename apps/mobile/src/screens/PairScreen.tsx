import { PAIR_RULES_VERSION, createEngineContext, setKey, challengeComparable, type GenerateSessionInput, type PairSessionResult } from '@fitadapt/engine';
import { autoregulateRemainingSets, buildCapacityModel, fairScore, generatePairSession, painAdjustments, remainingTimeline } from '@fitadapt/exercise-library';
import { formatMass, type MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { NOTICES, noticesToShow, notice, renderNotice, type NoticeDefinition, type NoticeTrigger } from '@fitadapt/legal';
import { challengeOn, isFeatureEnabled, partnerView, type PartnerScopes } from '@fitadapt/privacy';
import { JOINTS, RED_FLAG_SYMPTOMS, SESSION_MINUTES_OPTIONS, type AssessmentResult, type ExecutionLog, type FairScore, type Joint, type PairSession, type PairSharingScope, type ParticipantSlot, type PerformedSet, type RedFlagSymptom, type ScoredSet, type SessionPlan, type SetLog, type SharedTimeline, type TimelineStep, type WorkoutSessionRecord } from '@fitadapt/shared';
import { Button, Card, Chip, Input, Sheet, useTheme } from '@fitadapt/ui';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { clock } from '../clock';
import type { LegalStore } from '../legal/legal-store';
import { randomUUID } from 'expo-crypto';
import { NO_LEDGERS, guestFacts, guestSafetyProfile, guestWorkoutGate, sharedScopes, type GuestLedgers } from '../pair/pair-store';
import { usePair, usePairStore } from '../pair/PairProvider';
import { PartnerSetup, SharingChoices } from '../pair/PartnerSetup';
import { useConsents } from '../privacy/PrivacyProvider';
import { useCapacity, useFirstWorkoutAccess, useIntensityLock, useJointFlags, useLegal, useProfile, useProgram, useReadinessChecks, useReflows, useSafetyProfile, useSessionHistory } from '../profile/ProfileProvider';
import { localIsoDate, selectDeload, selectReadiness } from '../profile/selectors';
import { reportError } from '../observability';
import { useProgressContext } from '../progress/ProgressProvider';
import { useRestRemaining } from '../workout/rest-timer';
import { seedFrom, todayInput } from '../workout/today';

export interface PairScreenProps {
  onExit: () => void;
}

type Stage = 'setup' | 'partner' | 'preview' | 'run' | 'done';
type Who = ParticipantSlot;

/** Everything that differs between the two people, kept apart: own plan, own logs, own ledgers. */
interface Person {
  readonly name: string;
  readonly input: GenerateSessionInput;
  plan: SessionPlan;
  done: Set<string>;
  active: boolean;
  restEndsAt: number | null;
  sets: ScoredSet[];
  events: ExecutionLog[];
  ended: 'completed' | 'user_stop' | 'red_flag' | null;
}

/** A default capacity for a partner who has not done the M07 check: the lowest rung of each ladder (engine rule). */
function defaultCapacity(at: Date): ReturnType<typeof buildCapacityModel> {
  const iso = at.toISOString();
  const result: AssessmentResult = {
    protocolId: 'home',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: iso,
    completedAt: iso,
    tests: ['push_reps', 'dead_hang_hold', 'row_reps', 'squat_reps', 'plank_hold'].map((testId) => ({ status: 'skipped' as const, testId, reason: 'user_choice' as const })),
  };
  return buildCapacityModel(result);
}

const nowMs = () => clock.now().getTime();

/**
 * M09 Fair Pair on one phone, fully offline ("I go / you go"). Two people
 * of very different capacity train the same session: each gets their own
 * plan from the one engine with their own SafetyProfile, joint flags,
 * history and capacity; the pair planner orders both into one timeline
 * (same pattern per block, individual variant and load, rest kept).
 *
 * - The partner answers for themselves: their own L2 acceptances and
 *   consents, their own screening, in their own ledgers (PartnerSetup).
 * - Logs stay per person: the owner's go to the owner's sync outbox, the
 *   partner's to their own namespace on this phone, never the other's.
 * - Stop and skip for each person in every state (L4); a pain flag changes
 *   only that person's plan (S2); a red flag ends that person's session and
 *   intensity (S3), shows them the seek-care guidance, and the other can go
 *   on alone — the partner is never told why.
 * - Nothing is shown about a person without their own sharing consent and
 *   scopes; body weight stays hidden unless its owner opts in; the Fair
 *   Challenge is off unless both choose it, after its L3 notice.
 */
export function PairScreen({ onExit }: PairScreenProps) {
  const i18n = useI18n();
  const { t, locale, unitSystem } = i18n;
  const theme = useTheme();
  const pairStore = usePairStore();
  const { io } = useProgressContext();
  usePair((s) => s.revision);
  const guests = usePair((s) => s.guests);
  const ownerName = usePair((s) => s.ownerName);
  const ownerSharingList = usePair((s) => s.ownerSharing);
  const jurisdiction = usePair((s) => s.jurisdiction);

  // The owner (participant a): the M01/M02 stores, exactly as for a solo session.
  const profile = useProfile((s) => s.profile);
  const places = useProfile((s) => s.equipment);
  const workouts = useProfile((s) => s.workouts);
  const saveWorkout = useProfile((s) => s.saveWorkout);
  const ownerLogSet = useProfile((s) => s.logSet);
  const ownerLogExecution = useProfile((s) => s.logExecution);
  const executionLogs = useProfile((s) => s.executionLogs);
  const readinessChecks = useReadinessChecks();
  const safetyProfile = useSafetyProfile();
  const program = useProgram();
  const reflows = useReflows();
  const capacity = useCapacity();
  const history = useSessionHistory();
  const jointFlags = useJointFlags();
  const intensityLock = useIntensityLock();
  const access = useFirstWorkoutAccess();
  const ownerConsents = useConsents((s) => s.records);
  const decideOwner = useConsents((s) => s.decide);
  const ownerLegal = useLegal((s) => s);

  const [stage, setStage] = useState<Stage>('setup');
  const [nameDraft, setNameDraft] = useState(ownerName ?? '');
  const [ownerScopes, setOwnerScopes] = useState<PairSharingScope[]>(sharedScopes(ownerConsents, ownerSharingList) ?? []);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showEach, setShowEach] = useState(false);
  const [people, setPeople] = useState<{ a: Person; b: Person } | null>(null);
  const [session, setSession] = useState<PairSession | null>(null);
  const [togetherDone, setTogetherDone] = useState<string[]>([]);
  const [reps, setReps] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'pain' | 'stop'; who: Who } | null>(null);
  const [painJoint, setPainJoint] = useState<Joint | null>(null);
  const [painScore, setPainScore] = useState<number | null>(null);
  const [seekCare, setSeekCare] = useState<Who | null>(null);
  const [tick, setTick] = useState(0);
  /** The shared place's equipment, fixed when the session starts (the preview is only computed before it). */
  const [items, setItems] = useState<readonly string[] | null>(null);
  /** Who took the last turn: the re-planned timeline keeps the alternation. */
  const [lastTurn, setLastTurn] = useState<Who | null>(null);

  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.label } as const;
  const title = { color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold } as const;
  const exerciseName = (id: string) => t(`exercise.${id}.name` as MessageKey);
  const mass = (kg: number) => formatMass(kg, unitSystem, i18n);

  const guest = guestId ? pairStore.getState().guest(guestId) : null;
  const guestLedgers: GuestLedgers | null = guestId ? pairStore.getState().ledgers(guestId) : null;
  // Re-render when the guest's own ledgers change (acceptances, notices, consents).
  useStore(guestLedgers?.legal ?? NO_LEDGERS.legal, (s) => s.notices);
  useStore(guestLedgers?.consents ?? NO_LEDGERS.consents, (s) => s.records);

  const ownerSharingConsent = isFeatureEnabled('pair.share_with_partner', ownerConsents);
  const scopesA: PartnerScopes = ownerSharingConsent ? ownerScopes : null;
  const scopesB: PartnerScopes = guest && guestLedgers ? sharedScopes(guestLedgers.consents.getState().records, guest.sharing) : null;
  const challenge = challengeOn(scopesA, scopesB);

  // ---- The two inputs and the pair session preview (the engine, on the device).
  const today = localIsoDate(clock.now());
  const ownerFacts = profile ? todayInput({ profile, safetyProfile, places, program, reflows, capacity, history, jointFlags, intensityLock, today, placeId, minutes, readiness: selectReadiness(readinessChecks, today) }) : null;
  const previewKey = JSON.stringify([ownerFacts, guestId, guest?.profile, guest?.workouts.length, guest?.executionLogs.length, stage === 'preview', guestLedgers?.consents.getState().records.length]);
  const preview = useMemo((): { at: number; result: PairSessionResult; inputA: GenerateSessionInput; inputB: GenerateSessionInput; items: readonly string[] } | null => {
    if (stage !== 'preview' || !ownerFacts || ownerFacts.status !== 'ready' || !guest || !guestLedgers) return null;
    const at = nowMs();
    const place = places.find((p) => p.id === ownerFacts.placeId)!;
    const deloadA = selectDeload(executionLogs, history, readinessChecks, at);
    const inputA: GenerateSessionInput = deloadA ? { ...ownerFacts.input, deload: deloadA } : ownerFacts.input;
    const facts = guestFacts(guest, at);
    const inputB: GenerateSessionInput = {
      safetyProfile: guestSafetyProfile(guest, guestLedgers),
      equipment: inputA.equipment,
      equipmentLoads: inputA.equipmentLoads ?? null,
      equipmentProfileId: inputA.equipmentProfileId ?? null,
      minutesAvailable: inputA.minutesAvailable,
      jointFlags: facts.jointFlags,
      capacity: defaultCapacity(clock.now()),
      history: facts.history,
      bodyweightKg: guest.profile.bodyweightKg,
      birthDate: guest.profile.birthDate,
      intensityLock: facts.intensityLock,
      ...(facts.deload ? { deload: facts.deload } : {}),
    };
    const result = generatePairSession(inputA, inputB, { equipment: place.data.equipment, equipmentLoads: inputA.equipmentLoads ?? null, equipmentProfileId: place.id }, createEngineContext({ clock: { now: () => at }, seed: seedFrom(at) }));
    return { at, result, inputA, inputB, items: place.data.equipment };
    // The facts object is rebuilt each render; its content is what matters.
  }, [previewKey]);

  const nameOf = (who: Who) => (who === 'a' ? (ownerName ?? '') : (guest?.profile.displayName ?? ''));
  const legalOf = (who: Who) => (who === 'a' ? ownerLegal : guestLedgers!.legal.getState());

  // L3 before the pair session, for EACH person in their own ledger: the first-workout notice, the intensity
  // notice before a first HIIT block, and the Fair Challenge notice when the challenge is on.
  const noticesFor = (who: Who): NoticeDefinition[] => {
    if (!preview || preview.result.status !== 'ok') return [];
    const plan = who === 'a' ? preview.result.a.plan : preview.result.b.plan;
    const impressions = who === 'a' ? ownerLegal.notices : guestLedgers!.legal.getState().notices;
    const triggers: NoticeTrigger[] = ['workout.start', ...(plan.cardio?.hiit ? (['hiit.start'] as const) : []), ...(challenge ? (['pair.challenge.start'] as const) : [])];
    return triggers.flatMap((trigger) => noticesToShow(trigger, impressions, NOTICES));
  };
  const pendingA = noticesFor('a');
  const pendingB = noticesFor('b');
  useEffect(() => {
    if (stage !== 'preview') return;
    for (const who of ['a', 'b'] as const) {
      const legal = legalOf(who);
      for (const n of who === 'a' ? pendingA : pendingB) {
        if (!legal.notices.some((i) => i.noticeId === n.id && i.version === n.version && i.kind === 'shown')) legal.recordNotice(n, 'shown', locale);
      }
    }
  }, [stage, pendingA.map((n) => n.id).join(), pendingB.map((n) => n.id).join()]);

  // ---- Run: what is left, and whose turn it is.
  const timeline: SharedTimeline | null = people && items ? remainingTimeline({ plan: people.a.plan, done: people.a.done, active: people.a.active }, { plan: people.b.plan, done: people.b.done, active: people.b.active }, items as never, { lastTurn }) : null;
  const step: TimelineStep | null = timeline ? (timeline.steps.find((s) => s.kind === 'set' || !togetherDone.includes(timeline.blocks[s.block]!.kind)) ?? null) : null;
  const restA = useRestRemaining(people?.a.restEndsAt ?? null);
  const restB = useRestRemaining(people?.b.restEndsAt ?? null);
  void tick;

  useEffect(() => setReps(null), [step?.index, step?.participant, step?.exerciseIndex, step?.setIndex]);
  useEffect(() => {
    if (stage === 'run' && people && items && !step) finish(people);
  }, [stage, step === null]);

  // ---------------------------------------------------------------- actions
  const logFor = (who: Who) => ({
    set: (log: SetLog) => (who === 'a' ? ownerLogSet(log) : pairStore.getState().guestLogSet(guestId!, log)),
    execution: (event: ExecutionLog) => (who === 'a' ? ownerLogExecution(event) : pairStore.getState().guestLogExecution(guestId!, event)),
  });

  const saveOwnerSetup = () => {
    const name = nameDraft.trim();
    if (name.length === 0 || name.length > 24 || /[@<>{}\\]/.test(name)) return setError(t('pair.guest.nameInvalid'));
    pairStore.getState().setOwnerName(name);
    if (!ownerSharingConsent) return setError(t('pair.consent.required'));
    pairStore.getState().recordSharing('owner', ownerScopes);
    setError(null);
    return true;
  };

  const start = () => {
    if (!preview || preview.result.status !== 'ok' || !guest || !guestId || pendingA.length > 0 || pendingB.length > 0) return;
    const { a, b, timeline: full } = preview.result;
    const startedAt = clock.now().toISOString();
    const codes = (plan: SessionPlan) => [...new Set([...plan.reasonCodes, ...plan.exercises.flatMap((e) => [...e.reasonCodes, ...e.sets.flatMap((x) => x.reasonCodes)])])];
    // Each person's executed prescription goes to their own records and their own defensibility buffer (L11).
    // Each person's record carries the input their plan came from (their own, at the shared place and time).
    saveWorkout({ schemaVersion: 1, input: a.input as WorkoutSessionRecord['input'], plan: a.plan, safetyEvents: [...a.safetyEvents], startedAt, jurisdiction, firstWorkout: workouts.length === 0 });
    pairStore.getState().guestSaveWorkout(guestId, { schemaVersion: 1, input: b.input as WorkoutSessionRecord['input'], plan: b.plan, safetyEvents: [...b.safetyEvents], startedAt, jurisdiction, firstWorkout: guest.workouts.length === 0 });
    const pairSessionId = randomUUID();
    for (const [who, r, scopes] of [['a', a, scopesA], ['b', b, scopesB]] as const) {
      const legal = legalOf(who);
      legal.logPrescription({ prescriptionId: r.plan.planId, engineVersion: r.plan.engineVersion, rulesVersion: r.plan.rulesVersion, reasonCodes: codes(r.plan) });
      for (const event of r.safetyEvents) legal.logSafetyEvent(event);
      legal.logPairEvent('pair.joined', { pairSessionId, role: who === 'a' ? 'host' : 'partner', mode: 'single_device', scopes: [...(scopes ?? [])], consentVersion: 1 });
      legal.logPairEvent('pair.timeline_built', { pairSessionId, planId: r.plan.planId, engineVersion: full.engineVersion, rulesVersion: full.rulesVersion, reasonCodes: full.reasonCodes });
      if (challenge) legal.logPairEvent('pair.challenge_started', { pairSessionId, rulesVersion: PAIR_RULES_VERSION });
    }
    const record: PairSession = {
      schemaVersion: 1,
      pairSessionId,
      mode: 'single_device',
      createdAt: startedAt,
      participants: [
        { slot: 'a', participantId: randomUUID(), kind: 'owner', displayName: nameOf('a'), sharing: { scopes: [...(scopesA ?? [])], consentVersion: 1, recordedAt: startedAt } },
        { slot: 'b', participantId: guestId, kind: 'guest', displayName: nameOf('b'), sharing: { scopes: [...(scopesB ?? [])], consentVersion: 1, recordedAt: startedAt } },
      ],
      timeline: full,
      challenge,
    };
    pairStore.getState().saveSession(record);
    setSession(record);
    const person = (who: Who, plan: SessionPlan, input: GenerateSessionInput): Person => ({ name: nameOf(who), input, plan, done: new Set(), active: true, restEndsAt: null, sets: [], events: [], ended: null });
    setPeople({ a: person('a', a.plan, a.input), b: person('b', b.plan, b.input) });
    setTogetherDone([]);
    setItems(preview.items);
    setMessage(null);
    setStage('run');
  };

  const update = (who: Who, change: (p: Person) => Person) => setPeople((ps) => (ps ? { ...ps, [who]: change({ ...ps[who] }) } : ps));

  const logCurrent = (rir: number | null, skipped = false) => {
    if (!people || !step || step.kind !== 'set') return;
    const who = step.participant!;
    const p = people[who];
    const exercise = p.plan.exercises[step.exerciseIndex!]!;
    const set = exercise.sets[step.setIndex!]!;
    if (!skipped && reps === null) return setMessage(t('workout.pickRepsFirst'));
    const performed: PerformedSet = skipped
      ? { index: set.index, status: 'skipped', reps: null, seconds: null, loadKg: null, rir: null }
      : { index: set.index, status: 'done', reps: set.target.kind === 'reps' ? reps : null, seconds: set.target.kind === 'hold' ? reps : null, loadKg: set.loadKg, rir };
    const loggedAt = clock.now().toISOString();
    logFor(who).set({ schemaVersion: 1, planId: p.plan.planId, exerciseIndex: step.exerciseIndex!, exerciseId: exercise.exerciseId, set: performed, loggedAt, correctionOf: null });
    // RIR autoregulation for this person only (never heavier).
    const adjusted = skipped ? exercise : autoregulateRemainingSets(p.input, exercise, performed);
    update(who, (q) => ({
      ...q,
      plan: adjusted === exercise ? q.plan : { ...q.plan, exercises: q.plan.exercises.map((e, i) => (i === step.exerciseIndex ? adjusted : e)) },
      done: new Set([...q.done, setKey(step.exerciseIndex!, step.setIndex!)]),
      restEndsAt: skipped ? q.restEndsAt : nowMs() + set.restSeconds * 1000,
      sets: [...q.sets, { exerciseIndex: step.exerciseIndex!, exerciseId: exercise.exerciseId, set: performed, loggedAt }],
    }));
    setLastTurn(who);
    setMessage(null);
    setTick((x) => x + 1);
  };

  /** One person leaves (L4 stop, or S3); the other can go on alone. The partner is never told why. */
  const leave = (who: Who, reason: 'user_stop' | 'red_flag') => {
    if (!people) return;
    const p = people[who];
    const at = clock.now().toISOString();
    const ended: ExecutionLog = { kind: 'ended', planId: p.plan.planId, reason, at };
    logFor(who).execution(ended);
    const other: Who = who === 'a' ? 'b' : 'a';
    legalOf(who).logPairEvent('pair.left', { pairSessionId: session!.pairSessionId, reason: reason === 'red_flag' ? 'safety_stop' : 'stopped' });
    legalOf(other).logPairEvent('pair.partner_left', { pairSessionId: session!.pairSessionId });
    update(who, (q) => ({ ...q, active: false, ended: reason, restEndsAt: null, events: [...q.events, ended] }));
    setSheet(null);
    setMessage(people[other].active ? t('pair.left', { name: p.name, other: people[other].name }) : null);
  };

  const redFlag = (who: Who, symptom: RedFlagSymptom) => {
    if (!people) return;
    const p = people[who];
    const event: ExecutionLog = { kind: 'red_flag', planId: p.plan.planId, symptom, at: clock.now().toISOString() };
    logFor(who).execution(event);
    // S3 in this person's own defensibility buffer; the seek-care notice is shown to them (L3).
    const legal = legalOf(who);
    legal.logSafetyEvent({ invariant: 'S3', reasonCode: `safety.s3.${symptom}`, action: 'session_ended', engineVersion: p.plan.engineVersion });
    legal.logSafetyEvent({ invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: p.plan.engineVersion });
    legal.recordNotice(notice('seek_care'), 'shown', locale);
    update(who, (q) => ({ ...q, events: [...q.events, event] }));
    leave(who, 'red_flag');
    setSeekCare(who);
  };

  const savePain = () => {
    if (!people || !sheet || painJoint === null || painScore === null) return;
    const who = sheet.who;
    const p = people[who];
    const event: ExecutionLog = { kind: 'pain', planId: p.plan.planId, joint: painJoint, score: painScore, at: clock.now().toISOString(), phase: 'during' };
    logFor(who).execution(event);
    // S2 now, for this person only: a red joint swaps or drops the rest of their exercises that load it.
    const current = step?.participant === who ? step.exerciseIndex! : 0;
    const changes = painAdjustments(p.input, p.plan, current, painJoint, painScore, nowMs());
    let plan = p.plan;
    let done = new Set(p.done);
    for (const change of changes) {
      const from = plan.exercises[change.exerciseIndex]!;
      if (change.replacement) {
        logFor(who).execution({ kind: 'swapped', planId: plan.planId, exerciseIndex: change.exerciseIndex, fromExerciseId: from.exerciseId, replacement: change.replacement, reason: 'pain', at: event.at });
        plan = { ...plan, exercises: plan.exercises.map((e, i) => (i === change.exerciseIndex ? change.replacement! : e)) };
      } else {
        logFor(who).execution({ kind: 'exercise_skipped', planId: plan.planId, exerciseIndex: change.exerciseIndex, at: event.at });
        done = new Set([...done, ...from.sets.map((_, s) => setKey(change.exerciseIndex, s))]);
      }
    }
    update(who, (q) => ({ ...q, plan, done, events: [...q.events, event] }));
    setPainJoint(null);
    setPainScore(null);
    setSheet(null);
    setMessage(t('pair.pain.saved', { name: p.name }));
  };

  const finish = (ps: { a: Person; b: Person }) => {
    const at = clock.now().toISOString();
    for (const who of ['a', 'b'] as const) {
      const p = ps[who];
      if (!p.active) continue;
      const ended: ExecutionLog = { kind: 'ended', planId: p.plan.planId, reason: 'completed', at };
      logFor(who).execution(ended);
      legalOf(who).logPairEvent('pair.left', { pairSessionId: session!.pairSessionId, reason: 'completed' });
      p.events = [...p.events, ended];
      p.ended = 'completed';
      p.active = false;
    }
    setPeople({ ...ps });
    setStage('done');
  };

  // ------------------------------------------------------------------ render
  const partnerCard = (who: Who) => {
    if (!people) return null;
    const p = people[who];
    const scopes = who === 'a' ? scopesA : scopesB;
    const next = timeline?.steps.find((s) => s.kind === 'set' && s.participant === who);
    const bodyweightKg = who === 'a' ? (profile?.biometrics.weightKg ?? null) : (guest?.profile.bodyweightKg ?? null);
    const view = partnerView({ displayName: p.name, bodyweightKg, exerciseId: next ? p.plan.exercises[next.exerciseIndex!]!.exerciseId : null, loadKg: next ? p.plan.exercises[next.exerciseIndex!]!.sets[next.setIndex!]!.loadKg : null, score: null }, scopes);
    const rest = who === 'a' ? restA : restB;
    return (
      <Card title={view.displayName ?? t('pair.partner.unnamed')} testID={`pair-card-${who}`}>
        {view.bodyweightKg !== null ? (
          <Text style={muted} testID={`pair-card-${who}-bodyweight`}>
            {t('pair.card.bodyweight', { weight: mass(view.bodyweightKg) })}
          </Text>
        ) : null}
        {!p.active ? <Text style={muted}>{t('pair.card.finished')}</Text> : null}
        {p.active && view.exerciseId ? <Text style={muted}>{t('pair.card.next', { exercise: exerciseName(view.exerciseId) })}</Text> : null}
        {p.active && view.loadKg !== null ? <Text style={muted}>{t('pair.card.load', { load: mass(view.loadKg) })}</Text> : null}
        {p.active && rest > 0 ? (
          <Text accessibilityRole="timer" style={muted} testID={`pair-card-${who}-rest`}>
            {t('pair.card.resting', { seconds: Math.ceil(rest / 1000) })}
          </Text>
        ) : null}
        {p.active ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Button label={t('pair.painFor', { name: p.name })} hint={t('workout.painHint')} variant="secondary" onPress={() => setSheet({ kind: 'pain', who })} testID={`pair-pain-${who}`} />
            <Button label={t('pair.stopFor', { name: p.name })} hint={t('pair.stopHint', { name: p.name })} variant="danger" onPress={() => setSheet({ kind: 'stop', who })} testID={`pair-stop-${who}`} />
          </View>
        ) : null}
      </Card>
    );
  };

  const shell = (testID: string, children: React.ReactNode, sheets?: React.ReactNode) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID={testID}>
        {children}
        <Text style={muted}>{t('workout.draftNote')}</Text>
      </ScrollView>
      {sheets}
    </SafeAreaView>
  );

  if (stage === 'partner') {
    return shell(
      'pair-partner',
      <PartnerSetup
        guestId={editing}
        onCancel={() => setStage('setup')}
        onDone={(id) => {
          setGuestId(id);
          setEditing(null);
          setStage('setup');
        }}
      />,
    );
  }

  if (!access.allowed || !profile) {
    return shell(
      'pair-locked',
      <>
        <Text accessibilityRole="header" style={title}>
          {t('pair.title')}
        </Text>
        <Text style={text}>{t('pair.ownerFirst')}</Text>
        <Button label={t('workout.back')} variant="secondary" onPress={onExit} testID="pair-back" />
      </>,
    );
  }

  if (stage === 'setup') {
    const consentDoc = ownerLegal.render('consent.partner_sharing', locale);
    const guestReady = (id: string) => {
      const g = pairStore.getState().guest(id);
      const l = pairStore.getState().ledgers(id);
      return !!g && !!g.profile.screening && guestWorkoutGate(l, clock.now(), jurisdiction).allowed && sharedScopes(l.consents.getState().records, g.sharing) !== null;
    };
    return shell(
      'pair-setup',
      <>
        <Text accessibilityRole="header" style={title}>
          {t('pair.title')}
        </Text>
        <Text style={text}>{t('pair.intro')}</Text>
        <Input label={t('pair.owner.nameLabel')} hint={t('pair.owner.nameHint')} value={nameDraft} onChangeText={setNameDraft} testID="pair-owner-name" />
        {ownerSharingConsent ? null : (
          <Card title={consentDoc.title} testID="pair-owner-consent">
            {consentDoc.sections.map((s) => (
              <Text key={s.key} style={text}>
                {s.text}
              </Text>
            ))}
            <Button
              label={t('pair.consent.agree')}
              hint={t('pair.consent.agreeHint')}
              onPress={() => {
                // The owner's own M17 consent (the ProfileProvider copies it to the owner's defensibility buffer).
                decideOwner('partner_sharing', true, locale);
              }}
              testID="pair-owner-consent-agree"
            />
          </Card>
        )}
        <SharingChoices name={nameDraft.trim() || t('pair.you')} value={ownerScopes} onChange={setOwnerScopes} testPrefix="pair-owner" />
        <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
          {t('pair.partner.title')}
        </Text>
        {guests.map((g) => (
          <Card key={g.id} title={g.displayName} testID={`pair-guest-${g.id}`}>
            <Chip label={t('pair.partner.choose', { name: g.displayName })} selected={guestId === g.id} onPress={() => setGuestId(g.id)} testID={`pair-choose-${g.displayName}`} />
            {!guestReady(g.id) ? <Text style={muted}>{t('pair.partner.incomplete')}</Text> : null}
            <Button label={t('pair.partner.edit', { name: g.displayName })} variant="secondary" onPress={() => (setEditing(g.id), setGuestId(g.id), setStage('partner'))} testID={`pair-edit-${g.displayName}`} />
            <Button
              label={t('pair.partner.export', { name: g.displayName })}
              hint={t('pair.partner.exportHint')}
              variant="secondary"
              onPress={async () => {
                // MOB-06: the partner's export is handed to the share sheet (save or send); "exported" only once that worked.
                try {
                  await io.shareFile(`partner-export-${localIsoDate(clock.now())}.json`, pairStore.getState().exportGuest(g.id), 'application/json');
                  setMessage(t('pair.partner.exported', { name: g.displayName }));
                } catch (error) {
                  reportError(error, { area: 'ui' });
                  setMessage(t('pair.partner.exportFailed', { name: g.displayName }));
                }
              }}
              testID={`pair-export-${g.displayName}`}
            />
            <Button
              label={t('pair.partner.delete', { name: g.displayName })}
              hint={t('pair.partner.deleteHint')}
              variant="danger"
              onPress={() => {
                pairStore.getState().deleteGuest(g.id);
                if (guestId === g.id) setGuestId(null);
                setMessage(t('pair.partner.deleted', { name: g.displayName }));
              }}
              testID={`pair-delete-${g.displayName}`}
            />
          </Card>
        ))}
        <Button label={t('pair.partner.add')} variant="secondary" onPress={() => (setEditing(null), setStage('partner'))} testID="pair-add-partner" />
        <Text style={text}>{t('pair.place')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {places.map((p) => (
            <Chip key={p.id} label={t(`location.${p.data.location}` as MessageKey)} selected={(placeId ?? (ownerFacts?.status === 'ready' ? ownerFacts.placeId : null)) === p.id} onPress={() => setPlaceId(p.id)} testID={`pair-place-${p.data.location}`} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {SESSION_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={t('pair.minutes', { minutes: m })} selected={(minutes ?? profile.schedule.minutesPerSession) === m} onPress={() => setMinutes(m)} testID={`pair-minutes-${m}`} />
          ))}
        </View>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={text} testID="pair-message">
            {message}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }} testID="pair-error">
            {error}
          </Text>
        ) : null}
        <Button
          label={t('pair.preview.open')}
          onPress={() => {
            if (saveOwnerSetup() !== true) return;
            if (!guestId || !guestReady(guestId)) return setError(t('pair.partner.needed'));
            setError(null);
            setMessage(null);
            setStage('preview');
          }}
          testID="pair-preview"
        />
        <Button label={t('workout.back')} variant="secondary" onPress={onExit} testID="pair-back" />
      </>,
    );
  }

  if (stage === 'preview') {
    if (!preview || preview.result.status !== 'ok') {
      const a = preview?.result.a.status === 'unavailable';
      return shell(
        'pair-unavailable',
        <>
          <Text accessibilityRole="header" style={title}>
            {t('pair.preview.title')}
          </Text>
          {/* Each person's reason stays with them; the pair only learns that one of them cannot train today. */}
          <Text style={text}>{t('pair.preview.unavailable', { name: a || !preview ? nameOf('a') : nameOf('b') })}</Text>
          <Button label={t('workout.back')} variant="secondary" onPress={() => setStage('setup')} testID="pair-back" />
        </>,
      );
    }
    const { a, b, timeline: full } = preview.result;
    return shell(
      'pair-preview',
      <>
        <Text accessibilityRole="header" style={title}>
          {t('pair.preview.title')}
        </Text>
        <Text style={text} testID="pair-preview-minutes">
          {t('pair.preview.minutes', { minutes: Math.round(full.totalSeconds / 60) })}
        </Text>
        {full.blocks.map((block) => (
          <Card key={block.index} title={block.pattern ? t(`library.pattern.${block.pattern}` as MessageKey) : t(`pair.together.${block.kind}` as MessageKey, { minutes: Math.round((full.steps.find((s) => s.block === block.index)?.durationSeconds ?? 0) / 60) })} testID={`pair-block-${block.index}`}>
            {block.a !== null ? <Text style={text}>{t('pair.preview.person', { name: nameOf('a'), exercise: exerciseName(a.plan.exercises[block.a]!.exerciseId), sets: a.plan.exercises[block.a]!.sets.length })}</Text> : null}
            {block.b !== null ? <Text style={text}>{t('pair.preview.person', { name: nameOf('b'), exercise: exerciseName(b.plan.exercises[block.b]!.exerciseId), sets: b.plan.exercises[block.b]!.sets.length })}</Text> : null}
            {block.reasonCodes.map((code) => (
              <Text key={code} style={muted}>
                {t(`engine.reason.${code}` as MessageKey, { seconds: block.conflict?.changeoverSeconds ?? 0 })}
              </Text>
            ))}
          </Card>
        ))}
        <Text style={text} testID="pair-challenge-status">
          {challenge ? t('pair.challenge.on') : t('pair.challenge.off')}
        </Text>
        {(['a', 'b'] as const).flatMap((who) =>
          (who === 'a' ? pendingA : pendingB).map((n) => {
            const rendered = renderNotice(n, locale, jurisdiction);
            return (
              <Card key={`${who}-${n.id}`} title={t('pair.notice.for', { name: nameOf(who), title: rendered.title })} testID={`pair-notice-${who}-${n.id}`}>
                <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{rendered.draftBanner}</Text>
                <Text style={text}>{rendered.body}</Text>
                <Button label={t('pair.notice.ack', { name: nameOf(who) })} hint={t('legal.action.acknowledgeHint')} onPress={() => legalOf(who).recordNotice(n, 'acknowledged', locale)} testID={`pair-notice-${who}-${n.id}-ack`} />
              </Card>
            );
          }),
        )}
        <Button label={t('pair.start')} disabled={pendingA.length + pendingB.length > 0} onPress={start} testID="pair-start" />
        <Button label={t('workout.back')} variant="secondary" onPress={() => setStage('setup')} testID="pair-back" />
      </>,
    );
  }

  if (stage === 'done' && people) {
    const score = (who: Who): FairScore => fairScore({ participant: who, plan: people[who].plan, sets: people[who].sets, events: people[who].events });
    const sa = score('a');
    const sb = score('b');
    return shell(
      'pair-done',
      <>
        <Text accessibilityRole="header" style={title}>
          {t('pair.done.title')}
        </Text>
        {seekCare ? <PairSeekCare legal={seekCare === 'a' ? null : guestLedgers!.legal} name={nameOf(seekCare)} /> : null}
        {/* A6 pre-review (fix-queue): a cooperative summary by default; each person's own count only if they choose to see it. */}
        <Text style={text} testID="pair-done-together">
          {t('pair.done.together', { count: (['a', 'b'] as const).reduce((n, who) => n + people[who].sets.filter((s) => s.set.status === 'done').length, 0) })}
        </Text>
        {showEach ? (
          (['a', 'b'] as const).map((who) => (
            <Text key={who} style={text} testID={`pair-done-${who}`}>
              {t('pair.done.person', { name: people[who].name, sets: people[who].sets.filter((s) => s.set.status === 'done').length })}
            </Text>
          ))
        ) : (
          <Button label={t('pair.done.showEach')} hint={t('pair.done.showEachHint')} variant="secondary" onPress={() => setShowEach(true)} testID="pair-done-show-each" />
        )}
        {session?.challenge ? (
          challengeComparable(sa, sb) ? (
            (['a', 'b'] as const).map((who) => (
              <Text key={who} style={text} testID={`pair-score-${who}`}>
                {t('pair.done.score', { name: people[who].name, points: (who === 'a' ? sa : sb).points })}
              </Text>
            ))
          ) : (
            <Text style={muted} testID="pair-score-hidden">
              {t('pair.done.scoreHidden')}
            </Text>
          )
        ) : null}
        <Text style={muted}>{t('pair.done.saved')}</Text>
        <Button label={t('workout.back')} variant="secondary" onPress={onExit} testID="pair-exit" />
      </>,
    );
  }

  // ---- run
  if (!people || !step) return shell('pair-run', <Text style={text}>{t('pair.preview.title')}</Text>);
  const sheets = (
    <>
      <Sheet visible={sheet?.kind === 'pain'} onClose={() => setSheet(null)} title={t('pair.pain.title', { name: sheet ? people[sheet.who].name : '' })} testID="pair-sheet-pain">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {JOINTS.map((j) => (
            <Chip key={j} label={t(`library.joint.${j}` as MessageKey)} selected={painJoint === j} onPress={() => setPainJoint(j)} testID={`pair-pain-joint-${j}`} />
          ))}
        </View>
        <Text style={text}>{t('workout.pain.score')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {Array.from({ length: 11 }, (_, n) => (
            <Chip key={n} label={t('workout.pain.scoreChip', { score: n })} selected={painScore === n} onPress={() => setPainScore(n)} testID={`pair-pain-score-${n}`} />
          ))}
        </View>
        <Button label={t('workout.pain.save')} disabled={painJoint === null || painScore === null} onPress={savePain} testID="pair-pain-save" />
        <Button label={t('pair.stopFor', { name: sheet ? people[sheet.who].name : '' })} hint={t('workout.stopHint')} variant="danger" onPress={() => sheet && leave(sheet.who, 'user_stop')} testID="pair-sheet-stop" />
      </Sheet>
      <Sheet visible={sheet?.kind === 'stop'} onClose={() => setSheet(null)} title={t('pair.stop.title', { name: sheet ? people[sheet.who].name : '' })} testID="pair-sheet-stop-menu">
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }}>{t('workout.stop.unwell')}</Text>
        {RED_FLAG_SYMPTOMS.map((s) => (
          <Button key={s} label={t(`workout.stop.symptom.${s}` as MessageKey)} hint={t('workout.stop.symptomHint')} variant="danger" onPress={() => sheet && redFlag(sheet.who, s)} testID={`pair-stop-symptom-${s}`} />
        ))}
        <Button label={t('pair.stop.end', { name: sheet ? people[sheet.who].name : '' })} hint={t('workout.stopHint')} variant="danger" onPress={() => sheet && leave(sheet.who, 'user_stop')} testID="pair-sheet-stop" />
      </Sheet>
    </>
  );

  const seek = seekCare ? <PairSeekCare legal={seekCare === 'a' ? null : guestLedgers!.legal} name={nameOf(seekCare)} /> : null;

  if (step.kind === 'together') {
    const block = timeline!.blocks[step.block]!;
    return shell(
      'pair-together',
      <>
        {seek}
        <Text accessibilityRole="header" style={title} testID="pair-turn">
          {t(`pair.together.${block.kind}` as MessageKey, { minutes: Math.round(step.durationSeconds / 60) })}
        </Text>
        <Button label={t('pair.together.done')} onPress={() => setTogetherDone([...togetherDone, block.kind])} testID="pair-together-done" />
        <Button label={t('pair.together.skip')} hint={t('workout.skipHint')} variant="secondary" onPress={() => setTogetherDone([...togetherDone, block.kind])} testID="pair-skip" />
        {partnerCard('a')}
        {partnerCard('b')}
      </>,
      sheets,
    );
  }

  const who = step.participant!;
  const other: Who = who === 'a' ? 'b' : 'a';
  const p = people[who];
  const exercise = p.plan.exercises[step.exerciseIndex!]!;
  const set = exercise.sets[step.setIndex!]!;
  const target = set.target;
  const options = target.kind === 'reps' ? Array.from({ length: target.max - Math.max(0, target.min - 2) + 3 }, (_, i) => Math.max(0, target.min - 2) + i) : [target.seconds - 10, target.seconds - 5, target.seconds, target.seconds + 5, target.seconds + 10].filter((x) => x > 0);
  const rest = who === 'a' ? restA : restB;
  return shell(
    `pair-turn-${who}`,
    <>
      {seek}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={text} testID="pair-message">
          {message}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={title} testID="pair-turn">
        {t('pair.turn.title', { name: p.name })}
      </Text>
      <Card title={exerciseName(exercise.exerciseId)} testID={`pair-set-${who}-${step.exerciseIndex}-${step.setIndex}`}>
        <Text style={muted}>{t('pair.turn.progress', { set: step.setIndex! + 1, sets: exercise.sets.length })}</Text>
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="pair-target">
          {target.kind === 'reps' ? t('workout.target.reps', { min: target.min, max: target.max }) : t('workout.target.hold', { seconds: target.seconds })}
          {set.loadKg !== null ? ` · ${mass(set.loadKg)}` : ''}
        </Text>
        <Text style={muted}>{t('workout.target.reserve', { rir: set.targetRir })}</Text>
        {rest > 0 ? (
          <Text accessibilityRole="timer" style={muted} testID="pair-turn-rest">
            {t('pair.turn.restLeft', { name: p.name, seconds: Math.ceil(rest / 1000) })}
          </Text>
        ) : null}
        <Text style={text}>{target.kind === 'reps' ? t('workout.repsQuestion') : t('workout.secondsQuestion')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {options.map((n) => (
            <Chip key={n} label={target.kind === 'reps' ? t('workout.repsChip', { count: n }) : t('workout.secondsChip', { count: n })} selected={reps === n} onPress={() => setReps(n)} testID={`pair-reps-${n}`} />
          ))}
        </View>
        <Text style={text}>{target.kind === 'reps' ? t('workout.rirQuestion') : t('workout.effortQuestion')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} label={t('workout.rirChip', { count: n })} hint={t('workout.rirHint')} selected={false} onPress={() => logCurrent(n)} testID={`pair-rir-${n}`} />
          ))}
        </View>
        <Button label={t('workout.skipSet')} hint={t('workout.skipHint')} variant="secondary" onPress={() => logCurrent(null, true)} testID="pair-skip" />
      </Card>
      {partnerCard(who)}
      {partnerCard(other)}
    </>,
    sheets,
  );
}

/** S3 seek-care guidance for the person who reported the symptom, recorded in their own ledger (null: the owner's). */
function PairSeekCare({ legal, name }: { legal: LegalStore | null; name: string }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const owner = useLegal((s) => s);
  const guest = useStore(legal ?? NO_LEDGERS.legal, (s) => s);
  const store = legal ? guest : owner;
  const rendered = renderNotice(notice('seek_care'), locale, store.jurisdiction);
  const acknowledged = store.notices.some((i) => i.noticeId === 'seek_care' && i.kind === 'acknowledged');
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <Card title={t('pair.seekCare.for', { name, title: rendered.title })} testID="pair-seek-care">
      <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }}>{rendered.draftBanner}</Text>
      <Text style={text}>{rendered.body}</Text>
      {rendered.emergency ? (
        <Text style={{ ...text, fontWeight: theme.fontWeight.bold }} testID="pair-seek-care-emergency">
          {rendered.emergency}
        </Text>
      ) : null}
      {!acknowledged ? <Button label={t('legal.action.acknowledge')} hint={t('legal.action.acknowledgeHint')} onPress={() => store.recordNotice(notice('seek_care'), 'acknowledged', locale)} testID="pair-seek-care-ack" /> : null}
    </Card>
  );
}
