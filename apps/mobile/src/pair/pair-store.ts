import { buildSessionHistory, painReportsFrom, safetyStopsFrom, deloadStatus } from '@fitadapt/engine';
import { firstWorkoutGate, type AcceptanceRecord } from '@fitadapt/legal';
import { CONSENT_POLICIES, isFeatureEnabled, policyFor } from '@fitadapt/privacy';
import { evaluateScreening, intensityLockStatus, jointFlagsFromPain, notScreenedSafetyProfile } from '@fitadapt/safety';
import {
  CalendarDateSchema,
  DisplayNameSchema,
  ExecutionLogSchema,
  PairSessionSchema,
  PairSharingSchema,
  ScreeningResponsesSchema,
  SetLogSchema,
  WorkoutSessionRecordSchema,
  type CalendarDateValue,
  type DeloadEvent,
  type ExecutionLog,
  type IntensityLock,
  type Jurisdiction,
  type JointFlags,
  type PairSession,
  type PairSharing,
  type PairSharingScope,
  type SafetyProfile,
  type ScreeningResponses,
  type SessionHistoryEntry,
  type SetLog,
  type WorkoutSessionRecord,
} from '@fitadapt/shared';
import { z } from 'zod';
import { createStore } from 'zustand';
import { createLegalStore, type LegalStore } from '../legal/legal-store';
import { currentLegalRegistry } from '../legal/registry';
import { createConsentStore, type ConsentStore } from '../privacy/consents';
import { MemoryKeyValueStore, type KeyValueStore } from '../storage/app-state';

/**
 * M09 Fair Pair on the device (ADR-021).
 *
 * A partner who uses the owner's phone ("guest") is a second person: their
 * data is theirs and is kept apart from the owner's.
 * - Their own ledgers under their own namespace (`pair.guest.<id>.`): the
 *   M17 consent ledger, the M20 acceptances and notices, and their own
 *   hash-chained defensibility buffer — the same stores as the owner's,
 *   never the owner's records.
 * - Their own screening (their SafetyProfile, re-derived, fail closed without
 *   their health consent), date of birth (the S7/M17 age gate) and optional
 *   body weight.
 * - Their own append-only session records, set logs and execution logs,
 *   which never enter the owner's sync outbox (so a sync can never mix the
 *   partners' data, and nothing of theirs reaches the owner's account).
 * - They can export everything that is theirs, or delete it.
 * Everything lives in the encrypted device database (M04, ADR-020).
 */

const GUESTS_KEY = 'pair.guests';
const OWNER_SHARING_KEY = 'pair.owner.sharing';
const OWNER_NAME_KEY = 'pair.owner.name';
const SESSIONS_KEY = 'pair.sessions';
const guestPrefix = (id: string) => `pair.guest.${id}.`;
/** The keys a guest's namespace holds (the consent and legal stores' own keys, then the pair records). */
const GUEST_KEYS = ['consent_records', 'legal_acceptances', 'legal_notice_impressions', 'defensibility_device_log', 'profile', 'sharing', 'workouts', 'set_logs', 'execution_logs'] as const;

/** A key/value store confined to one namespace. */
export function prefixedKv(kv: KeyValueStore, prefix: string): KeyValueStore {
  return { get: (k) => kv.get(prefix + k), set: (k, v) => kv.set(prefix + k, v), remove: (k) => kv.remove(prefix + k) };
}

const GuestProfileSchema = z.strictObject({
  id: z.uuid(),
  displayName: DisplayNameSchema,
  birthDate: CalendarDateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  screening: ScreeningResponsesSchema.nullable(),
  bodyweightKg: z.number().min(25).max(350).nullable(),
});
export type GuestProfile = z.infer<typeof GuestProfileSchema>;
const StoredSetLogSchema = z.strictObject({ id: z.uuid(), data: SetLogSchema });
export type GuestSetLog = z.infer<typeof StoredSetLogSchema>;

function read<T>(kv: KeyValueStore, key: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = kv.get(key);
  if (!raw) return fallback;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    // A corrupt record fails closed: nothing is shared, no profile, no logs.
    return fallback;
  }
}

/** A guest's own view of their data: ledgers, SafetyProfile, logs. */
export interface GuestLedgers {
  readonly consents: ConsentStore;
  readonly legal: LegalStore;
}

export interface PairStoreDeps {
  kv: KeyValueStore;
  newId: () => string;
  now: () => Date;
  jurisdiction: Jurisdiction;
}

export interface GuestData {
  readonly profile: GuestProfile;
  readonly sharing: readonly PairSharing[];
  readonly workouts: readonly WorkoutSessionRecord[];
  readonly setLogs: readonly GuestSetLog[];
  readonly executionLogs: readonly ExecutionLog[];
}

export interface PairStoreState {
  /** The jurisdiction of this phone's ledgers (the guests' ledgers use the same). */
  jurisdiction: Jurisdiction;
  guests: GuestProfile[];
  ownerName: string | null;
  /** The owner's own sharing choices (append-only; the latest counts). */
  ownerSharing: PairSharing[];
  /** Pair sessions this phone ran (they name both partners: removed with either person's data). */
  sessions: PairSession[];
  /** Bumped on every guest write so screens re-read. */
  revision: number;
  ledgers(guestId: string): GuestLedgers;
  guest(guestId: string): GuestData | null;
  addGuest(displayName: string, birthDate: CalendarDateValue): GuestProfile;
  saveGuestScreening(guestId: string, responses: ScreeningResponses): void;
  setGuestBodyweight(guestId: string, kg: number | null): void;
  /**
   * MOB-09: the guest withdrew their health consent: their screening answers
   * and body weight are forgotten (as for the owner). Their execution logs
   * stay: an S3 intensity lock recorded there must survive a withdrawal (S3).
   */
  forgetGuestHealth(guestId: string): void;
  setOwnerName(name: string): void;
  /** Records a participant's own sharing choice for the next pair session ('owner' or a guest id). */
  recordSharing(who: 'owner' | string, scopes: readonly PairSharingScope[]): PairSharing;
  saveSession(session: PairSession): void;
  guestSaveWorkout(guestId: string, record: WorkoutSessionRecord): void;
  guestLogSet(guestId: string, log: SetLog): void;
  guestLogExecution(guestId: string, event: ExecutionLog): void;
  /** Everything this phone holds about a guest, as JSON (their data is theirs). */
  exportGuest(guestId: string): string;
  /** Erases everything this phone holds about a guest: profile, ledgers, logs and the pair sessions naming them. */
  deleteGuest(guestId: string): void;
  /** Account wiped (MOB-01): the cached guest ledgers are dropped and everything is re-read from the device. */
  reset(): void;
}

export function createPairStore({ kv, newId, now, jurisdiction }: PairStoreDeps) {
  const cache = new Map<string, GuestLedgers>();
  let generation = 0;
  const gkv = (id: string) => prefixedKv(kv, guestPrefix(id));
  const readGuests = () => read(kv, GUESTS_KEY, z.array(z.uuid()), []).flatMap((id) => {
    const profile = read(gkv(id), 'profile', GuestProfileSchema.nullable(), null);
    return profile ? [profile] : [];
  });
  const append = <T>(id: string, key: string, schema: z.ZodType<T>, value: T) => {
    const list = read(gkv(id), key, z.array(schema), []);
    gkv(id).set(key, JSON.stringify([...list, schema.parse(value)]));
  };

  const stored = () => ({
    guests: readGuests(),
    ownerName: kv.get(OWNER_NAME_KEY) ?? null,
    ownerSharing: read(kv, OWNER_SHARING_KEY, z.array(PairSharingSchema), []),
    sessions: read(kv, SESSIONS_KEY, z.array(PairSessionSchema), []),
  });

  return createStore<PairStoreState>((set, get) => ({
    jurisdiction,
    ...stored(),
    revision: 0,
    reset() {
      generation += 1;
      cache.clear();
      set({ ...stored(), revision: get().revision + 1 });
    },
    ledgers(guestId) {
      let ledgers = cache.get(guestId);
      if (!ledgers) {
        // MOB-01: ledgers handed out before a wipe or a guest deletion can no longer write (a screen still holding one
        // would otherwise write the deleted ledger back).
        const born = generation;
        const inner = gkv(guestId);
        const live = () => born === generation && cache.get(guestId) === ledgers;
        const ledgerKv: KeyValueStore = { get: (k) => inner.get(k), set: (k, v) => (live() ? inner.set(k, v) : undefined), remove: (k) => (live() ? inner.remove(k) : undefined) };
        ledgers = { consents: createConsentStore({ kv: ledgerKv, newId, now, jurisdiction }), legal: createLegalStore({ kv: ledgerKv, newId, now, jurisdiction }) };
        cache.set(guestId, ledgers);
      }
      return ledgers;
    },
    guest(guestId) {
      const g = gkv(guestId);
      const profile = read(g, 'profile', GuestProfileSchema.nullable(), null);
      if (!profile) return null;
      return {
        profile,
        sharing: read(g, 'sharing', z.array(PairSharingSchema), []),
        workouts: read(g, 'workouts', z.array(WorkoutSessionRecordSchema), []) as WorkoutSessionRecord[],
        setLogs: read(g, 'set_logs', z.array(StoredSetLogSchema), []),
        executionLogs: read(g, 'execution_logs', z.array(ExecutionLogSchema), []),
      };
    },
    addGuest(displayName, birthDate) {
      const profile: GuestProfile = GuestProfileSchema.parse({ id: newId(), displayName, birthDate, createdAt: now().toISOString(), screening: null, bodyweightKg: null });
      gkv(profile.id).set('profile', JSON.stringify(profile));
      kv.set(GUESTS_KEY, JSON.stringify([...get().guests.map((x) => x.id), profile.id]));
      set({ guests: [...get().guests, profile], revision: get().revision + 1 });
      return profile;
    },
    saveGuestScreening(guestId, responses) {
      const profile = get().guest(guestId)!.profile;
      gkv(guestId).set('profile', JSON.stringify({ ...profile, screening: ScreeningResponsesSchema.parse(responses) }));
      set({ guests: readGuests(), revision: get().revision + 1 });
    },
    setGuestBodyweight(guestId, kg) {
      const profile = get().guest(guestId)!.profile;
      gkv(guestId).set('profile', JSON.stringify(GuestProfileSchema.parse({ ...profile, bodyweightKg: kg })));
      set({ guests: readGuests(), revision: get().revision + 1 });
    },
    forgetGuestHealth(guestId) {
      const data = get().guest(guestId);
      if (!data) return;
      gkv(guestId).set('profile', JSON.stringify(GuestProfileSchema.parse({ ...data.profile, screening: null, bodyweightKg: null })));
      set({ guests: readGuests(), revision: get().revision + 1 });
    },
    setOwnerName(name) {
      const parsed = DisplayNameSchema.parse(name);
      kv.set(OWNER_NAME_KEY, parsed);
      set({ ownerName: parsed });
    },
    recordSharing(who, scopes) {
      const sharing: PairSharing = { scopes: [...new Set(scopes)], consentVersion: policyFor('partner_sharing', jurisdiction, CONSENT_POLICIES).currentVersion, recordedAt: now().toISOString() };
      if (who === 'owner') {
        const list = [...get().ownerSharing, sharing];
        kv.set(OWNER_SHARING_KEY, JSON.stringify(list));
        set({ ownerSharing: list });
      } else {
        append(who, 'sharing', PairSharingSchema, sharing);
        set({ revision: get().revision + 1 });
      }
      return sharing;
    },
    saveSession(session) {
      const list = [...get().sessions, PairSessionSchema.parse(session) as PairSession];
      kv.set(SESSIONS_KEY, JSON.stringify(list));
      set({ sessions: list });
    },
    guestSaveWorkout(guestId, record) {
      append(guestId, 'workouts', WorkoutSessionRecordSchema, record);
      set({ revision: get().revision + 1 });
    },
    guestLogSet(guestId, log) {
      append(guestId, 'set_logs', StoredSetLogSchema, { id: newId(), data: log });
      set({ revision: get().revision + 1 });
    },
    guestLogExecution(guestId, event) {
      append(guestId, 'execution_logs', ExecutionLogSchema, event);
      set({ revision: get().revision + 1 });
    },
    exportGuest(guestId) {
      const data = get().guest(guestId);
      const ledgers = get().ledgers(guestId);
      return JSON.stringify(
        {
          format: 'pair-partner-export',
          schemaVersion: 1,
          exportedAt: now().toISOString(),
          ...data,
          consents: ledgers.consents.getState().records,
          acceptances: ledgers.legal.getState().acceptances,
          notices: ledgers.legal.getState().notices,
          defensibility: ledgers.legal.getState().events,
          // MOB-11: closed segments of her device buffer, exactly as stored.
          defensibilitySegments: ledgers.legal.getState().archivedSegments(),
          pairSessions: get().sessions.filter((s) => s.participants.some((p) => p.participantId === guestId)),
        },
        null,
        2,
      );
    },
    deleteGuest(guestId) {
      const g = gkv(guestId);
      // MOB-11: her device buffer's closed segments go with her ledgers.
      get().ledgers(guestId).legal.getState().clear();
      for (const key of GUEST_KEYS) g.remove(key);
      cache.delete(guestId);
      const guests = get().guests.filter((x) => x.id !== guestId);
      kv.set(GUESTS_KEY, JSON.stringify(guests.map((x) => x.id)));
      const sessions = get().sessions.filter((s) => !s.participants.some((p) => p.participantId === guestId));
      kv.set(SESSIONS_KEY, JSON.stringify(sessions));
      set({ guests, sessions, revision: get().revision + 1 });
    },
  }));
}

export type PairStore = ReturnType<typeof createPairStore>;

/** The latest sharing choice (none: nothing beyond taking part, and only with the consent). */
export const latestSharing = (list: readonly PairSharing[]): PairSharing | null => list[list.length - 1] ?? null;

/**
 * What a participant may share now: nothing without their own M17
 * `partner_sharing` consent (fails closed); otherwise the scopes of their
 * latest choice. Body weight and the Fair Challenge are off unless chosen.
 */
export function sharedScopes(consents: Parameters<typeof isFeatureEnabled>[1], sharing: readonly PairSharing[]): PairSharingScope[] | null {
  if (!isFeatureEnabled('pair.share_with_partner', consents)) return null;
  return [...(latestSharing(sharing)?.scopes ?? [])];
}

/** L2 for a guest: their own Terms, Privacy, health consent and exercise-risk acknowledgment, in their own ledgers. */
export function guestWorkoutGate(ledgers: GuestLedgers, at: Date, jurisdiction: Jurisdiction) {
  const acceptances: readonly AcceptanceRecord[] = ledgers.legal.getState().acceptances;
  return firstWorkoutGate(acceptances, ledgers.consents.getState().records, { jurisdiction, now: at, registry: currentLegalRegistry() });
}

/** A guest's SafetyProfile: re-derived from their own answers; "not screened" without their health consent or answers (fail closed). */
export function guestSafetyProfile(data: GuestData | null, ledgers: GuestLedgers | null): SafetyProfile {
  if (!data || !ledgers || !isFeatureEnabled('health.screening', ledgers.consents.getState().records)) return notScreenedSafetyProfile('safety_profile.not_screened.no_consent');
  if (!data.profile.screening) return notScreenedSafetyProfile('safety_profile.not_screened.incomplete');
  return evaluateScreening(data.profile.screening);
}

/** A guest's engine facts from their own logs (history, joint flags, S3 lock, triggered deload). */
export function guestFacts(data: GuestData, atMs: number): { history: SessionHistoryEntry[]; jointFlags: JointFlags; intensityLock: IntensityLock; deload: DeloadEvent | null } {
  const history = buildSessionHistory(data.workouts, data.setLogs, data.executionLogs);
  const reports = painReportsFrom(data.executionLogs);
  return {
    history,
    jointFlags: jointFlagsFromPain(reports),
    intensityLock: intensityLockStatus(data.executionLogs),
    deload: deloadStatus({ asOfMs: atMs, painReports: reports, safetyStops: safetyStopsFrom(data.executionLogs), history, readinessChecks: [] }),
  };
}

/** Empty in-memory ledgers, for screens that subscribe before a guest is chosen (never written to). */
export const NO_LEDGERS: GuestLedgers = (() => {
  const kv = new MemoryKeyValueStore();
  const newId = () => '00000000-0000-4000-8000-000000000000';
  return { consents: createConsentStore({ kv, newId, jurisdiction: 'ZZ' }), legal: createLegalStore({ kv, newId, now: () => new Date(0), jurisdiction: 'ZZ' }) };
})();
