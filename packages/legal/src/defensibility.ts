import { z } from 'zod';
import { canonicalJson, sha256Hex } from './sha256.js';

/**
 * Defensibility file (L11): an append-only, hash-chained log of acceptances,
 * consents, notices shown, safety events, engine versions, content approvals,
 * incident handling, legal holds and access to the log itself.
 * docs/adr/ADR-009-defensibility-log.md.
 *
 * - One chain per subject (a keyed, pseudonymous reference to the user, so
 *   the file survives account deletion without personal data) plus a
 *   'global' chain for events that concern no user.
 * - Each event stores the hash of the previous event of its chain; its own
 *   hash covers every field. Changing, removing or reordering any event
 *   breaks verification from that point.
 * - Payloads are closed schemas: identifiers, versions, codes and hashes
 *   only; never names, emails, free text or health values.
 */
export const GENESIS_HASH = '0'.repeat(64);
export const GLOBAL_CHAIN = 'global';

const code = z.string().regex(/^[a-z0-9_.-]{1,80}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const jurisdiction = z.string().regex(/^[A-Z]{2}$/);
const locale = z.enum(['fr', 'en']);
const version = z.number().int().positive();
const engineVersion = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$|^\d{1,4}\.\d{1,4}\.\d{1,4}[-+][0-9A-Za-z.-]{1,40}$/);

export const DefensibilityPayloads = {
  'acceptance.recorded': z.strictObject({ documentId: code, version, locale, jurisdiction, contentHash: hash, source: z.enum(['mobile', 'web', 'api']) }),
  'consent.recorded': z.strictObject({ dataType: code, decision: z.enum(['granted', 'withdrawn']), version, locale, jurisdiction }),
  'notice.shown': z.strictObject({ noticeId: code, version, locale, jurisdiction, contentHash: hash }),
  'notice.acknowledged': z.strictObject({ noticeId: code, version, locale, jurisdiction, contentHash: hash }),
  'safety.event': z.strictObject({
    invariant: z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']),
    reasonCode: code,
    /**
     * M05 adds joint_flagged: a pain report made a joint red (S2), logged with the report.
     * M04 adds handed_off: a sustained body-weight loss was handed to the nutrition guardrails (S4, M10) with a supportive notice.
     * M10 adds deficit_reduced: after that hand-off the nutrition target removed or reduced a planned deficit (S4).
     */
    action: z.enum(['blocked', 'substituted', 'session_ended', 'intensity_locked', 'capped', 'joint_flagged', 'handed_off', 'deficit_reduced']),
    engineVersion,
  }),
  /** M02: a session the user started (the executed prescription): engine and session-rules versions and every reason code it carries. */
  'prescription.issued': z.strictObject({ prescriptionId: z.uuid(), engineVersion, rulesVersion: engineVersion.optional(), reasonCodes: z.array(code).max(200) }),
  /** M02 (S3 hook, M05 builds the flow): the user attested the review that lifts a safety lock. */
  'safety.attested': z.strictObject({ invariant: z.enum(['S1', 'S3']), reasonCode: code, engineVersion }),
  /** M08: a program was generated (engine and rules versions, template); written with the stored program. */
  'program.generated': z.strictObject({ programId: z.uuid(), engineVersion, rulesVersion: engineVersion, templateId: code, reasonCodes: z.array(code).max(50) }),
  /** M08: a session the user could not do was shifted, merged or skipped by the engine; written with the stored reflow. */
  'program.reflowed': z.strictObject({ programId: z.uuid(), sessionId: code, outcome: z.enum(['shifted', 'merged', 'skipped']), engineVersion }),
  /**
   * M09 Fair Pair (each participant's own chain, written with the pair data in one transaction, ADR-009/ADR-021).
   * pair.joined: the participant took part, with the sharing scopes they chose and the consent version;
   * pair.timeline_built: the pair planner ordered the two plans (the participant's own plan id, pair rules version);
   * pair.challenge_started: both partners opted in to the Fair Challenge after the L3 notice;
   * pair.left: the participant's own reason (a safety stop is recorded here, in their chain only);
   * pair.partner_left: the partner left (never the partner's reason).
   */
  'pair.joined': z.strictObject({ pairSessionId: z.uuid(), role: z.enum(['host', 'partner']), mode: z.enum(['single_device', 'multi_device']), scopes: z.array(z.enum(['performance', 'bodyweight', 'challenge'])).max(3), consentVersion: version }),
  'pair.timeline_built': z.strictObject({ pairSessionId: z.uuid(), planId: z.uuid(), engineVersion, rulesVersion: engineVersion, reasonCodes: z.array(code).max(50) }),
  'pair.challenge_started': z.strictObject({ pairSessionId: z.uuid(), rulesVersion: engineVersion }),
  'pair.left': z.strictObject({ pairSessionId: z.uuid(), reason: z.enum(['completed', 'stopped', 'safety_stop', 'consent_withdrawn']) }),
  'pair.partner_left': z.strictObject({ pairSessionId: z.uuid() }),
  /**
   * M10: a nutrition target the engine prescribed (the prescription record for nutrition): its id, engine and
   * nutrition-rules versions, the mode (numbers or supportive, no number in the payload), why it was computed and
   * every reason code. Never a calorie, weight or intake value (health data stays out of the log).
   */
  'nutrition.target_set': z.strictObject({
    targetId: z.uuid(),
    engineVersion,
    rulesVersion: engineVersion,
    mode: z.enum(['numeric', 'supportive', 'needs_measurements']),
    reason: z.enum(['setup', 'weekly_update', 'guardrail', 'settings_changed']),
    deficitAllowed: z.boolean(),
    reasonCodes: z.array(code).max(50),
  }),
  'content.approved': z.strictObject({ contentId: code, contentVersion: version, reviewerSeat: z.string().regex(/^[A-Z]\d{1,2}$/), signOffRecord: z.string().regex(/^[\w./-]{1,200}$/) }),
  'incident.recorded': z.strictObject({
    incidentId: z.uuid(),
    category: z.enum(['injury_report', 'complaint', 'data_breach', 'harmful_content', 'claims_violation', 'other']),
    step: z.enum(['received', 'triaged', 'escalated', 'legal_hold', 'regulator_notified', 'insurer_notified', 'closed']),
  }),
  'legal_hold.placed': z.strictObject({ holdId: z.uuid(), reasonCode: code }),
  'legal_hold.released': z.strictObject({ holdId: z.uuid(), reasonCode: code }),
  'log.accessed': z.strictObject({
    actorRole: code,
    purpose: z.enum(['legal_hold_export', 'integrity_check', 'regulator_request', 'insurer_request', 'user_request']),
    subjectDigest: hash.nullable(),
    eventsReturned: z.number().int().nonnegative(),
  }),
  'retention.purged': z.strictObject({ chainDigest: hash, eventCount: z.number().int().positive(), headHash: hash }),
} as const;

export type DefensibilityEventType = keyof typeof DefensibilityPayloads;
export const DEFENSIBILITY_EVENT_TYPES = Object.keys(DefensibilityPayloads) as DefensibilityEventType[];
export type DefensibilityPayload<T extends DefensibilityEventType> = z.infer<(typeof DefensibilityPayloads)[T]>;

export interface DefensibilityEventInput<T extends DefensibilityEventType = DefensibilityEventType> {
  readonly type: T;
  /** Subject reference (keyed hash of the user id) or GLOBAL_CHAIN. */
  readonly chain: string;
  readonly occurredAt: string;
  readonly payload: DefensibilityPayload<T>;
}

export interface DefensibilityEvent extends DefensibilityEventInput {
  readonly id: string;
  /** Position in its chain, from 1. */
  readonly chainSeq: number;
  readonly prevHash: string;
  readonly hash: string;
}

/** Own keys only: a tampered type such as 'constructor' or 'toString' is unknown, never a prototype member (PKG-10). */
export function isDefensibilityEventType(type: unknown): type is DefensibilityEventType {
  return typeof type === 'string' && Object.hasOwn(DefensibilityPayloads, type);
}

export function parsePayload<T extends DefensibilityEventType>(type: T, payload: unknown): DefensibilityPayload<T> {
  if (!isDefensibilityEventType(type)) throw new Error(`unknown defensibility event type ${String(type)}`);
  return DefensibilityPayloads[type].parse(payload) as DefensibilityPayload<T>;
}

/**
 * The only accepted form of `occurredAt`: ISO 8601 in UTC with a `Z`, as
 * `Date.prototype.toISOString()` writes it (milliseconds optional). Retention
 * compares `occurred_at` as text, which orders correctly only for this form (PKG-11).
 */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const ms = Date.parse(value);
  // Rejects impossible dates (2026-02-30) that Date.parse would roll over.
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function eventHash(e: Omit<DefensibilityEvent, 'hash'>): string {
  return sha256Hex(
    canonicalJson({ id: e.id, chain: e.chain, chainSeq: e.chainSeq, type: e.type, occurredAt: e.occurredAt, payload: e.payload, prevHash: e.prevHash }),
  );
}

/** Builds the next event of a chain. `previous` is the chain's current head (undefined for a new chain). */
export function chainEvent(previous: DefensibilityEvent | undefined, input: DefensibilityEventInput, id: string): DefensibilityEvent {
  if (previous && previous.chain !== input.chain) throw new Error('previous event belongs to another chain');
  if (!isCanonicalTimestamp(input.occurredAt)) throw new Error('occurredAt is not an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z)');
  const payload = parsePayload(input.type, input.payload);
  const base = { id, chain: input.chain, chainSeq: (previous?.chainSeq ?? 0) + 1, type: input.type, occurredAt: input.occurredAt, payload, prevHash: previous?.hash ?? GENESIS_HASH };
  return { ...base, hash: eventHash(base) };
}

export type ChainBreak =
  | 'hash_mismatch'
  | 'link_mismatch'
  | 'sequence_gap'
  | 'chain_mismatch'
  | 'invalid_payload'
  | 'invalid_timestamp'
  /** Fewer events than the anchored head records: the end of the chain, or all of it, was removed (PKG-01). */
  | 'truncated'
  /** As many events as the anchor records, or more, but the last hash differs from the anchored head. */
  | 'head_mismatch';

export type ChainVerification =
  | { readonly ok: true; readonly length: number; readonly head: string }
  | { readonly ok: false; readonly brokenAt: number; readonly reason: ChainBreak };

/**
 * The anchored head of a chain (length and last hash), kept apart from the
 * events: in PostgreSQL the `defensibility_heads` row maintained by trigger
 * in the append transaction (ADR-009 amended by ADR-024). A chain can only
 * be proven complete against it; without it, any prefix of a valid chain
 * verifies.
 */
export interface ChainHead {
  readonly length: number;
  readonly head: string;
}

/**
 * Verifies one chain given in chain order. Detects edited, inserted or
 * reordered events, and removed events in the middle. With `expected` (the
 * anchored head) it also detects removal of the end of the chain or of the
 * whole chain; `verifyChain(events)` alone cannot.
 */
export function verifyChain(events: readonly DefensibilityEvent[], expected?: ChainHead): ChainVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.chain !== events[0]!.chain) return { ok: false, brokenAt: i, reason: 'chain_mismatch' };
    if (e.chainSeq !== i + 1) return { ok: false, brokenAt: i, reason: 'sequence_gap' };
    if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'link_mismatch' };
    if (!isDefensibilityEventType(e.type) || !DefensibilityPayloads[e.type].safeParse(e.payload).success) return { ok: false, brokenAt: i, reason: 'invalid_payload' };
    if (!isCanonicalTimestamp(e.occurredAt)) return { ok: false, brokenAt: i, reason: 'invalid_timestamp' };
    if (eventHash(e) !== e.hash) return { ok: false, brokenAt: i, reason: 'hash_mismatch' };
    prev = e.hash;
  }
  if (expected) {
    if (events.length < expected.length) return { ok: false, brokenAt: events.length, reason: 'truncated' };
    if (events.length > expected.length || prev !== expected.head) return { ok: false, brokenAt: Math.min(events.length, expected.length) - 1, reason: 'head_mismatch' };
  }
  return { ok: true, length: events.length, head: prev };
}

/** In-memory log (device-side buffer and tests). The API keeps the durable log in PostgreSQL. */
export class MemoryDefensibilityLog {
  private readonly chains = new Map<string, DefensibilityEvent[]>();
  /** Anchored heads, kept apart from the events as in PostgreSQL (`defensibility_heads`). */
  private readonly heads = new Map<string, ChainHead>();
  constructor(private readonly newId: () => string) {}
  append(input: DefensibilityEventInput): DefensibilityEvent {
    const chain = this.chains.get(input.chain) ?? [];
    const event = chainEvent(chain[chain.length - 1], input, this.newId());
    chain.push(event);
    this.chains.set(input.chain, chain);
    this.heads.set(input.chain, { length: event.chainSeq, head: event.hash });
    return event;
  }
  events(chain: string): readonly DefensibilityEvent[] {
    return [...(this.chains.get(chain) ?? [])];
  }
  head(chain: string): ChainHead | undefined {
    return this.heads.get(chain);
  }
  verify(chain: string): ChainVerification {
    return verifyChain(this.chains.get(chain) ?? [], this.heads.get(chain) ?? { length: 0, head: GENESIS_HASH });
  }
}

export const LEGAL_HOLD_EXPORT_FORMAT = 'legal-hold-export';

export interface LegalHoldExport {
  readonly format: typeof LEGAL_HOLD_EXPORT_FORMAT;
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly subjectRef: string;
  readonly draftNotice: string;
  readonly integrity: ChainVerification;
  /** The anchored head the chain was verified against (PKG-01); absent only for exports built without one. */
  readonly anchoredHead?: ChainHead;
  readonly acceptances: readonly DefensibilityEvent[];
  readonly consents: readonly DefensibilityEvent[];
  readonly notices: readonly DefensibilityEvent[];
  readonly safetyEvents: readonly DefensibilityEvent[];
  readonly prescriptions: readonly DefensibilityEvent[];
  /** M08: programs generated and reflows decided by the engine. */
  readonly programs: readonly DefensibilityEvent[];
  /** M09: Fair Pair sessions taken part in (joined, timeline, challenge, left). */
  readonly pairSessions: readonly DefensibilityEvent[];
  /** M10: nutrition targets the engine prescribed (mode, versions and reason codes; no value). */
  readonly nutritionTargets: readonly DefensibilityEvent[];
  readonly engineVersions: readonly { readonly engineVersion: string; readonly firstSeen: string; readonly lastSeen: string; readonly events: number }[];
  readonly legalHolds: readonly DefensibilityEvent[];
  readonly accessLog: readonly DefensibilityEvent[];
  /** The complete chain, so the export can be re-verified independently. */
  readonly chain: readonly DefensibilityEvent[];
}

/** Groups a subject's chain into the sections a legal-hold export needs, with the integrity result. */
export function buildLegalHoldExport(subjectRef: string, chain: readonly DefensibilityEvent[], generatedAt: string, expected?: ChainHead): LegalHoldExport {
  const of = (...types: DefensibilityEventType[]) => chain.filter((e) => types.includes(e.type));
  const versions = new Map<string, { engineVersion: string; firstSeen: string; lastSeen: string; events: number }>();
  for (const e of of('safety.event', 'safety.attested', 'prescription.issued', 'program.generated', 'program.reflowed', 'pair.timeline_built', 'nutrition.target_set')) {
    const v = (e.payload as { engineVersion: string }).engineVersion;
    const entry = versions.get(v) ?? { engineVersion: v, firstSeen: e.occurredAt, lastSeen: e.occurredAt, events: 0 };
    entry.events += 1;
    if (e.occurredAt < entry.firstSeen) entry.firstSeen = e.occurredAt;
    if (e.occurredAt > entry.lastSeen) entry.lastSeen = e.occurredAt;
    versions.set(v, entry);
  }
  return {
    format: LEGAL_HOLD_EXPORT_FORMAT,
    schemaVersion: 1,
    generatedAt,
    subjectRef,
    draftNotice: 'Export format is a draft; its evidentiary use requires counsel review.',
    integrity: verifyChain(chain, expected),
    ...(expected ? { anchoredHead: expected } : {}),
    acceptances: of('acceptance.recorded'),
    consents: of('consent.recorded'),
    notices: of('notice.shown', 'notice.acknowledged'),
    safetyEvents: of('safety.event', 'safety.attested'),
    prescriptions: of('prescription.issued'),
    programs: of('program.generated', 'program.reflowed'),
    pairSessions: of('pair.joined', 'pair.timeline_built', 'pair.challenge_started', 'pair.left', 'pair.partner_left'),
    nutritionTargets: of('nutrition.target_set'),
    engineVersions: [...versions.values()],
    legalHolds: of('legal_hold.placed', 'legal_hold.released'),
    accessLog: of('log.accessed'),
    chain: [...chain],
  };
}
