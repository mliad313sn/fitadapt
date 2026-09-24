import { firstWorkoutGate, type LegalDocumentId } from '@fitadapt/legal';
import type { ReassessmentStatus } from '@fitadapt/engine';
import type { CapacityModel, IntensityLock, JointFlags, ProgramRecord, ReadinessCheck, ReflowRecord, SafetyProfile, SessionHistoryEntry } from '@fitadapt/shared';
import { trainingHoldFlags, type RescreenStatus } from '@fitadapt/safety';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { SessionStatus, SessionStore } from '../auth/session-store';
import { clock } from '../clock';
import type { LegalStore, LegalStoreState } from '../legal/legal-store';
import { currentLegalRegistry } from '../legal/registry';
import { useConsents, usePrivacy } from '../privacy/PrivacyProvider';
import type { ProfileState, ProfileStore } from './profile-store';
import { selectCapacity, selectHistory, selectIntensityLock, selectJointFlags, selectMesocycleEnd, selectProgram, selectReadinessChecks, selectReassessment, selectReflows, selectRescreen, selectSafetyProfile } from './selectors';

export interface ProfileContextValue {
  profile: ProfileStore;
  legal: LegalStore;
  /** Absent in screen tests that do not use sign-in. */
  session?: SessionStore;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ profile, legal, session, children }: ProfileContextValue & { children?: ReactNode }) {
  const { consents } = usePrivacy();
  // Consent decisions go to the device defensibility buffer too (L11); health withdrawal forgets health answers.
  useEffect(
    () =>
      consents.subscribe((state, previous) => {
        for (const record of state.records.slice(previous.records.length)) {
          legal.getState().logConsent(record);
          if (record.dataType === 'health' && record.decision === 'withdrawn') profile.getState().forgetHealthData();
        }
      }),
    [consents, legal, profile],
  );
  const value = useMemo(() => ({ profile, legal, session }), [profile, legal, session]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

function useProfileContext(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('must be used inside <ProfileProvider>');
  return ctx;
}

export function useProfile<T>(selector: (state: ProfileState) => T): T {
  return useStore(useProfileContext().profile, selector);
}

export function useLegal<T>(selector: (state: LegalStoreState) => T): T {
  return useStore(useProfileContext().legal, selector);
}

/** Stand-in when no session exists (screen tests): always signed out. */
const signedOut = createStore<{ status: SessionStatus }>(() => ({ status: 'signed_out' }));

export function useSessionStatus(): SessionStatus {
  const session = useProfileContext().session;
  return useStore((session ?? signedOut) as StoreApi<{ status: SessionStatus }>, (s) => s.status);
}

export function useSession(): SessionStore | undefined {
  return useProfileContext().session;
}

/** The typed SafetyProfile selector every screen and module reads (S1, S4, S7; fail-closed). */
export function useSafetyProfile(): SafetyProfile {
  const screenings = useProfile((s) => s.screenings);
  const consents = useConsents((s) => s.records);
  return useMemo(() => selectSafetyProfile(screenings, consents), [screenings, consents]);
}

/** Whether a re-screen is due (12 months, or a newly reported condition), on the app clock. */
export function useRescreen(): RescreenStatus {
  const screenings = useProfile((s) => s.screenings);
  const reported = useProfile((s) => s.newConditionReportedAt);
  return selectRescreen(screenings, reported, clock.now());
}

/** M07: the latest CapacityModel (null before the first assessment or without health consent). */
export function useCapacity(): CapacityModel | null {
  const assessments = useProfile((s) => s.assessments);
  const consents = useConsents((s) => s.records);
  return useMemo(() => selectCapacity(assessments, consents), [assessments, consents]);
}

/** M08: the latest program (null before the first one or without health consent). */
export function useProgram(): ProgramRecord | null {
  const programs = useProfile((s) => s.programs);
  const consents = useConsents((s) => s.records);
  return useMemo(() => selectProgram(programs, consents), [programs, consents]);
}

/** M08: the recorded reflows of the current program, in order. */
export function useReflows(): ReflowRecord[] {
  const reflows = useProfile((s) => s.reflows);
  const programId = useProgram()?.program.programId ?? null;
  return useMemo(() => selectReflows(reflows, programId), [reflows, programId]);
}

/** M07: whether the end-of-mesocycle re-assessment is due, on the app clock (M08 gives the real mesocycle end when a program exists). */
export function useReassessment(): ReassessmentStatus {
  const capacity = useCapacity();
  const program = useProgram();
  return selectReassessment(capacity, clock.now(), selectMesocycleEnd(capacity, program));
}

/** M02: the engine's history of started sessions (none without the health consent). */
export function useSessionHistory(): SessionHistoryEntry[] {
  const workouts = useProfile((s) => s.workouts);
  const setLogs = useProfile((s) => s.setLogs);
  const executionLogs = useProfile((s) => s.executionLogs);
  const consents = useConsents((s) => s.records);
  return useMemo(() => selectHistory(workouts, setLogs, executionLogs, consents), [workouts, setLogs, executionLogs, consents]);
}

/** M05: the readiness checks (none without the health consent). */
export function useReadinessChecks(): ReadinessCheck[] {
  const checks = useProfile((s) => s.readinessChecks);
  const consents = useConsents((s) => s.records);
  return useMemo(() => selectReadinessChecks(checks, consents), [checks, consents]);
}

/** M02 (S2) + M05: joint flags from the pain-monitoring model. */
export function useJointFlags(): JointFlags {
  const executionLogs = useProfile((s) => s.executionLogs);
  return useMemo(() => selectJointFlags(executionLogs), [executionLogs]);
}

/** M02 (S3): the intensity lock after a red-flag stop. */
export function useIntensityLock(): IntensityLock {
  const executionLogs = useProfile((s) => s.executionLogs);
  return useMemo(() => selectIntensityLock(executionLogs), [executionLogs]);
}

export interface FirstWorkoutAccess {
  readonly allowed: boolean;
  readonly onboardingComplete: boolean;
  /** L2 documents still to accept or consent to, in display order. */
  readonly missingLegal: readonly LegalDocumentId[];
  /**
   * FIX-B (CS-1): a symptom flag (or a professional's advice to limit activity) is unresolved: training is on hold
   * until the clearance is attested. The first-workout screen (with the hold explained) and nutrition stay reachable.
   */
  readonly trainingHold: boolean;
  /** Sessions, assessments, the calendar and Fair Pair: `allowed` and no training hold. */
  readonly training: boolean;
}

/**
 * L2 + M01: the first workout is reachable only after onboarding is complete
 * and the current Terms, Privacy Policy, health-data consent and
 * exercise-risk acknowledgment are accepted (packages/legal, fails closed),
 * and never for a user the S7 gate blocks.
 */
export function useFirstWorkoutAccess(): FirstWorkoutAccess {
  const acceptances = useLegal((s) => s.acceptances);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const consents = useConsents((s) => s.records);
  const completed = useProfile((s) => s.profile?.onboardingCompletedAt ?? null);
  const safety = useSafetyProfile();
  const gate = firstWorkoutGate(acceptances, consents, { jurisdiction, now: clock.now(), registry: currentLegalRegistry() });
  const onboardingComplete = completed !== null;
  const allowed = onboardingComplete && gate.allowed && safety.screeningOutcome !== 'blocked';
  const trainingHold = trainingHoldFlags(safety).length > 0;
  return { allowed, onboardingComplete, missingLegal: gate.missing, trainingHold, training: allowed && !trainingHold };
}
