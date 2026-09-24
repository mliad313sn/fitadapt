import {
  chainEvent,
  renderDocument,
  renderNotice,
  verifyChain,
  versionInForce,
  type AcceptanceRecord,
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
  jurisdiction: Jurisdiction;
}

export interface LegalStoreState {
  /** Append-only ledger of L2 acceptances made on this device. */
  acceptances: AcceptanceRecord[];
  /** Append-only ledger of L3 notices shown and acknowledged on this device. */
  notices: DeviceNoticeImpression[];
  /** Device buffer of the defensibility log (hash-chained); the server writes its own log on upload. */
  events: DefensibilityEvent[];
  jurisdiction: Jurisdiction;
  /** The version in force of a document, rendered exactly as it is shown (with its content hash). */
  render(documentId: LegalDocumentId, locale: Locale): RenderedDocument;
  /** Records acceptance of the rendered version in force (L2: version, locale, jurisdiction, timestamp, hash). */
  accept(documentId: LegalDocumentId, locale: Locale): AcceptanceRecord;
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
  clear(): void;
}

/**
 * Device-side L2 acceptances and L3 notice impressions (ADR-008, ADR-013).
 * The same @fitadapt/legal rules as the API decide the first-workout gate, so
 * it works offline; records are uploaded after sign-in with their device time.
 */
export function createLegalStore({ kv, newId, now, jurisdiction }: LegalStoreDeps) {
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
    jurisdiction,
    render(documentId, locale) {
      const doc = currentLegalRegistry().get(documentId);
      if (!doc) throw new Error(`unknown legal document ${documentId}`);
      return renderDocument(doc, versionInForce(doc, now()), locale, jurisdiction);
    },
    accept(documentId, locale) {
      const rendered = get().render(documentId, locale);
      const record: AcceptanceRecord = {
        id: newId(),
        documentId,
        version: rendered.version,
        locale,
        jurisdiction,
        source: 'mobile',
        contentHash: rendered.contentHash,
        acceptedAt: now().toISOString(),
      };
      const acceptances = [...get().acceptances, record];
      kv.set(ACCEPTANCES_KEY, JSON.stringify(acceptances));
      const events = append(get().events, {
        type: 'acceptance.recorded',
        occurredAt: record.acceptedAt,
        payload: { documentId, version: record.version, locale, jurisdiction, contentHash: record.contentHash, source: 'mobile' },
      });
      set({ acceptances, events });
      return record;
    },
    recordNotice(notice, kind, locale) {
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
    clear() {
      for (const key of [ACCEPTANCES_KEY, NOTICES_KEY, LOG_KEY]) kv.remove(key);
      set({ acceptances: [], notices: [], events: [] });
    },
  }));
}

export type LegalStore = ReturnType<typeof createLegalStore>;
