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
 * the full pain model and red-flag flow on top of these primitives.
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
  /** A joint whose latest pain score is at least this (and below the S2 red score) is amber. */
  amberPainScore: { value: 3, unit: 'score 0–10', source: 'M02 engineering default (conservative choice by the engineer); no external source; M05 builds the pain-monitoring model (Silbernagel et al. 2007 is cited by the vision document, not checked)', validated: false },
});

export interface PainReport {
  readonly joint: Joint;
  /** 0–10. */
  readonly score: number;
  readonly at: string;
}

/**
 * S2 traffic light from pain reports, in the order they were recorded: the
 * latest report of a joint decides — ≥ 6 red, ≥ the amber score amber. A red
 * joint stays red until a later report for that joint is below 6 (M05 adds
 * the next-morning check and the full monitoring model).
 */
export function jointFlagsFromPain(reports: readonly PainReport[]): JointFlags {
  const latest = new Map<Joint, number>();
  for (const r of reports) latest.set(r.joint, r.score);
  const flags: Partial<Record<Joint, JointFlag>> = {};
  for (const joint of JOINTS) {
    const score = latest.get(joint);
    if (score === undefined) continue;
    if (score >= S2_RED_PAIN_SCORE) flags[joint] = 'red';
    else if (score >= PAIN_CONFIG.amberPainScore.value) flags[joint] = 'amber';
  }
  return flags;
}

export interface SafetyStopEvent {
  readonly kind: 'red_flag' | 'medical_review_attested' | string;
  readonly at: string;
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
  const locked = lastFlagIndex > lastAttestIndex || flagAfterAttestInTime !== undefined;
  if (!locked) return { locked: false, since: null };
  const since = (flagAfterAttestInTime ?? lastFlag)!.at;
  return { locked: true, since };
}

/** S3 as a check: no automatic session while intensity is locked. */
export const intensityLockCheck: SafetyCheck<{ lock: IntensityLockStatus }> = ({ lock }) => (lock.locked ? { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked' } : null);
