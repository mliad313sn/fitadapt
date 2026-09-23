import type { Clock } from './clock.js';
import { createRng, type Rng } from './random.js';
import { ENGINE_VERSION } from './version.js';

export interface EngineContext {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly seed: number;
}

export interface EngineContextInput {
  clock: Clock;
  seed: number;
}

export function createEngineContext({ clock, seed }: EngineContextInput): EngineContext {
  return Object.freeze({ clock, seed, rng: createRng(seed) });
}

export interface EngineStamp {
  engineVersion: string;
  evaluatedAt: string;
  seed: number;
}

/**
 * Identifies which engine version produced an output and when (per the injected
 * clock). Future prescriptions carry this stamp into the defensibility log (L11).
 */
export function stamp(ctx: EngineContext): EngineStamp {
  return {
    engineVersion: ENGINE_VERSION,
    evaluatedAt: new Date(ctx.clock.now()).toISOString(),
    seed: ctx.seed,
  };
}
