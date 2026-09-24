/**
 * Clock-independent order of an append-only history where "the latest
 * counts" (screenings, consents, nutrition plans, programs, assessments,
 * readiness checks of a day, reflows of a program). ADR-023,
 * docs/status/FIX-latest-record-ordering.md.
 *
 * Timestamps written by a device cannot order such a history: two records
 * can carry the same instant (a frozen or coarse clock, two saves in one
 * millisecond) and a device clock can go backwards, so a NEW record looks
 * OLDER. Records arriving from another device through sync carry that
 * device's clock. Picking "the last one by time" can then pick an older,
 * looser record (a screening before the user reported being advised against
 * calorie restriction, a consent grant before its withdrawal).
 *
 * Each new record therefore names the records it replaces: `supersedes`
 * lists the heads (the current latest records) its writer knew. The order is
 * the order of that chain, never the clock:
 * - R is superseded when a record outside R's own cycle (if any) names R or
 *   names a record R reaches through the chain (every record R replaced);
 * - the heads are the records nothing supersedes. One head is the latest.
 *   Several heads mean the writers did not know each other (two devices
 *   offline) or the history is ambiguous: callers FAIL CLOSED (the most
 *   restrictive outcome among the heads), never "the newest timestamp".
 * - records stored before links existed (`supersedes` absent, "legacy") are
 *   chained among themselves by time and then by `legacyRank` when the
 *   caller has a clock-independent rank (a ledger's append position); equal
 *   keys stay ambiguous (both heads) — fail closed. An unreadable time never
 *   orders a legacy record.
 * - a cycle of links (corrupt data) is never resolved in favour of one of its
 *   records: its records stay heads unless a record outside the cycle
 *   supersedes them.
 * `ordered` (oldest first) puts every record after every record it
 * supersedes; independent branches are ordered by time then id, for display
 * only (never to pick the latest).
 */
export interface ChainLinks {
  readonly id: string;
  /** Ids of the records this one replaces. Absent (undefined) = stored before links existed. */
  readonly supersedes?: readonly string[] | undefined;
  /** ISO timestamp: orders legacy records among themselves, and branches for display. */
  readonly at: string;
  /** Legacy records only: a clock-independent tie-break for equal times (e.g. an append position). */
  readonly legacyRank?: number | undefined;
}

export interface ChainOrder<T> {
  /** Oldest first: every record after all the records it supersedes. */
  readonly ordered: T[];
  /** The records nothing supersedes, in `ordered` order. One = an unambiguous latest. */
  readonly heads: T[];
}

interface Node<T> {
  readonly item: T;
  readonly index: number;
  readonly links: ChainLinks;
  readonly time: number;
}

const timeOf = (at: string) => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? Number.NaN : t;
};

/** Strongly connected components (iterative Tarjan): comp[i] is the component of node i. */
function components(preds: readonly number[][]): number[] {
  const n = preds.length;
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const comp = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let compCount = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: Array<{ v: number; next: number }> = [{ v: root, next: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const edges = preds[frame.v]!;
      if (frame.next < edges.length) {
        const w = edges[frame.next++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          work.push({ v: w, next: 0 });
        } else if (onStack[w]) {
          low[frame.v] = Math.min(low[frame.v]!, index[w]!);
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.v;
        low[parent] = Math.min(low[parent]!, low[frame.v]!);
      }
      if (low[frame.v] === index[frame.v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = false;
          comp[w] = compCount;
        } while (w !== frame.v);
        compCount++;
      }
    }
  }
  return comp;
}

/** A small binary min-heap (display order of independent branches). */
class MinHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => number) {}
  get size() {
    return this.items.length;
  }
  push(x: T) {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

export function orderChain<T>(items: readonly T[], linksOf: (item: T) => ChainLinks): ChainOrder<T> {
  const nodes: Node<T>[] = items.map((item, index) => {
    const links = linksOf(item);
    return { item, index, links, time: timeOf(links.at) };
  });
  const byId = new Map<string, number[]>();
  nodes.forEach((node, i) => {
    const list = byId.get(node.links.id);
    if (list) list.push(i);
    else byId.set(node.links.id, [i]);
  });

  // preds[i]: the records i supersedes directly.
  const preds: number[][] = nodes.map(() => []);
  nodes.forEach((node, i) => {
    for (const id of node.links.supersedes ?? []) for (const j of byId.get(id) ?? []) if (j !== i) preds[i]!.push(j);
  });
  // Legacy records: chained by (time, rank); equal keys stay side by side (ambiguous).
  const legacy = nodes
    .map((node, i) => ({ node, i }))
    .filter(({ node }) => node.links.supersedes === undefined && !Number.isNaN(node.time))
    .sort((a, b) => a.node.time - b.node.time || (a.node.links.legacyRank ?? 0) - (b.node.links.legacyRank ?? 0));
  const sameKey = (a: Node<T>, b: Node<T>) => a.time === b.time && (a.links.legacyRank === undefined || b.links.legacyRank === undefined || a.links.legacyRank === b.links.legacyRank);
  let previousGroup: number[] = [];
  let group: number[] = [];
  legacy.forEach(({ node, i }, k) => {
    if (k > 0 && !sameKey(legacy[k - 1]!.node, node)) {
      previousGroup = group;
      group = [];
    }
    group.push(i);
    for (const j of previousGroup) preds[i]!.push(j);
  });

  const comp = components(preds);
  // j is superseded iff a record outside j's cycle reaches it, i.e. iff j's component has an incoming link from another component.
  const compSuperseded = new Set<number>();
  preds.forEach((list, i) => {
    for (const j of list) if (comp[j] !== comp[i]) compSuperseded.add(comp[j]!);
  });
  const superseded = nodes.map((_, i) => compSuperseded.has(comp[i]!));

  // Display order: components in dependency order, ties by time (unreadable last), id, position.
  const before = (a: number, b: number) => {
    const ta = nodes[a]!.time;
    const tb = nodes[b]!.time;
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
    if (!Number.isNaN(ta) && ta !== tb) return ta - tb;
    const ia = nodes[a]!.links.id;
    const ib = nodes[b]!.links.id;
    return ia < ib ? -1 : ia > ib ? 1 : a - b;
  };
  // Components (a cycle is one) in dependency order (Kahn with a heap), members of a component together, by time then id.
  const members = new Map<number, number[]>();
  comp.forEach((c, i) => {
    const list = members.get(c);
    if (list) list.push(i);
    else members.set(c, [i]);
  });
  for (const list of members.values()) list.sort(before);
  const waiting = new Map<number, number>();
  const dependents = new Map<number, number[]>();
  preds.forEach((list, i) => {
    for (const j of list) {
      const ci = comp[i]!;
      const cj = comp[j]!;
      if (ci === cj) continue;
      waiting.set(ci, (waiting.get(ci) ?? 0) + 1);
      const deps = dependents.get(cj);
      if (deps) deps.push(ci);
      else dependents.set(cj, [ci]);
    }
  });
  const heap = new MinHeap<number>((a, b) => before(members.get(a)![0]!, members.get(b)![0]!));
  for (const c of members.keys()) if (!waiting.has(c)) heap.push(c);
  const ordered: number[] = [];
  while (heap.size > 0) {
    const c = heap.pop()!;
    ordered.push(...members.get(c)!);
    for (const d of dependents.get(c) ?? []) {
      const left = waiting.get(d)! - 1;
      waiting.set(d, left);
      if (left === 0) heap.push(d);
    }
  }
  return {
    ordered: ordered.map((i) => nodes[i]!.item),
    heads: ordered.filter((i) => !superseded[i]).map((i) => nodes[i]!.item),
  };
}

/** The single latest record, or null when there is none or when the heads are ambiguous (callers then fail closed). */
export function soleHead<T>(chain: ChainOrder<T>): T | null {
  return chain.heads.length === 1 ? chain.heads[0]! : null;
}

/** Normalises a stored `supersedes` field (one id, a list, null or absent) for `orderChain`. */
export function supersededIds(value: string | readonly string[] | null | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  return typeof value === 'string' ? [value] : value;
}
