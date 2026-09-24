import {
  AcceptanceEvidenceSchema,
  chainEvent,
  expectedAssentMethod,
  renderDocument,
  renderNotice,
  verifyChain,
  versionInForce,
  type AcceptanceEvidence,
  type AcceptanceRecord,
  type JurisdictionSource,
  type DefensibilityEvent,
  type DefensibilityEventInput,
  type DefensibilityPayload,
  type LegalDocumentId,
  type NoticeDefinition,
  type NoticeImpression,
  type RenderedDocument,
} from '@fitadapt/legal';
import type { ConsentRecord, Jurisdiction, Locale } from '@fitadapt/shared';
import { z } from 'zod';
import { createStore } from 'zustand';
import type { KeyValueStore } from '../storage/app-state';
import { forgetResidence, readResidence, writeResidence, type ResidenceChoice } from './presentation';
import { currentLegalRegistry } from './registry';

const ACCEPTANCES_KEY = 'legal_acceptances';
const NOTICES_KEY = 'legal_notice_impressions';
const LOG_KEY = 'defensibility_device_log';
/** Device chain of the defensibility buffer: the device has no subject reference (that is the server's pepper). */
export const DEVICE_CHAIN = 'device';

const AcceptanceSchema = z.object({
  id: z.uuid(),
  documentId: z.string(),
  version: z.number().int().positive(),
  locale: z.enum(['fr', 'en']),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  source: z.enum(['mobile', 'web', 'api']),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  acceptedAt: z.iso.datetime({ offset: true }),
  // FIX-B: how assent was given (absent on records made before it).
  evidence: AcceptanceEvidenceSchema.optional(),
});
const ImpressionSchema = z.object({
  id: z.uuid(),
  noticeId: z.string(),
  version: z.number().int().positive(),
  kind: z.enum(['shown', 'acknowledged']),
  locale: z.enum(['fr', 'en']),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  occurredAt: z.iso.datetime({ offset: true }),
});

/** A notice impression as the device stores it (with the hash of what was shown, for upload). */
type PairEventType = 'pair.joined' | 'pair.timeline_built' | 'pair.challenge_started' | 'pair.left' | 'pair.partner_left';

export type DeviceNoticeImpression = NoticeImpression & { readonly id: string; readonly contentHash: string };

function load<T>(kv: KeyValueStore, key: string, schema: z.ZodType<T>): T[] {
  const raw = kv.get(key);
  if (!raw) return [];
  try {
    return z.array(schema).parse(JSON.parse(raw));
  } catch {
    // A corrupt ledger fails closed: nothing is accepted.
    return [];
  }
}

export interface LegalStoreDeps {
  kv: KeyValueStore;
  newId: () => string;
  now: () => Date;
  /** The device locale's jurisdiction; a country of residence the user confirmed (stored in kv) takes precedence. */
  jurisdiction: Jurisdiction;
  /** FIX-B: the app version and build, recorded with every acceptance. */
  appBuild?: string;
}

/** FIX-B: how an acceptance was given on a screen (the store adds the method, the build and the jurisdiction source). */
export interface AssentGiven {
  /** From presentationOf(): the screen and flow version. */
  readonly presentation: string;
  /** The full text was opened before assent. */
  readonly textOpened: boolean;
  /** The statements ticked (every statement of the document). */
  readonly statementIds?: readonly string[];
}

export interface LegalStoreState {
  /** Append-only ledger of L2 acceptances made on this device. */
  acceptances: AcceptanceRecord[];
  /** Append-only ledger of L3 notices shown and acknowledged on this device. */
  notices: DeviceNoticeImpression[];
  /** Device buffer of the defensibility log (hash-chained); the server writes its own log on upload. */
  events: DefensibilityEvent[];
  jurisdiction: Jurisdiction;
  /** FIX-B (B pre-review §1.5 item 1): whether the user confirmed their country of residence or only the device locale is known. */
  jurisdictionSource: JurisdictionSource;
  /** FIX-B: the user answered "Where do you live?": texts, emergency numbers and age rules follow it from now on. */
  confirmResidence(jurisdiction: ResidenceChoice): void;
  /** The version in force of a document, rendered exactly as it is shown (with its content hash). */
  render(documentId: LegalDocumentId, locale: Locale): RenderedDocument;
  /**
   * Records acceptance of the rendered version in force (L2: version, locale, jurisdiction, timestamp, hash).
   * FIX-B: screens pass how assent was given, and the record carries it as evidence. Without it (test helpers,
   * records made before FIX-B) no evidence is recorded.
   */
  accept(documentId: LegalDocumentId, locale: Locale, how?: AssentGiven): AcceptanceRecord;
  recordNotice(notice: NoticeDefinition, kind: 'shown' | 'acknowledged', locale: Locale): DeviceNoticeImpression;
  /** Adds a consent decision to the device defensibility buffer (the ledger itself is the M17 consent store). */
  logConsent(record: ConsentRecord): void;
  /** M07: a safety gate that changed what the user was asked to do (e.g. S1 capping an assessment), for the device buffer (L11). */
  logSafetyEvent(payload: DefensibilityPayload<'safety.event'>): void;
  /** M02: a started session (engine and rules versions, reason codes), for the device buffer (L11). */
  logPrescription(payload: DefensibilityPayload<'prescription.issued'>): void;
  /** M02 (S3): the user attested the review that lifts a lock. */
  logSafetyAttested(payload: DefensibilityPayload<'safety.attested'>): void;
  /** M09 Fair Pair: this person's own pair events (joined, timeline, challenge, left, partner left). */
  logPairEvent<T extends PairEventType>(type: T, payload: DefensibilityPayload<T>): void;
  /** M10: a nutrition target the engine prescribed (versions, mode, reason codes; no value). */
  logNutritionTarget(payload: DefensibilityPayload<'nutrition.target_set'>): void;
  clear(): void;
}

/**
 * Device-side L2 acceptances and L3 notice impressions (ADR-008, ADR-013).
 * The same @fitadapt/legal rules as the API decide the first-workout gate, so
 * it works offline; records are uploaded after sign-in with their device time.
 */
export function createLegalStore({ kv, newId, now, jurisdiction: deviceJurisdiction, appBuild = 'unknown' }: LegalStoreDeps) {
  const residence = readResidence(kv);
  const append = (events: DefensibilityEvent[], input: Omit<DefensibilityEventInput, 'chain'>) => {
    const next = [...events, chainEvent(events[events.length - 1], { ...input, chain: DEVICE_CHAIN } as DefensibilityEventInput, newId())];
    kv.set(LOG_KEY, JSON.stringify(next));
    return next;
  };
  const storedEvents = (() => {
    try {
      const raw = kv.get(LOG_KEY);
      const events = raw ? (JSON.parse(raw) as DefensibilityEvent[]) : [];
      return verifyChain(events).ok ? events : [];
    } catch {
      return [];
    }
  })();

  return createStore<LegalStoreState>((set, get) => ({
    acceptances: load(kv, ACCEPTANCES_KEY, AcceptanceSchema) as AcceptanceRecord[],
    notices: load(kv, NOTICES_KEY, ImpressionSchema) as DeviceNoticeImpression[],
    events: storedEvents,
    jurisdiction: residence?.jurisdiction ?? deviceJurisdiction,
    jurisdictionSource: residence ? 'user_confirmed' : 'device_locale',
    confirmResidence(choice) {
      writeResidence(kv, choice, now());
      set({ jurisdiction: choice, jurisdictionSource: 'user_confirmed' });
    },
    render(documentId, locale) {
      const doc = currentLegalRegistry().get(documentId);
      if (!doc) throw new Error(`unknown legal document ${documentId}`);
      return renderDocument(doc, versionInForce(doc, now()), locale, get().jurisdiction);
    },
    accept(documentId, locale, how) {
      const rendered = get().render(documentId, locale);
      const jurisdiction = get().jurisdiction;
      const doc = currentLegalRegistry().get(documentId)!;
      const evidence: AcceptanceEvidence | undefined = how
        ? AcceptanceEvidenceSchema.parse({
            presentation: how.presentation,
            assentMethod: expectedAssentMethod(doc),
            textOpened: how.textOpened,
            appBuild,
            jurisdictionSource: get().jurisdictionSource,
            ...(how.statementIds ? { statementIds: [...how.statementIds] } : {}),
          })
        : undefined;
      const record: AcceptanceRecord = {
        id: newId(),
        documentId,
        version: rendered.version,
        locale,
        jurisdiction,
        source: 'mobile',
        contentHash: rendered.contentHash,
        acceptedAt: now().toISOString(),
        ...(evidence ? { evidence } : {}),
      };
      const acceptances = [...get().acceptances, record];
      kv.set(ACCEPTANCES_KEY, JSON.stringify(acceptances));
      const events = append(get().events, {
        type: 'acceptance.recorded',
        occurredAt: record.acceptedAt,
        payload: { documentId, version: record.version, locale, jurisdiction, contentHash: record.contentHash, source: 'mobile', ...(evidence ?? {}) },
      });
      set({ acceptances, events });
      return record;
    },
    recordNotice(notice, kind, locale) {
      const jurisdiction = get().jurisdiction;
      const rendered = renderNotice(notice, locale, jurisdiction);
      const impression: DeviceNoticeImpression = {
        id: newId(),
        noticeId: notice.id,
        version: notice.version,
        kind,
        locale,
        jurisdiction,
        contentHash: rendered.contentHash,
        occurredAt: now().toISOString(),
      };
      const notices = [...get().notices, impression];
      kv.set(NOTICES_KEY, JSON.stringify(notices));
      const events = append(get().events, {
        type: kind === 'shown' ? 'notice.shown' : 'notice.acknowledged',
        occurredAt: impression.occurredAt,
        payload: { noticeId: notice.id, version: notice.version, locale, jurisdiction, contentHash: rendered.contentHash },
      });
      set({ notices, events });
      return impression;
    },
    logConsent(record) {
      set({
        events: append(get().events, {
          type: 'consent.recorded',
          occurredAt: record.recordedAt,
          payload: { dataType: record.dataType, decision: record.decision, version: record.version, locale: record.locale, jurisdiction: record.jurisdiction },
        }),
      });
    },
    logSafetyEvent(payload) {
      set({ events: append(get().events, { type: 'safety.event', occurredAt: now().toISOString(), payload }) });
    },
    logPrescription(payload) {
      set({ events: append(get().events, { type: 'prescription.issued', occurredAt: now().toISOString(), payload }) });
    },
    logSafetyAttested(payload) {
      set({ events: append(get().events, { type: 'safety.attested', occurredAt: now().toISOString(), payload }) });
    },
    logPairEvent(type, payload) {
      set({ events: append(get().events, { type, occurredAt: now().toISOString(), payload } as Omit<DefensibilityEventInput, 'chain'>) });
    },
    logNutritionTarget(payload) {
      set({ events: append(get().events, { type: 'nutrition.target_set', occurredAt: now().toISOString(), payload }) });
    },
    clear() {
      for (const key of [ACCEPTANCES_KEY, NOTICES_KEY, LOG_KEY]) kv.remove(key);
      forgetResidence(kv);
      set({ acceptances: [], notices: [], events: [], jurisdiction: deviceJurisdiction, jurisdictionSource: 'device_locale' });
    },
  }));
}

export type LegalStore = ReturnType<typeof createLegalStore>;
