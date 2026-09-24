import type { HeartRateInfo, HeartRateSample, HeartRateSourceKind } from '@fitadapt/shared';
import { create } from 'zustand';

/**
 * The heart-rate port (M03). Zones use the heart-rate reserve when a resting
 * heart rate is known, and perceived exertion with the talk test otherwise.
 * Today the only source is what the user types (manual). M12 (wearables and
 * health integrations) plugs a device source in with `setHeartRateSource`:
 * it provides a resting heart rate and, optionally, live readings during a
 * cardio block. No vendor SDK here. Readings stay on the device: M03 never
 * logs, stores or sends live heart-rate samples (only the resting value the
 * user chose travels in the session input, a health collection).
 */
export interface HeartRateSource {
  readonly kind: Exclude<HeartRateSourceKind, 'none'>;
  /** Resting heart rate in bpm, or null when unknown. */
  restingBpm(): number | null;
  /** Live readings (optional): returns an unsubscribe function. */
  subscribe?(listener: (sample: HeartRateSample) => void): () => void;
}

interface ManualHeartRateState {
  restingBpm: number | null;
  setRestingBpm: (bpm: number | null) => void;
}

/** What the user typed on this device (in memory; see docs/status/M03.md). */
export const useManualHeartRate = create<ManualHeartRateState>((set) => ({
  restingBpm: null,
  setRestingBpm: (bpm) => set({ restingBpm: bpm }),
}));

export const manualHeartRateSource: HeartRateSource = {
  kind: 'manual',
  restingBpm: () => useManualHeartRate.getState().restingBpm,
};

let current: HeartRateSource = manualHeartRateSource;

/** Replaces the heart-rate source (M12 wearables, tests). Returns the previous one. */
export function setHeartRateSource(next: HeartRateSource | null): HeartRateSource {
  const previous = current;
  current = next ?? manualHeartRateSource;
  return previous;
}

export function heartRateSource(): HeartRateSource {
  return current;
}

/** The heart-rate facts for the engine input (null: no heart-rate data at all). */
export function heartRateInfo(source: HeartRateSource = current): HeartRateInfo | null {
  const bpm = source.restingBpm();
  return bpm === null ? null : { source: source.kind, restingBpm: Math.round(bpm) };
}
