import { firstWorkoutGate, type LegalDocumentId } from '@fitadapt/legal';
import type { SafetyProfile } from '@fitadapt/shared';
import type { RescreenStatus } from '@fitadapt/safety';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { SessionStatus, SessionStore } from '../auth/session-store';
import { clock } from '../clock';
import type { LegalStore, LegalStoreState } from '../legal/legal-store';
import { currentLegalRegistry } from '../legal/registry';
import { useConsents, usePrivacy } from '../privacy/PrivacyProvider';
import type { ProfileState, ProfileStore } from './profile-store';
import { selectRescreen, selectSafetyProfile } from './selectors';

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

export interface FirstWorkoutAccess {
  readonly allowed: boolean;
  readonly onboardingComplete: boolean;
  /** L2 documents still to accept or consent to, in display order. */
  readonly missingLegal: readonly LegalDocumentId[];
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
  return { allowed: onboardingComplete && gate.allowed && safety.screeningOutcome !== 'blocked', onboardingComplete, missingLegal: gate.missing };
}
