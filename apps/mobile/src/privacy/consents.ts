import { CONSENT_POLICIES, consentStates, isFeatureEnabled, policyFor, type ConsentGatedFeature } from '@fitadapt/privacy';
import { ConsentRecordSchema, type ConsentDataType, type ConsentRecord, type Jurisdiction, type Locale } from '@fitadapt/shared';
import { z } from 'zod';
import { createStore } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';

const KEY = 'consent_records';
const LedgerSchema = z.array(ConsentRecordSchema);

export interface ConsentStoreDeps {
  kv: KeyValueStore;
  newId: () => string;
  now?: () => Date;
  jurisdiction: Jurisdiction;
}

export interface ConsentStoreState {
  /** Append-only ledger of decisions made on this device. */
  records: ConsentRecord[];
  decide(dataType: ConsentDataType, granted: boolean, locale: Locale): ConsentRecord;
  /** Forgets every decision (account deletion). */
  clear(): void;
}

function load(kv: KeyValueStore): ConsentRecord[] {
  const raw = kv.get(KEY);
  if (!raw) return [];
  try {
    // zod at the storage boundary; a corrupt ledger fails closed (no consent).
    return LedgerSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Device-side consent ledger (ADR-004). The same @fitadapt/privacy rules as
 * the API decide whether a feature is on, so features work offline and switch
 * off the moment consent is withdrawn. Sending the ledger to the API needs
 * sign-in (M01).
 */
export function createConsentStore({ kv, newId, now = () => new Date(), jurisdiction }: ConsentStoreDeps) {
  return createStore<ConsentStoreState>((set, get) => ({
    records: load(kv),
    decide(dataType, granted, locale) {
      const record: ConsentRecord = {
        id: newId(),
        dataType,
        decision: granted ? 'granted' : 'withdrawn',
        version: policyFor(dataType, jurisdiction, CONSENT_POLICIES).currentVersion,
        locale,
        jurisdiction,
        source: 'mobile',
        recordedAt: now().toISOString(),
      };
      const records = [...get().records, record];
      kv.set(KEY, JSON.stringify(records));
      set({ records });
      return record;
    },
    clear() {
      kv.remove(KEY);
      set({ records: [] });
    },
  }));
}

export type ConsentStore = ReturnType<typeof createConsentStore>;

export const statesOf = (records: readonly ConsentRecord[]) => consentStates(records);
export const featureOn = (feature: ConsentGatedFeature, records: readonly ConsentRecord[]) => isFeatureEnabled(feature, records);
