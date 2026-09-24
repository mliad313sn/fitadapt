import type { AcceptanceRecord } from '@fitadapt/legal';
import { orderChain, type ConsentRecord } from '@fitadapt/shared';
import { OfflineError, type SyncClient } from '@fitadapt/sync';
import { ApiRequestError, type JsonPost } from '../auth/auth-api';
import { NotSignedInError } from '../auth/session-store';
import type { DeviceNoticeImpression } from '../legal/legal-store';
import { reportError } from '../observability';
import type { KeyValueStore } from '../storage/app-state';

const UPLOADED_KEY = 'account_uploaded_ids';

/** The API endpoints the device ledgers are uploaded to (M17 consents, M20 acceptances and notices). */
export interface AccountApi {
  postConsent(record: ConsentRecord): Promise<void>;
  postAcceptance(record: AcceptanceRecord): Promise<void>;
  postNotice(impression: DeviceNoticeImpression): Promise<void>;
}

export function createAccountApi(post: JsonPost, getAccessToken: () => Promise<string>): AccountApi {
  return {
    async postConsent(r) {
      await post('/v1/privacy/consents', { id: r.id, dataType: r.dataType, decision: r.decision, version: r.version, locale: r.locale, jurisdiction: r.jurisdiction, source: r.source, recordedAt: r.recordedAt, ...(r.supersedes === undefined ? {} : { supersedes: r.supersedes }) }, await getAccessToken());
    },
    async postAcceptance(r) {
      // FIX-B: how assent was given travels with the record (the API stores it once FIX-C adds the column).
      await post('/v1/legal/acceptances', { id: r.id, documentId: r.documentId, version: r.version, locale: r.locale, jurisdiction: r.jurisdiction, source: r.source, contentHash: r.contentHash, acceptedAt: r.acceptedAt, ...(r.evidence ? { evidence: r.evidence } : {}) }, await getAccessToken());
    },
    async postNotice(n) {
      await post('/v1/legal/notices', { id: n.id, noticeId: n.noticeId, version: n.version, kind: n.kind, locale: n.locale, jurisdiction: n.jurisdiction, contentHash: n.contentHash, occurredAt: n.occurredAt }, await getAccessToken());
    },
  };
}

/** Ids already uploaded (or refused for good), so a record is sent once. */
export class UploadLedger {
  constructor(private readonly kv: KeyValueStore) {}
  private ids(): Set<string> {
    try {
      return new Set(JSON.parse(this.kv.get(UPLOADED_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  has(id: string): boolean {
    return this.ids().has(id);
  }
  add(id: string): void {
    const ids = this.ids();
    ids.add(id);
    this.kv.set(UPLOADED_KEY, JSON.stringify([...ids]));
  }
}

export interface AccountSyncInput {
  api: AccountApi;
  ledger: UploadLedger;
  consents: readonly ConsentRecord[];
  acceptances: readonly AcceptanceRecord[];
  notices: readonly DeviceNoticeImpression[];
  sync: SyncClient;
}

export interface AccountSyncOutcome {
  offline: boolean;
  uploaded: number;
  refused: number;
}

/**
 * Uploads what the device recorded offline, in an order the server needs
 * (ADR-013): consents first (the server refuses health collections without
 * the health consent), then acceptances and notices, then the sync outbox.
 * Stops at the first network failure; nothing is lost, the next run resumes.
 * A record the server refuses for good (4xx: outdated version, too old) is
 * not retried; it stays in the device ledger.
 */
export async function runAccountSync(input: AccountSyncInput): Promise<AccountSyncOutcome> {
  const outcome: AccountSyncOutcome = { offline: false, uploaded: 0, refused: 0 };
  const queue: Array<{ id: string; send: () => Promise<void> }> = [
    // ADR-023: in chain order (each decision after the ones it supersedes), so the server never receives a
    // withdrawal before the grant it withdrew; decisions stored before links: by time, then ledger position.
    ...orderChain(
      input.consents.map((record, position) => ({ record, position })),
      (x) => ({ id: x.record.id, supersedes: x.record.supersedes, at: x.record.recordedAt, legacyRank: x.position }),
    ).ordered.map(({ record: r }) => ({ id: r.id, send: () => input.api.postConsent(r) })),
    ...input.acceptances.map((r) => ({ id: r.id, send: () => input.api.postAcceptance(r) })),
    ...input.notices.map((r) => ({ id: r.id, send: () => input.api.postNotice(r) })),
  ];
  for (const item of queue) {
    if (input.ledger.has(item.id)) continue;
    try {
      await item.send();
      outcome.uploaded += 1;
    } catch (error) {
      if (error instanceof OfflineError || error instanceof NotSignedInError) return { ...outcome, offline: true };
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
        outcome.refused += 1;
        reportError(error, { area: 'sync' });
      } else {
        throw error;
      }
    }
    input.ledger.add(item.id);
  }
  const { push } = await input.sync.sync();
  return { ...outcome, offline: push.offline };
}
