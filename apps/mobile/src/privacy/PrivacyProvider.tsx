import type { ConsentGatedFeature } from '@fitadapt/privacy';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { AgeGateState, AgeGateStore } from './age-gate';
import { createAnalytics, type Analytics, type AnalyticsTransport } from './analytics';
import type { PrivacyClient } from './client';
import { featureOn, type ConsentStore, type ConsentStoreState } from './consents';

export interface PrivacyContextValue {
  ageGate: AgeGateStore;
  consents: ConsentStore;
  analytics: Analytics;
  /** API client for export and deletion; absent until the user is signed in (M01). */
  client?: PrivacyClient;
  /** Erases the account's data from this device (after a deletion). */
  wipeLocalData: () => void | Promise<void>;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export interface PrivacyProviderProps {
  ageGate: AgeGateStore;
  consents: ConsentStore;
  client?: PrivacyClient;
  analyticsTransport?: AnalyticsTransport;
  wipeLocalData: () => void | Promise<void>;
  children?: ReactNode;
}

export function PrivacyProvider({ ageGate, consents, client, analyticsTransport, wipeLocalData, children }: PrivacyProviderProps) {
  const value = useMemo<PrivacyContextValue>(
    () => ({
      ageGate,
      consents,
      client,
      wipeLocalData,
      analytics: createAnalytics({
        isEnabled: () => featureOn('analytics.product', consents.getState().records),
        transport: analyticsTransport,
      }),
    }),
    [ageGate, consents, client, wipeLocalData, analyticsTransport],
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy must be used inside <PrivacyProvider>');
  return ctx;
}

export function useAgeGate<T>(selector: (state: AgeGateState) => T): T {
  return useStore(usePrivacy().ageGate, selector);
}

export function useConsents<T>(selector: (state: ConsentStoreState) => T): T {
  return useStore(usePrivacy().consents, selector);
}

/** True while every consent the feature needs is granted; re-renders on any decision. */
export function useFeature(feature: ConsentGatedFeature): boolean {
  const records = useConsents((s) => s.records);
  return featureOn(feature, records);
}

/** Renders children only while the feature's consents are granted. */
export function FeatureGate({ feature, children, fallback = null }: { feature: ConsentGatedFeature; children?: ReactNode; fallback?: ReactNode }) {
  return <>{useFeature(feature) ? children : fallback}</>;
}
