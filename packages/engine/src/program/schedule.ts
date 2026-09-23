import { WEEKDAYS, type MovementPattern, type Weekday } from '@fitadapt/shared';
import { HARD_PATTERNS, HEAVY_LOWER_FOCUSES, SESSION_TEMPLATES, type SessionTemplateKey } from './templates.js';

/**
 * Weekly layout: which template session falls on which training day.
 * Rules (spec): never two hard sessions for the same movement pattern on
 * consecutive days (also across the week boundary, since the layout repeats);
 * concurrent training: intervals are not placed the day before a heavy
 * lower-body session when that can be avoided. Deterministic: permutations
 * are tried in lexicographic order and the first best one wins, so the
 * template order is kept whenever it is valid.
 */

export interface LayoutSession {
  readonly key: SessionTemplateKey;
  readonly dayIndex: number;
  readonly hardPatterns: readonly MovementPattern[];
  readonly heavyLower: boolean;
}

export interface WeekLayout {
  readonly sessions: readonly LayoutSession[];
  /** Index (in `sessions`) of the element carrying the week's intervals, or null. */
  readonly intervalsAt: number | null;
  /** True when no layout could keep intervals off the day before a heavy lower-body session (the generator then keeps the week steady). */
  readonly intervalsBeforeHeavyLower: boolean;
}

export function templateHardPatterns(key: SessionTemplateKey): MovementPattern[] {
  return [...new Set(SESSION_TEMPLATES[key].slots.map((s) => s.pattern).filter((p) => HARD_PATTERNS.includes(p)))];
}

export function isHeavyLowerFocus(key: SessionTemplateKey): boolean {
  return HEAVY_LOWER_FOCUSES.includes(SESSION_TEMPLATES[key].focus);
}

/** Days apart going forward from day a to day b in a repeating week (1..7). */
const forwardGap = (a: number, b: number) => ((b - a + 7) % 7) || 7;

function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  yield [...a];
  for (;;) {
    let i = n - 2;
    while (i >= 0 && a[i]! >= a[i + 1]!) i--;
    if (i < 0) return;
    let j = n - 1;
    while (a[j]! <= a[i]!) j--;
    [a[i], a[j]] = [a[j]!, a[i]!];
    for (let l = i + 1, r = n - 1; l < r; l++, r--) [a[l], a[r]] = [a[r]!, a[l]!];
    yield [...a];
  }
}

const shares = (a: readonly MovementPattern[], b: readonly MovementPattern[]) => a.some((p) => b.includes(p));

/** No two sessions on consecutive days share a hard pattern (the week repeats, so Sunday → Monday counts). */
export function layoutValid(sessions: readonly LayoutSession[]): boolean {
  for (const a of sessions) {
    for (const b of sessions) {
      if (a !== b && forwardGap(a.dayIndex, b.dayIndex) === 1 && shares(a.hardPatterns, b.hardPatterns)) return false;
    }
  }
  return true;
}

/** Whether the element at `i` sits the day before a heavy lower-body session (repeating week). */
function beforeHeavyLower(sessions: readonly LayoutSession[], i: number): boolean {
  const s = sessions[i]!;
  return sessions.some((o) => o !== s && o.heavyLower && forwardGap(s.dayIndex, o.dayIndex) === 1);
}

/**
 * Lays out the template sessions on the training days, or returns null when
 * no order satisfies the consecutive-day rule. `intervalCandidates(key)` says
 * which sessions may carry the week's intervals (a conditioning session, or a
 * strength session with a finisher); null when the week has none.
 */
export function layoutWeek(keys: readonly SessionTemplateKey[], days: readonly Weekday[], intervalCandidate: ((key: SessionTemplateKey) => boolean) | null): WeekLayout | null {
  const dayIdx = days.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
  const patterns = keys.map(templateHardPatterns);
  const heavy = keys.map(isHeavyLowerFocus);
  let best: WeekLayout | null = null;
  for (const perm of permutations(keys.length)) {
    const sessions = perm.map((k, n) => ({ key: keys[k]!, dayIndex: dayIdx[n]!, hardPatterns: patterns[k]!, heavyLower: heavy[k]! }));
    if (!layoutValid(sessions)) continue;
    let intervalsAt: number | null = null;
    let violation = false;
    if (intervalCandidate) {
      const candidates = sessions.map((s, i) => (intervalCandidate(s.key) ? i : -1)).filter((i) => i >= 0);
      const clean = candidates.find((i) => !beforeHeavyLower(sessions, i));
      intervalsAt = clean ?? candidates[0] ?? null;
      violation = clean === undefined && candidates.length > 0;
    }
    const layout = { sessions, intervalsAt, intervalsBeforeHeavyLower: violation };
    if (!violation) return layout;
    best ??= layout;
  }
  return best;
}
