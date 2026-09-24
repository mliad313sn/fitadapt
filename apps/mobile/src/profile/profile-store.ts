import { evaluateScreening, orderScreenings, screeningHeads } from '@fitadapt/safety';
import { readinessHeadsOn } from '@fitadapt/engine';
import {
  ASSESSMENT_COLLECTION,
  AssessmentRecordSchema,
  EMPTY_BIOMETRICS,
  EQUIPMENT_LOCATIONS,
  EquipmentProfileSchema,
  PROFILE_COLLECTIONS,
  PROFILE_RECORD_ID,
  PROGRAM_COLLECTIONS,
  ProfileSchema,
  ProgramRecordSchema,
  RECOVERY_COLLECTIONS,
  ReadinessCheckSchema,
  ReflowRecordSchema,
  SESSION_COLLECTIONS,
  ScreeningRecordSchema,
  SetLogSchema,
  ExecutionLogSchema,
  WorkoutSessionRecordSchema,
  type AssessmentRecord,
  type Biometrics,
  type CalendarDateValue,
  type EquipmentId,
  type EquipmentLocation,
  type EquipmentProfile,
  type ExperienceLevel,
  type GoalId,
  type Joint,
  type Profile,
  type ProgramRecord,
  type ReflowRecord,
  type Schedule,
  type ScreeningAnswer,
  type ScreeningQuestionId,
  type ScreeningRecord,
  type ExecutionLog,
  type SetLog,
  type WorkoutSessionRecord,
  type ReadinessCheck,
} from '@fitadapt/shared';
import type { SyncClient } from '@fitadapt/sync';
import type { z } from 'zod';
import { createStore } from 'zustand';
import { executionLinks, orderAssessments, orderPrograms, orderReflows, reflowHeads } from './history';
import type { KeyValueStore } from '../storage/app-state';

const DRAFT_KEY = 'onboarding_draft';
const NEW_CONDITION_KEY = 'health_new_condition_reported_at';
/** Rejected screening/assessment mutations a later screening (or assessment) of the user answered. */
const RESOLVED_REJECTIONS_KEY = 'health_resolved_rejections';

function resolvedRejections(kv: KeyValueStore): Set<string> {
  try {
    const raw: unknown = JSON.parse(kv.get(RESOLVED_REJECTIONS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Integration FIX-B × FIX-E: the server rejected the device's screening (or
 * assessment) and sync removed it, so the history only holds the previous,
 * accepted one — which may be looser. Until the user answers again, the device
 * treats this as `screeningRejected` (fail closed). A rejection is answered only
 * by a later save in the same collection on this device (never by a clock).
 */
export function unresolvedHealthRejections(sync: Pick<SyncClient, 'rejectedMutations'>, kv: KeyValueStore): string[] {
  const resolved = resolvedRejections(kv);
  return sync
    .rejectedMutations()
    .filter((r) => (r.collection === PROFILE_COLLECTIONS.screenings || r.collection === ASSESSMENT_COLLECTION) && !resolved.has(r.mutationId))
    .map((r) => r.mutationId);
}

/** What the user has entered so far; kept on the device so onboarding resumes after a relaunch. */
export interface OnboardingDraft {
  primaryGoal: GoalId | null;
  secondaryGoal: GoalId | null;
  experience: ExperienceLevel | null;
  schedule: Schedule;
  birthDate: CalendarDateValue | null;
  biometrics: Biometrics;
  limitations: Joint[];
  motivation: string;
  answers: Partial<Record<ScreeningQuestionId, ScreeningAnswer>>;
  clearanceAttested: boolean;
}

export const EMPTY_DRAFT: OnboardingDraft = Object.freeze({
  primaryGoal: null,
  secondaryGoal: null,
  experience: null,
  schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false },
  birthDate: null,
  biometrics: EMPTY_BIOMETRICS,
  limitations: [],
  motivation: '',
  answers: {},
  clearanceAttested: false,
});

export interface StoredEquipmentProfile {
  readonly id: string;
  readonly data: EquipmentProfile;
}

export interface StoredScreening {
  readonly id: string;
  readonly data: ScreeningRecord;
}

export interface StoredAssessment {
  readonly id: string;
  readonly data: AssessmentRecord;
}

export interface StoredProgram {
  readonly id: string;
  readonly data: ProgramRecord;
}

export interface StoredReflow {
  readonly id: string;
  readonly data: ReflowRecord;
}

/** M02: a started session (the executed prescription), a logged set, an execution event. */
export interface StoredWorkout {
  readonly id: string;
  readonly data: WorkoutSessionRecord;
}

export interface StoredSetLog {
  readonly id: string;
  readonly data: SetLog;
}

export interface StoredExecutionLog {
  readonly id: string;
  readonly data: ExecutionLog;
}

export interface StoredReadinessCheck {
  readonly id: string;
  readonly data: ReadinessCheck;
}

export interface ProfileStoreDeps {
  sync: SyncClient;
  kv: KeyValueStore;
  now: () => Date;
  /** Called after every local write (e.g. to refresh the outbox count). */
  onWrite?: () => void;
}

export interface ProfileState {
  profile: Profile | null;
  equipment: StoredEquipmentProfile[];
  screenings: StoredScreening[];
  /** M07 assessments (append-only; the latest CapacityModel counts). */
  assessments: StoredAssessment[];
  /** M08 programs (append-only; the latest counts) and reflows (append-only, in the order decided). */
  programs: StoredProgram[];
  reflows: StoredReflow[];
  /** M02 started sessions, set logs and execution events (all append-only, in the order recorded). */
  workouts: StoredWorkout[];
  setLogs: StoredSetLog[];
  executionLogs: StoredExecutionLog[];
  /** M05 readiness checks (append-only; the latest of a day counts). */
  readinessChecks: StoredReadinessCheck[];
  /** FIX-B × FIX-E: the server rejected the latest screening or assessment and the user has not answered again (fail closed). */
  screeningRejected: boolean;
  draft: OnboardingDraft;
  newConditionReportedAt: string | null;
  /** Re-reads the synced records (after a pull). */
  reload(): void;
  /** Account wiped (MOB-01): everything re-read from the device, the onboarding draft and the new-condition flag included. */
  reset(): void;
  updateDraft(patch: Partial<OnboardingDraft>): void;
  saveEquipment(location: EquipmentLocation, equipment: readonly EquipmentId[]): string;
  removeEquipment(id: string): void;
  setActiveEquipment(id: string): void;
  /** Writes the profile from the draft (onboarding step "About you"). */
  saveProfileFromDraft(): Profile;
  /** Evaluates the draft's answers and stores the screening (append-only). */
  saveScreening(reason: ScreeningRecord['reason'], answeredOn: CalendarDateValue): ScreeningRecord;
  completeOnboarding(): void;
  /** M07: stores a completed assessment with its CapacityModel (append-only, works offline). */
  saveAssessment(record: AssessmentRecord): AssessmentRecord;
  /** M08: stores a generated program with its inputs (append-only, works offline). */
  saveProgram(record: ProgramRecord): ProgramRecord;
  /** M08: stores what the engine decided for a session the user could not do (append-only, works offline). */
  saveReflow(record: ReflowRecord): ReflowRecord;
  /** M02: stores the plan the user starts (with its inputs), works offline. */
  saveWorkout(record: WorkoutSessionRecord): WorkoutSessionRecord;
  /** M02: appends one logged set (append-only; a correction is a new entry). */
  logSet(log: SetLog): SetLog;
  /** M02: appends an execution event (swap, skip, pain flag, end, S3 red flag, attested review). */
  logExecution(event: ExecutionLog): ExecutionLog;
  /** M05: stores the optional readiness check (append-only, works offline). */
  logReadiness(check: ReadinessCheck): ReadinessCheck;
  reportNewCondition(): void;
  /** Health consent withdrawn or account wiped: forget health data held on the device. */
  forgetHealthData(): void;
}

function parsed<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const r = schema.safeParse(data);
  return r.success ? r.data : null;
}

function loadDraft(kv: KeyValueStore): OnboardingDraft {
  try {
    const raw = kv.get(DRAFT_KEY);
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<OnboardingDraft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

/**
 * M01 profile on the device (local-first, ADR-002): the profile, equipment
 * profiles and screenings are sync records; the onboarding draft stays in
 * device key/value storage. Every write works offline.
 */
export function createProfileStore({ sync, kv, now, onWrite }: ProfileStoreDeps) {
  const read = () => ({
    profile: parsed(ProfileSchema, sync.get(PROFILE_COLLECTIONS.profile, PROFILE_RECORD_ID)?.data),
    equipment: sync
      .list(PROFILE_COLLECTIONS.equipmentProfiles)
      .map((r) => ({ id: r.id, data: parsed(EquipmentProfileSchema, r.data) }))
      .filter((r): r is StoredEquipmentProfile => r.data !== null)
      .sort((a, b) => EQUIPMENT_LOCATIONS.indexOf(a.data.location) - EQUIPMENT_LOCATIONS.indexOf(b.data.location) || a.id.localeCompare(b.id)),
    // ADR-023: histories where the latest counts are in chain order (`supersedes`), never device-clock order.
    screenings: orderScreenings(
      sync
        .list(PROFILE_COLLECTIONS.screenings)
        .map((r) => ({ id: r.id, data: parsed(ScreeningRecordSchema, r.data) }))
        .filter((r): r is StoredScreening => r.data !== null),
    ).ordered,
    assessments: orderAssessments(
      sync
        .list(ASSESSMENT_COLLECTION)
        .map((r) => ({ id: r.id, data: parsed(AssessmentRecordSchema, r.data) }))
        .filter((r): r is StoredAssessment => r.data !== null),
    ).ordered,
    programs: orderPrograms(
      sync
        .list(PROGRAM_COLLECTIONS.programs)
        .map((r) => ({ id: r.id, data: parsed(ProgramRecordSchema, r.data) }))
        .filter((r): r is StoredProgram => r.data !== null),
    ).ordered,
    reflows: orderReflows(
      sync
        .list(PROGRAM_COLLECTIONS.reflows)
        .map((r) => ({ id: r.id, data: parsed(ReflowRecordSchema, r.data) }))
        .filter((r): r is StoredReflow => r.data !== null),
    ).ordered,
    workouts: sync
      .list(SESSION_COLLECTIONS.workoutSessions)
      .map((r) => ({ id: r.id, data: parsed(WorkoutSessionRecordSchema, r.data) }))
      .filter((r): r is StoredWorkout => r.data !== null)
      .sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt) || a.id.localeCompare(b.id)),
    // Set logs from M00 demos (or any other shape) are ignored: only M02 set logs count.
    setLogs: sync
      .list(SESSION_COLLECTIONS.setLogs)
      .map((r) => ({ id: r.id, data: parsed(SetLogSchema, r.data) }))
      .filter((r): r is StoredSetLog => r.data !== null)
      .sort((a, b) => a.data.loggedAt.localeCompare(b.data.loggedAt) || a.id.localeCompare(b.id)),
    executionLogs: sync
      .list(SESSION_COLLECTIONS.executionLogs)
      .map((r) => ({ id: r.id, data: parsed(ExecutionLogSchema, r.data) }))
      .filter((r): r is StoredExecutionLog => r.data !== null)
      .sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
    readinessChecks: sync
      .list(RECOVERY_COLLECTIONS.readinessChecks)
      .map((r) => ({ id: r.id, data: parsed(ReadinessCheckSchema, r.data) }))
      .filter((r): r is StoredReadinessCheck => r.data !== null)
      .sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
    screeningRejected: unresolvedHealthRejections(sync, kv).length > 0,
  });
  /** A new save in `collection` answers every rejection of that collection seen so far. */
  const resolveRejections = (collection: string) => {
    const ids = sync.rejectedMutations().filter((r) => r.collection === collection).map((r) => r.mutationId);
    if (ids.length === 0) return;
    kv.set(RESOLVED_REJECTIONS_KEY, JSON.stringify([...new Set([...resolvedRejections(kv), ...ids])]));
  };
  const writeProfile = (profile: Profile) => {
    const data = ProfileSchema.parse(profile);
    if (sync.get(PROFILE_COLLECTIONS.profile, PROFILE_RECORD_ID)) sync.update(PROFILE_COLLECTIONS.profile, PROFILE_RECORD_ID, data);
    else sync.insert(PROFILE_COLLECTIONS.profile, data, PROFILE_RECORD_ID);
  };

  return createStore<ProfileState>((set, get) => {
    const written = () => {
      set(read());
      onWrite?.();
    };
    return {
      ...read(),
      draft: loadDraft(kv),
      newConditionReportedAt: kv.get(NEW_CONDITION_KEY) ?? null,
      reload: () => set(read()),
      reset: () => set({ ...read(), draft: loadDraft(kv), newConditionReportedAt: kv.get(NEW_CONDITION_KEY) ?? null }),
      updateDraft(patch) {
        const draft = { ...get().draft, ...patch };
        kv.set(DRAFT_KEY, JSON.stringify(draft));
        set({ draft });
      },
      saveEquipment(location, equipment) {
        const data = EquipmentProfileSchema.parse({ location, equipment: [...new Set(equipment)] });
        const existing = get().equipment.find((p) => p.data.location === location);
        const id = existing ? existing.id : sync.insert(PROFILE_COLLECTIONS.equipmentProfiles, data);
        if (existing) sync.update(PROFILE_COLLECTIONS.equipmentProfiles, existing.id, data);
        written();
        return id;
      },
      removeEquipment(id) {
        sync.remove(PROFILE_COLLECTIONS.equipmentProfiles, id);
        const profile = get().profile;
        if (profile?.activeEquipmentProfileId === id) writeProfile({ ...profile, activeEquipmentProfileId: null });
        written();
      },
      setActiveEquipment(id) {
        const profile = get().profile;
        if (!profile) return;
        writeProfile({ ...profile, activeEquipmentProfileId: id });
        written();
      },
      saveProfileFromDraft() {
        const d = get().draft;
        if (!d.primaryGoal || !d.experience || !d.birthDate) throw new Error('onboarding draft incomplete');
        const current = get().profile;
        const profile: Profile = {
          schemaVersion: 1,
          goals: { primary: d.primaryGoal, secondary: d.secondaryGoal === d.primaryGoal ? null : d.secondaryGoal },
          experience: d.experience,
          schedule: d.schedule,
          birthDate: d.birthDate,
          biometrics: d.biometrics,
          limitations: d.limitations.map((region) => ({ region })),
          excludedExerciseIds: current?.excludedExerciseIds ?? [],
          motivation: d.motivation.trim() === '' ? null : d.motivation.trim(),
          activeEquipmentProfileId: current?.activeEquipmentProfileId ?? get().equipment[0]?.id ?? null,
          onboardingCompletedAt: current?.onboardingCompletedAt ?? null,
        };
        writeProfile(profile);
        written();
        return profile;
      },
      saveScreening(reason, answeredOn) {
        const d = get().draft;
        const profile = get().profile;
        if (!d.birthDate) throw new Error('date of birth missing');
        const responses = {
          answers: d.answers,
          clearanceAttested: d.clearanceAttested,
          birthDate: d.birthDate,
          answeredOn,
          limitations: d.limitations.map((region) => ({ region })),
          excludedExerciseIds: profile?.excludedExerciseIds ?? [],
        };
        // ADR-023: the new screening names every screening it replaces, so neither the clock nor the arrival order can make an older one "latest".
        const record = ScreeningRecordSchema.parse({ reason, responses, safetyProfile: evaluateScreening(responses), completedAt: now().toISOString(), supersedes: screeningHeads(get().screenings) });
        sync.insert(PROFILE_COLLECTIONS.screenings, record);
        resolveRejections(PROFILE_COLLECTIONS.screenings);
        kv.remove(NEW_CONDITION_KEY);
        set({ newConditionReportedAt: null });
        written();
        return record;
      },
      completeOnboarding() {
        const profile = get().profile;
        if (!profile || profile.onboardingCompletedAt) return;
        writeProfile({ ...profile, onboardingCompletedAt: now().toISOString() });
        written();
      },
      saveAssessment(record) {
        const data = AssessmentRecordSchema.parse({ ...record, supersedes: orderAssessments(get().assessments).heads.map((a) => a.id) });
        sync.insert(ASSESSMENT_COLLECTION, data);
        resolveRejections(ASSESSMENT_COLLECTION);
        written();
        return data;
      },
      saveProgram(record) {
        const data = ProgramRecordSchema.parse({ ...record, supersedes: orderPrograms(get().programs).heads.map((p) => p.id) });
        sync.insert(PROGRAM_COLLECTIONS.programs, data);
        written();
        return data;
      },
      saveReflow(record) {
        const data = ReflowRecordSchema.parse({ ...record, supersedes: reflowHeads(get().reflows, record.programId) });
        sync.insert(PROGRAM_COLLECTIONS.reflows, data);
        written();
        return data;
      },
      saveWorkout(record) {
        const data = WorkoutSessionRecordSchema.parse(record);
        sync.insert(SESSION_COLLECTIONS.workoutSessions, data);
        written();
        return data;
      },
      logSet(log) {
        const data = SetLogSchema.parse(log);
        sync.insert(SESSION_COLLECTIONS.setLogs, data);
        written();
        return data;
      },
      logExecution(event) {
        // ADR-023: pain reports, red flags and attestations carry their causal links (the record id names the event).
        const id = sync.newRecordId();
        const data = ExecutionLogSchema.parse(executionLinks(event, id, get().executionLogs.map((e) => e.data)));
        sync.insert(SESSION_COLLECTIONS.executionLogs, data, id);
        written();
        return data;
      },
      logReadiness(check) {
        // ADR-023: a re-check names the checks of the same day it replaces.
        const id = sync.newRecordId();
        const data = ReadinessCheckSchema.parse({ ...check, checkId: id, supersedes: readinessHeadsOn(get().readinessChecks.map((c) => c.data), check.date) });
        sync.insert(RECOVERY_COLLECTIONS.readinessChecks, data, id);
        written();
        return data;
      },
      reportNewCondition() {
        const at = now().toISOString();
        kv.set(NEW_CONDITION_KEY, at);
        set({ newConditionReportedAt: at });
      },
      forgetHealthData() {
        const draft = { ...get().draft, answers: {}, clearanceAttested: false, biometrics: EMPTY_BIOMETRICS };
        kv.set(DRAFT_KEY, JSON.stringify(draft));
        set({ draft });
      },
    };
  });
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
