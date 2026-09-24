import { describe, expect, it, vi } from 'vitest';
import { orderChain, soleHead, supersededIds, type ChainLinks } from './index.js';

// Property runs are CPU-bound; the whole workspace runs in parallel (fresh-clone gate): no 5 s default.
vi.setConfig({ testTimeout: 120_000 });

/** Fictional records: ids are letters, times are ISO strings. */
interface R {
  id: string;
  at: string;
  supersedes?: string[];
  rank?: number;
}
const links = (r: R): ChainLinks => ({ id: r.id, at: r.at, supersedes: r.supersedes, legacyRank: r.rank });
const ids = (list: readonly R[]) => list.map((r) => r.id);
const T = (s: number) => new Date(Date.UTC(2026, 8, 24, 12, 0, s)).toISOString();

describe('orderChain (ADR-023)', () => {
  it('an empty history has no head', () => {
    const chain = orderChain<R>([], links);
    expect(chain).toEqual({ ordered: [], heads: [] });
    expect(soleHead(chain)).toBeNull();
  });

  it('a linked history is ordered by its links, never by the clock (a new record dated earlier is still the latest)', () => {
    const history: R[] = [
      { id: 'c', at: T(1), supersedes: ['b'] }, // the device clock went back before c was written
      { id: 'a', at: T(5), supersedes: [] },
      { id: 'b', at: T(9), supersedes: ['a'] },
    ];
    const chain = orderChain(history, links);
    expect(ids(chain.ordered)).toEqual(['a', 'b', 'c']);
    expect(ids(chain.heads)).toEqual(['c']);
    expect(soleHead(chain)?.id).toBe('c');
  });

  it('identical timestamps: the links decide, whatever the arrival order', () => {
    const history: R[] = [
      { id: 'z', at: T(0), supersedes: [] },
      { id: 'y', at: T(0), supersedes: ['z'] },
      { id: 'x', at: T(0), supersedes: ['y'] },
    ];
    for (const list of [history, [...history].reverse(), [history[1]!, history[0]!, history[2]!]]) {
      const chain = orderChain(list, links);
      expect(ids(chain.ordered)).toEqual(['z', 'y', 'x']);
      expect(ids(chain.heads)).toEqual(['x']);
    }
  });

  it('two writers that did not know each other leave two heads (callers fail closed)', () => {
    const chain = orderChain<R>(
      [
        { id: 'a', at: T(0), supersedes: [] },
        { id: 'b', at: T(5), supersedes: ['a'] },
        { id: 'c', at: T(3), supersedes: ['a'] },
      ],
      links,
    );
    expect(ids(chain.heads)).toEqual(['c', 'b']);
    expect(soleHead(chain)).toBeNull();
    // A record naming both heads resolves the fork.
    const merged = orderChain<R>(
      [
        { id: 'a', at: T(0), supersedes: [] },
        { id: 'b', at: T(5), supersedes: ['a'] },
        { id: 'c', at: T(3), supersedes: ['a'] },
        { id: 'd', at: T(1), supersedes: ['b', 'c'] },
      ],
      links,
    );
    expect(ids(merged.heads)).toEqual(['d']);
    expect(ids(merged.ordered)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('legacy records (no links) are chained by time; equal times stay ambiguous unless a rank separates them', () => {
    expect(ids(orderChain<R>([{ id: 'b', at: T(2) }, { id: 'a', at: T(1) }], links).heads)).toEqual(['b']);
    expect(ids(orderChain<R>([{ id: 'b', at: T(1) }, { id: 'a', at: T(1) }], links).heads)).toEqual(['a', 'b']);
    expect(ids(orderChain<R>([{ id: 'b', at: T(1), rank: 0 }, { id: 'a', at: T(1), rank: 1 }], links).heads)).toEqual(['a']);
    // An unreadable legacy time orders nothing: it stays a head.
    expect(ids(orderChain<R>([{ id: 'a', at: T(1) }, { id: 'b', at: 'not a time' }], links).heads)).toEqual(['a', 'b']);
  });

  it('PKG-12: an unranked legacy record stays ambiguous against ranked records of the same instant, in any input order', () => {
    const A: R = { id: 'a', at: T(1) };
    const B: R = { id: 'b', at: T(1), rank: 1 };
    const C: R = { id: 'c', at: T(1), rank: 2 };
    for (const history of [[A, B, C], [C, B, A], [B, A, C], [C, A, B]]) {
      const chain = orderChain<R>(history, links);
      expect(ids(chain.heads)).toEqual(['a', 'c']);
      expect(soleHead(chain)).toBeNull();
    }
    // A later instant still supersedes the whole earlier instant, unranked records included.
    expect(ids(orderChain<R>([A, B, C, { id: 'd', at: T(2) }], links).heads)).toEqual(['d']);
    // Two unranked records of one instant, with a ranked one: all three stay heads.
    expect(ids(orderChain<R>([A, { id: 'e', at: T(1) }, B], links).heads).sort()).toEqual(['a', 'b', 'e']);
  });

  it('a linked record naming the latest legacy record supersedes every older legacy record too', () => {
    const chain = orderChain<R>(
      [
        { id: 'l1', at: T(1) },
        { id: 'l2', at: T(2) },
        { id: 'n', at: T(0), supersedes: ['l2'] },
      ],
      links,
    );
    expect(ids(chain.ordered)).toEqual(['l1', 'l2', 'n']);
    expect(ids(chain.heads)).toEqual(['n']);
  });

  it('a cycle of links (corrupt data) never elects one of its records: they stay heads until a record outside names one', () => {
    const cyc: R[] = [
      { id: 'a', at: T(1), supersedes: ['b'] },
      { id: 'b', at: T(2), supersedes: ['a'] },
    ];
    expect(ids(orderChain(cyc, links).heads)).toEqual(['a', 'b']);
    const resolved = orderChain([...cyc, { id: 'c', at: T(0), supersedes: ['a'] }], links);
    expect(ids(resolved.heads)).toEqual(['c']);
    expect(resolved.ordered.at(-1)?.id).toBe('c');
  });

  it('links to unknown records and to itself are ignored; duplicate ids are both linked', () => {
    const chain = orderChain<R>(
      [
        { id: 'a', at: T(1), supersedes: ['a', 'ghost'] },
        { id: 'b', at: T(1), supersedes: ['a'] },
        { id: 'b', at: T(2), supersedes: [] },
      ],
      links,
    );
    expect(chain.heads.map((r) => `${r.id}@${r.at}`)).toEqual([`b@${T(1)}`, `b@${T(2)}`]);
  });

  it('unreadable times sort last among independent branches (display only)', () => {
    const chain = orderChain<R>(
      [
        { id: 'a', at: 'x', supersedes: [] },
        { id: 'b', at: T(1), supersedes: [] },
      ],
      links,
    );
    expect(ids(chain.ordered)).toEqual(['b', 'a']);
  });

  it('long chains (thousands of records) resolve without deep recursion', () => {
    const n = 3000;
    const history: R[] = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, at: T(0), supersedes: i === 0 ? [] : [`r${i - 1}`] })).reverse();
    const chain = orderChain(history, links);
    expect(ids(chain.heads)).toEqual([`r${n - 1}`]);
    expect(chain.ordered[0]!.id).toBe('r0');
  });

  it('supersededIds normalises a stored field', () => {
    expect(supersededIds(undefined)).toBeUndefined();
    expect(supersededIds(null)).toEqual([]);
    expect(supersededIds('a')).toEqual(['a']);
    expect(supersededIds(['a', 'b'])).toEqual(['a', 'b']);
  });
});
