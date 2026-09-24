import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { ConsentRecord } from '@fitadapt/shared';
import { consentHeads, consentState, hasConsent, latestRecord } from './index.js';

// Property runs are CPU-bound; the whole workspace runs in parallel (fresh-clone gate): no 5 s default.
vi.setConfig({ testTimeout: 120_000 });

/**
 * FIX-latest-record-ordering (ADR-023): a withdrawal is never overtaken by an
 * older grant, whatever the device clock (equal instants, a clock moved
 * back), the arrival order at the server, or a second device. Fictional data.
 */

const BASE = Date.parse('2026-09-24T12:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const decision = (id: number, granted: boolean, clock: number, supersedes: string[] | undefined): ConsentRecord => ({
  id: uuid(id),
  dataType: 'health',
  decision: granted ? 'granted' : 'withdrawn',
  version: 1,
  locale: 'en',
  jurisdiction: 'GB',
  source: 'mobile',
  recordedAt: new Date(BASE + clock).toISOString(),
  ...(supersedes === undefined ? {} : { supersedes }),
});

/** One device deciding: each decision names the heads it knew (what the device store does). */
function writeLinked(steps: readonly { granted: boolean; clock: number }[], firstId = 1, start: ConsentRecord[] = []): ConsentRecord[] {
  const out = [...start];
  steps.forEach((s, i) => out.push(decision(firstId + i, s.granted, s.clock, consentHeads(out, 'health'))));
  return out.slice(start.length);
}

const arbSteps = fc.array(fc.record({ granted: fc.boolean(), clock: fc.integer({ min: -3, max: 3 }).map((s) => s * 1000) }), { minLength: 1, maxLength: 8 });
const shuffle = <T>(list: readonly T[], seeds: fc.Stream<number>) => list.map((x) => ({ x, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((y) => y.x);

describe('consent: the decision made last counts, whatever the clock and the arrival order', () => {
  it('one device, any timestamps, any order at the server → exactly the last decision', () => {
    fc.assert(
      fc.property(arbSteps, fc.infiniteStream(fc.nat()), (steps, seeds) => {
        const ledger = writeLinked(steps);
        const truth = steps.at(-1)!.granted;
        expect(hasConsent(ledger, 'health')).toBe(truth);
        expect(hasConsent(shuffle(ledger, seeds), 'health')).toBe(truth);
        // The server sorts by recordedAt then insertion: still the truth.
        const byServerTime = [...ledger].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        expect(hasConsent(byServerTime, 'health')).toBe(truth);
      }),
      { numRuns: 2000 },
    );
  });

  it('two devices deciding without knowing each other: withdrawn if either withdrew', () => {
    fc.assert(
      fc.property(arbSteps, arbSteps, arbSteps, fc.infiniteStream(fc.nat()), (common, onA, onB, seeds) => {
        const base = writeLinked(common);
        const a = writeLinked(onA, 100, base);
        const b = writeLinked(onB, 200, base);
        const all = shuffle([...base, ...a, ...b], seeds);
        const lastA = onA.at(-1)!.granted;
        const lastB = onB.at(-1)!.granted;
        expect(hasConsent(all, 'health')).toBe(lastA && lastB);
        // The next decision, made knowing both, settles it.
        const next = writeLinked([{ granted: true, clock: -9000 }], 300, all);
        expect(hasConsent([...all, ...next], 'health')).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('the regression case: a withdrawal dated before the grant it withdrew (clock moved back) still withdraws', () => {
    const grant = decision(1, true, 5000, []);
    const withdrawal = decision(2, false, 1000, [grant.id]);
    for (const list of [[grant, withdrawal], [withdrawal, grant]]) {
      expect(latestRecord(list, 'health')).toBe(withdrawal);
      expect(consentState(list, 'health').granted).toBe(false);
    }
    // Stored before ADR-023 (no links), the clock would have decided the other way.
    const legacy = [grant, withdrawal].map(({ supersedes: _s, ...r }) => r);
    expect(hasConsent(legacy, 'health')).toBe(true);
    // Several grants among the heads: the oldest text version counts (renewal asked first).
    const g1 = { ...decision(3, true, 0, []), version: 2 };
    const g2 = { ...decision(4, true, 0, []), version: 1 };
    expect(latestRecord([g1, g2], 'health')).toBe(g2);
    expect(latestRecord([g2, g1], 'health')).toBe(g2);
  });
});
