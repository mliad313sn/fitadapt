import { computeNutritionTarget, createEngineContext, type NutritionResult } from '@fitadapt/engine';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { clock } from '../clock';
import { featureOn } from '../privacy/consents';
import { useConsents, usePrivacy } from '../privacy/PrivacyProvider';
import { useLegal, useProfile, useSafetyProfile } from '../profile/ProfileProvider';
import { localIsoDate } from '../profile/selectors';
import { useProgress, useProgressContext } from '../progress/ProgressProvider';
import { buildNutritionInput, logNutritionResult, planUpkeep } from './nutrition-input';
import { latestPlan, type NutritionSettings, type NutritionState, type NutritionStore } from './nutrition-store';
import type { NutritionContext as NutritionInputContext } from './nutrition-input';
import type { IsoDate, Profile, SafetyProfile } from '@fitadapt/shared';

/**
 * M10 on the device. Keeps the nutrition plan current without the nutrition
 * screen being open: a new M04 sustained-loss hand-off (S4: the deficit is
 * paused, then reduced), the weekly adaptive update and a changed
 * SafetyProfile each store a new plan from the engine, logged to the device
 * defensibility buffer. Nothing here computes a number. Without the health
 * consent it does nothing and the screen shows no nutrition data; a
 * withdrawal makes the device forget the settings (the server erases the
 * synced records in the withdrawal transaction).
 */
const NutritionContext = createContext<NutritionStore | null>(null);

export function NutritionProvider({ store, children }: { store: NutritionStore; children?: ReactNode }) {
  const { consents } = usePrivacy();
  const records = useConsents((s) => s.records);
  const health = featureOn('nutrition.tracking', records);
  const profile = useProfile((s) => s.profile);
  const safetyProfile = useSafetyProfile();
  const bodyMetrics = useProgress((s) => s.bodyMetrics);
  const settings = useStore(store, (s) => s.settings);
  const plans = useStore(store, (s) => s.plans);
  const intakeLogs = useStore(store, (s) => s.intakeLogs);
  const guardrailEvents = useStore(store, (s) => s.guardrailEvents);
  const logNutritionTarget = useLegal((s) => s.logNutritionTarget);
  const logSafetyEvent = useLegal((s) => s.logSafetyEvent);
  const today = localIsoDate(clock.now());

  useEffect(
    () =>
      consents.subscribe((state, previous) => {
        for (const record of state.records.slice(previous.records.length)) if (record.dataType === 'health' && record.decision === 'withdrawn') store.getState().forget();
      }),
    [consents, store],
  );

  useEffect(() => {
    if (!health || !settings || !profile || plans.length === 0) return;
    // ADR-023: several candidate plans (made on two devices) → a new plan for the current inputs replaces all of them.
    const latest = latestPlan(plans)?.data ?? null;
    const input = buildNutritionInput({ settings, profile, safetyProfile, bodyMetrics, intakeLogs, guardrailEvents, previous: latest, today });
    const reason = latest ? planUpkeep(latest, input) : 'settings_changed';
    if (!reason) return;
    logNutritionResult({ logNutritionTarget, logSafetyEvent }, store.getState().recordPlan(input, reason), reason);
  }, [health, settings, profile, safetyProfile, bodyMetrics, intakeLogs, guardrailEvents, plans, today, store, logNutritionTarget, logSafetyEvent]);

  return <NutritionContext.Provider value={store}>{children}</NutritionContext.Provider>;
}

export function useNutritionStore(): NutritionStore {
  const ctx = useContext(NutritionContext);
  if (!ctx) throw new Error('must be used inside <NutritionProvider>');
  return ctx;
}

export function useNutrition<T>(selector: (state: NutritionState) => T): T {
  return useStore(useNutritionStore(), selector);
}

/** The M04 hand-off inbox (M10 consumes it once the supportive notice was seen). */
export function useGuardrailInbox() {
  return useProgressContext().nutrition;
}

/**
 * What the screen shows: with settings, the latest stored plan's target; for
 * a user whose deficit features are off, or before any set-up, the
 * engine's answer for the current profile (never stored until set up).
 */
export function useCurrentNutrition(preview?: NutritionSettings | null): { result: NutritionResult | null; stored: boolean } {
  const profile = useProfile((s) => s.profile);
  const safetyProfile = useSafetyProfile();
  const bodyMetrics = useProgress((s) => s.bodyMetrics);
  const settings = useNutrition((s) => s.settings);
  const plans = useNutrition((s) => s.plans);
  const intakeLogs = useNutrition((s) => s.intakeLogs);
  const guardrailEvents = useNutrition((s) => s.guardrailEvents);
  const today = localIsoDate(clock.now());
  return useMemo(
    () => currentNutrition({ profile, safetyProfile, bodyMetrics, settings, plans, intakeLogs, guardrailEvents, today, preview, now: () => clock.now().getTime() }),
    [profile, safetyProfile, bodyMetrics, settings, plans, intakeLogs, guardrailEvents, today, preview],
  );
}

/**
 * The pure decision behind useCurrentNutrition. A stored plan is shown only
 * while it is still the plan for the CURRENT inputs (planUpkeep says keep
 * it). If a re-screen switched deficit features off, a hand-off arrived or
 * the weekly update is due, the stored plan is stale: the screen shows the
 * engine's answer for the current profile instead — never, even for one
 * frame before NutritionProvider's effect stores the new plan, a calorie
 * target the current SafetyProfile forbids (S4, disordered-eating risk).
 */
export function currentNutrition(args: {
  profile: Profile | null;
  safetyProfile: SafetyProfile;
  bodyMetrics: NutritionInputContext['bodyMetrics'];
  settings: NutritionSettings | null;
  plans: NutritionState['plans'];
  intakeLogs: NutritionInputContext['intakeLogs'];
  guardrailEvents: readonly IsoDate[];
  today: IsoDate;
  preview?: NutritionSettings | null;
  now: () => number;
}): { result: NutritionResult | null; stored: boolean } {
  const { profile, safetyProfile, bodyMetrics, settings, plans, intakeLogs, guardrailEvents, today, preview, now } = args;
  if (!profile) return { result: null, stored: false };
  // ADR-023: the chain's single head; several candidates → none is shown (the engine's answer is, fail closed).
  const latest = latestPlan(plans)?.data ?? null;
  const chosen = preview ?? settings;
  const input = buildNutritionInput({ settings: chosen ?? DEFAULT_SETTINGS, profile, safetyProfile, bodyMetrics, intakeLogs, guardrailEvents, previous: latest, today });
  if (!preview && latest && settings && planUpkeep(latest, input) === null) return { result: { target: latest.target, safetyEvents: [] }, stored: true };
  return { result: computeNutritionTarget(input, createEngineContext({ clock: { now }, seed: 1 })), stored: false };
}

/** Before any set-up: maintenance with numbers (the screen only uses it to know whether deficit features are off). */
export const DEFAULT_SETTINGS: NutritionSettings = Object.freeze({
  schemaVersion: 1,
  goal: 'maintain',
  trackingStyle: 'numbers',
  activityLevel: 'light',
  sexForEstimate: 'unspecified',
  plannedLossPercentPerWeek: null,
  goalWeightKg: null,
  heightCm: null,
});
