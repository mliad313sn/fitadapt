import { defineConfig, JOINTS, type Joint, type JointFlag, type JointFlags } from '@fitadapt/shared';
import type { SafetyCheck } from './evaluate.js';

/**
 * Session safety invariants the M02 engine enforces (docs/specs/00-product-vision.md):
 *
 * - S5 load ceiling: a prescribed load for an exercise never increases by
 *   more than 10 % of its e1RM-based value within 7 days;
 * - S2 pain gate: a joint rated red (pain ≥ 6/10) causes exercises loading it
 *   at medium/high level to be substituted in the next session;
 * - S3 red-flag stop: a red-flag symptom ends the session and locks intensity
 *   until the user attests a medical review.
 *
 * The 10 %, the 7 days and the pain score 6 are the invariants themselves:
 * constants, never configuration, with no switch to relax them. M05 builds
 * the full pain-monitoring model (painTrafficLight, next-morning check,
 * physiotherapist recommendation) and the red-flag flow on these primitives.
 */
export const S5_MAX_INCREASE_FRACTION = 0.1 as const;
export const S5_WINDOW_DAYS = 7 as const;
export const S2_RED_PAIN_SCORE = 6 as const;

const DAY_MS = 86_400_000;

/** A load prescribed (or used, when the user chose it) for one exercise, and when. */
export interface LoadReference {
  readonly loadKg: number;
  /** ISO timestamp. */
  readonly at: string;
}

/**
 * S5: the highest load allowed at `nowMs` for an exercise, or null when no
 * reference is in the window. The window is every reference from 7 days
 * before now onward — including references dated after now, so moving the
 * device clock back never escapes it — and the ceiling is 10 % above the
 * lowest of them (so the load cannot ratchet up by 10 % several times within
 * 7 days). Zero loads are no reference (nothing external was lifted).
 * Unparseable timestamps count as inside the window (fail closed).
 */
export function s5LoadCeiling(references: readonly LoadReference[], nowMs: number): number | null {
  const since = nowMs - S5_WINDOW_DAYS * DAY_MS;
  const inWindow = references.filter((r) => r.loadKg > 0 && !(Date.parse(r.at) < since));
  if (inWindow.length === 0) return null;
  return Math.min(...inWindow.map((r) => r.loadKg)) * (1 + S5_MAX_INCREASE_FRACTION);
}

/** S5 as a safety check (small tolerance for float rounding only). */
export const loadCeilingCheck: SafetyCheck<{ loadKg: number; references: readonly LoadReference[]; nowMs: number }> = ({ loadKg, references, nowMs }) => {
  const ceiling = s5LoadCeiling(references, nowMs);
  if (ceiling !== null && loadKg > ceiling + 1e-9) return { invariant: 'S5', reasonCode: 'safety.s5.load_ceiling' };
  return null;
};

export const PAIN_CONFIG = defineConfig({
  /**
   * A score at least this (and below the S2 red score 6) is amber. M05 spec: "green ≤ 3, amber 4–5, red ≥ 6"
   * (M02 had 3 as a placeholder; M05 sets the spec's boundary). Silbernagel et al. 2007 is cited by the vision
   * document for the pain-monitoring model; neither the paper nor the thresholds were checked.
   */
  amberPainScore: { value: 4, unit: 'score 0–10', source: 'docs/specs/M05-recovery-mobility-pain-safety.md (Scope: "green ≤ 3, amber 4–5, red ≥ 6"); pain-monitoring model after Silbernagel et al. 2007 as cited by docs/specs/00-product-vision.md, not checked', validated: false },
  /** Amber or red on the same joint for more than this many days → recommend seeing a physiotherapist. */
  persistenceDays: { value: 14, unit: 'days', source: 'docs/specs/M05-recovery-mobility-pain-safety.md (Rules: "Amber or red on the same joint for more than two weeks → recommend seeing a physiotherapist")', validated: false },
});

/** When a pain score was given (M05): during a session, in the check after it, or at the next-morning check. */
export type PainReportPhase = 'during' | 'after_session' | 'next_morning';

export interface PainReport {
  readonly joint: Joint;
  /** 0–10. */
  readonly score: number;
  readonly at: string;
  /** Absent = during a session (M02 records). */
  readonly phase?: PainReportPhase;
  /** Next-morning check: is it back to how it usually is? `false` = not settled → red (S2). */
  readonly settled?: boolean;
  /** The session the report belongs to (plan id), null or absent outside a session. */
  readonly sessionId?: string | null;
  /** ADR-023: the report's own id (absent on reports stored before it). */
  readonly id?: string;
  /** ADR-023: the latest reports of this joint its writer knew (ids): the causal order, independent of any clock. */
  readonly after?: readonly string[];
}

export type PainLight = 'green' | 'amber' | 'red';

/** The colour of one report on its own: ≥ 6 or not settled by the next morning → red; ≥ the amber score → amber. */
export function classifyPainReport(r: Pick<PainReport, 'score' | 'phase' | 'settled'>): PainLight {
  if (r.score >= S2_RED_PAIN_SCORE || (r.phase === 'next_morning' && r.settled === false)) return 'red';
  return r.score >= PAIN_CONFIG.amberPainScore.value ? 'amber' : 'green';
}

export interface JointPainState {
  readonly flag: PainLight;
  /** Why the joint is red: a score ≥ 6, or not settled by the next morning. */
  readonly redReason: 'score' | 'not_settled' | null;
  /** Start of the current amber/red stretch (the first non-green report since the last green one); null when green. */
  readonly since: string | null;
  /** The latest report of this joint. */
  readonly lastAt: string;
}

/**
 * The M05 pain-monitoring traffic light (one model: M02's S2 flags are read
 * from it). Reports are given in the order they were recorded.
 *
 * - A report of ≥ 6/10, or a next-morning check that says it has not
 *   settled, makes the joint red (S2).
 * - A red joint stays red for the next session: only a later report below 6
 *   made in a LATER session (one with no report of this joint up to the red
 *   rating; never a next-morning check) can bring it back to amber or green. Fail closed: the clearing
 *   report must be recorded later and not be dated before the red one (a
 *   device clock moved back cannot clear it), and an unreadable time never
 *   clears.
 * - ADR-023: a red report with an id is cleared only by a report that FOLLOWS
 *   it in the causal chain (`after`, transitively): its writer knew the red.
 *   Record order and timestamps can both be wrong (a device clock moved back
 *   sorts a new red before an old green; a report from another device may
 *   never have seen the red), the chain cannot. Legacy reds (no id) keep the
 *   rules above.
 * - Otherwise the latest report decides: ≥ 4 amber, else green.
 */
export function painTrafficLight(reports: readonly PainReport[]): Partial<Record<Joint, JointPainState>> {
  const out: Partial<Record<Joint, JointPainState>> = {};
  const red: Partial<Record<Joint, { at: number; sessions: Set<string | null>; ids: Set<string> }>> = {};
  const parents = new Map<string, readonly string[]>();
  const sessionOf = new Map<string, (string | null)[]>();
  for (const r of reports) {
    if (r.id === undefined) continue;
    parents.set(r.id, [...(parents.get(r.id) ?? []), ...(r.after ?? [])]);
    sessionOf.set(r.id, [...(sessionOf.get(r.id) ?? []), r.sessionId ?? null]);
  }
  /** The ids `r` follows through `after` links (its causal ancestors). */
  const ancestors = (r: PainReport) => {
    const seen = new Set<string>();
    const stack = [...(r.after ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(parents.get(id) ?? []));
    }
    return seen;
  };
  /** Every id in `targets` is a causal ancestor of `r`. */
  const follows = (r: PainReport, targets: ReadonlySet<string>) => {
    if (targets.size === 0) return true;
    const known = ancestors(r);
    return [...targets].every((id) => known.has(id));
  };
  /** Every session a report of the joint came from so far (in record order). */
  const seen: Partial<Record<Joint, Set<string | null>>> = {};
  for (const r of reports) {
    const prev = out[r.joint];
    const t = Date.parse(r.at);
    const light = classifyPainReport(r);
    const session = r.sessionId ?? null;
    const known = (seen[r.joint] ??= new Set());
    known.add(session);
    let flag: PainLight;
    let redReason: JointPainState['redReason'] = prev?.redReason ?? null;
    if (light === 'red') {
      flag = 'red';
      redReason = r.score >= S2_RED_PAIN_SCORE ? 'score' : 'not_settled';
      // An unreadable time can never be "before" a clearing report.
      const streak = red[r.joint];
      // Only a session not seen before this red rating (a later one) can clear it.
      const ids = new Set(streak?.ids ?? []);
      // The sessions that reported this joint up to the red rating: in record order, and (ADR-023) causally, whatever the order.
      const sessions = new Set([...known, ...(streak?.sessions ?? [])]);
      if (r.id !== undefined) {
        ids.add(r.id);
        for (const id of ancestors(r)) for (const sess of sessionOf.get(id) ?? []) sessions.add(sess);
      }
      red[r.joint] = { at: Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.max(t, streak?.at ?? Number.NEGATIVE_INFINITY), sessions, ids };
    } else if (prev?.flag === 'red') {
      const setBy = red[r.joint]!;
      // A session not seen for this joint up to the red rating (reports outside a session only clear reds set outside one).
      const otherSession = session === null ? [...setBy.sessions].every((x) => x === null) : !setBy.sessions.has(session);
      const clears = r.phase !== 'next_morning' && !Number.isNaN(t) && t >= setBy.at && otherSession && follows(r, setBy.ids);
      flag = clears ? light : 'red';
      if (clears) {
        redReason = null;
        delete red[r.joint];
      }
    } else {
      flag = light;
      redReason = null;
    }
    const since = flag === 'green' ? null : prev && prev.flag !== 'green' ? prev.since : r.at;
    out[r.joint] = { flag, redReason: flag === 'red' ? redReason : null, since, lastAt: r.at };
  }
  return out;
}

/**
 * S2 traffic light from pain reports, in the order they were recorded
 * (painTrafficLight): red and amber joints; green joints are left out.
 */
export function jointFlagsFromPain(reports: readonly PainReport[]): JointFlags {
  const states = painTrafficLight(reports);
  const flags: Partial<Record<Joint, JointFlag>> = {};
  for (const joint of JOINTS) {
    const s = states[joint];
    if (s && s.flag !== 'green') flags[joint] = s.flag;
  }
  return flags;
}

export interface PhysioRecommendation {
  readonly joint: Joint;
  readonly flag: 'amber' | 'red';
  readonly since: string;
  readonly days: number;
}

const DAY = 86_400_000;

/**
 * M05 rule: amber or red on the same joint for more than two weeks →
 * recommend seeing a physiotherapist (guidance only, no diagnosis). The
 * stretch starts at its first amber/red report and lasts while no green
 * report follows. An unreadable start time counts as long enough (the
 * recommendation errs on the side of suggesting a professional).
 */
export function physioRecommendations(reports: readonly PainReport[], nowMs: number): PhysioRecommendation[] {
  const states = painTrafficLight(reports);
  const out: PhysioRecommendation[] = [];
  for (const joint of JOINTS) {
    const s = states[joint];
    if (!s || s.flag === 'green' || s.since === null) continue;
    const start = Date.parse(s.since);
    const days = Number.isNaN(start) ? Number.POSITIVE_INFINITY : (nowMs - start) / DAY;
    if (days > PAIN_CONFIG.persistenceDays.value) out.push({ joint, flag: s.flag, since: s.since, days: Number.isFinite(days) ? Math.floor(days) : PAIN_CONFIG.persistenceDays.value + 1 });
  }
  return out;
}

export interface SafetyStopEvent {
  readonly kind: 'red_flag' | 'medical_review_attested' | string;
  readonly at: string;
  /** ADR-023: a red flag's own id; a red flag with an id is lifted only by an attestation that names it. */
  readonly id?: string;
  /** The same id as stored in an execution log (`eventId`), when raw logs are passed. */
  readonly eventId?: string;
  /** ADR-023: the red flags (ids) an attestation covers. */
  readonly attests?: readonly string[];
}

export interface IntensityLockStatus {
  readonly locked: boolean;
  /** When the lock started (the red flag that set it). */
  readonly since: string | null;
}

/**
 * S3: intensity is locked after a red-flag stop until the user attests a
 * medical review made after it. Fails closed on either reading: locked when
 * the last red flag was recorded after the last attestation, or when a red
 * flag is dated at or after the latest attestation (a device clock moved
 * back cannot unlock it). Events are given in the order they were recorded.
 * ADR-023: on top of both readings, a red flag that carries an id stays
 * locked until an attestation NAMES it (`attests`): neither the record order
 * (a device sorts by its own clock) nor a timestamp (a clock moved back makes
 * a new flag look older than an old attestation) can lift it.
 */
export function intensityLockStatus(events: readonly SafetyStopEvent[]): IntensityLockStatus {
  let lastFlag: SafetyStopEvent | null = null;
  let lastFlagIndex = -1;
  let lastAttestIndex = -1;
  let latestAttestAt = Number.NEGATIVE_INFINITY;
  events.forEach((e, i) => {
    if (e.kind === 'red_flag') {
      lastFlag = e;
      lastFlagIndex = i;
    } else if (e.kind === 'medical_review_attested') {
      lastAttestIndex = i;
      const t = Date.parse(e.at);
      latestAttestAt = Math.max(latestAttestAt, Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t);
    }
  });
  const flags = events.filter((e) => e.kind === 'red_flag');
  const flagAfterAttestInTime = flags.find((e) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) || t >= latestAttestAt;
  });
  const byOrderOrTime = lastFlagIndex > lastAttestIndex || flagAfterAttestInTime !== undefined;
  const named = new Set(events.flatMap((e) => (e.kind === 'medical_review_attested' ? (e.attests ?? []) : [])));
  const unnamed = flags.find((e) => {
    const id = e.id ?? e.eventId;
    return id !== undefined && !named.has(id);
  });
  if (!byOrderOrTime && !unnamed) return { locked: false, since: null };
  const since = byOrderOrTime ? (flagAfterAttestInTime ?? lastFlag)!.at : unnamed!.at;
  return { locked: true, since };
}

/** S3 as a check: no automatic session while intensity is locked. */
export const intensityLockCheck: SafetyCheck<{ lock: IntensityLockStatus }> = ({ lock }) => (lock.locked ? { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked' } : null);
