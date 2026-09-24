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
import type { NutritionSettings, NutritionState, NutritionStore } from './nutrition-store';

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
    if (!health || !settings || !profile) return;
    const latest = plans[plans.length - 1]?.data ?? null;
    if (!latest) return;
    const input = buildNutritionInput({ settings, profile, safetyProfile, bodyMetrics, intakeLogs, guardrailEvents, previous: latest, today });
    const reason = planUpkeep(latest, input);
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
  return useMemo(() => {
    if (!profile) return { result: null, stored: false };
    const latest = plans[plans.length - 1]?.data ?? null;
    const chosen = preview ?? settings;
    if (!preview && latest && settings) return { result: { target: latest.target, safetyEvents: [] }, stored: true };
    const input = buildNutritionInput({ settings: chosen ?? DEFAULT_SETTINGS, profile, safetyProfile, bodyMetrics, intakeLogs, guardrailEvents, previous: latest, today });
    return { result: computeNutritionTarget(input, createEngineContext({ clock: { now: () => clock.now().getTime() }, seed: 1 })), stored: false };
  }, [profile, safetyProfile, bodyMetrics, settings, plans, intakeLogs, guardrailEvents, today, preview]);
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
