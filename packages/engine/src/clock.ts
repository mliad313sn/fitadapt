/** Time source injected into the engine; the engine never reads the system clock. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export function fixedClock(epochMs: number): Clock {
  if (!Number.isFinite(epochMs)) {
    throw new RangeError('fixedClock expects a finite epoch in milliseconds');
  }
  return { now: () => epochMs };
}
