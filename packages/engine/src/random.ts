/** Deterministic pseudo-random generator; the engine never calls Math.random. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
}

/** Mulberry32: small, fast and fully determined by its 32-bit seed. */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new RangeError('seed must be an integer');
  }
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError('int(min, max) expects integers with min <= max');
      }
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}
