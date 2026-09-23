import { assessmentValue } from './config.js';

/**
 * Estimated one-repetition maximum by the Epley formula with an RIR
 * adjustment: the reps the user still had in reserve count as reps they could
 * have done, so 1RM ≈ w × (1 + (reps + RIR) / 30).
 *
 * validated: false — the formula and its 12-rep limit are cited from the
 * project specs (Epley 1985; M02 "valid ≤ 12 reps"), not checked against the
 * source (ASSESSMENT_CONFIG, seats A3/A5). Only 1–12 performed reps are
 * accepted; outside that range the caller must not estimate (returns null).
 */
export function epleyE1RM(loadKg: number, reps: number, rir = 0): number | null {
  if (!(loadKg > 0) || !Number.isFinite(loadKg)) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > assessmentValue('epleyMaxReps')) return null;
  if (!Number.isInteger(rir) || rir < 0) return null;
  return loadKg * (1 + (reps + rir) / assessmentValue('epleyRepDivisor'));
}

/** Inverse of epleyE1RM: the load for `reps` performed with `rir` in reserve. */
export function loadForReps(e1rmKg: number, reps: number, rir: number): number {
  return e1rmKg / (1 + (reps + rir) / assessmentValue('epleyRepDivisor'));
}

/**
 * Rounds a load DOWN to the equipment step (never up: a starting load is never
 * heavier than computed). Works in integer hundredths to avoid float drift.
 */
export function roundDownToIncrement(loadKg: number, incrementKg = assessmentValue('defaultLoadIncrementKg')): number {
  if (!(incrementKg > 0)) throw new RangeError('incrementKg must be positive');
  const step = Math.round(incrementKg * 100);
  return (Math.floor(Math.round(loadKg * 100) / step) * step) / 100;
}
