import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, createEngineContext, createRng, fixedClock, stamp } from './index.js';

describe('fixedClock', () => {
  it('returns the injected time', () => {
    expect(fixedClock(1_000).now()).toBe(1_000);
  });
  it('rejects non-finite values', () => {
    expect(() => fixedClock(Number.NaN)).toThrow(RangeError);
  });
});

describe('createRng', () => {
  it('is deterministic for a given seed (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        for (let i = 0; i < 5; i++) {
          if (a.next() !== b.next()) return false;
        }
        return true;
      }),
    );
  });
  it('stays in [0, 1) (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(seed);
        const v = rng.next();
        return v >= 0 && v < 1;
      }),
    );
  });
  it('int() stays within inclusive bounds (property)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -1000, max: 1000 }), fc.nat(1000), (seed, min, span) => {
        const v = createRng(seed).int(min, min + span);
        return Number.isInteger(v) && v >= min && v <= min + span;
      }),
    );
  });
  it('rejects invalid arguments', () => {
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(1).int(3, 2)).toThrow(RangeError);
    expect(() => createRng(1).int(0.5, 2)).toThrow(RangeError);
  });
  it('different seeds give different sequences', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
});

describe('engine context', () => {
  it('stamps outputs with the engine version, injected time and seed', () => {
    const ctx = createEngineContext({ clock: fixedClock(Date.UTC(2026, 8, 23, 10)), seed: 42 });
    expect(stamp(ctx)).toEqual({ engineVersion: ENGINE_VERSION, evaluatedAt: '2026-09-23T10:00:00.000Z', seed: 42 });
    expect(Object.isFrozen(ctx)).toBe(true);
  });
  it('same clock and seed give identical results', () => {
    const make = () => createEngineContext({ clock: fixedClock(0), seed: 7 });
    expect(make().rng.next()).toBe(make().rng.next());
  });
});
