import { S5_WINDOW_DAYS, type LoadReference } from '@fitadapt/safety';
import { RECENT_LOADS_MAX, SESSION_HISTORY_MAX, type FoldedLoad, type SessionHistoryEntry } from '@fitadapt/shared';
import type { GenerateSessionInput, RecentLoad } from './types.js';

/**
 * Bounded engine inputs (SAF-1, SAF-6, SAF-7). The boundary schemas cap the
 * history at 60 sessions, a session at 20 exercises and load references at
 * 500. A long-time user exceeds them, and the engine must keep working
 * without losing an S5 reference:
 *
 * - `boundSessionInput` keeps the newest 60 sessions (the engine reads at
 *   most 24 for progression, two weeks for the HIIT gate and seven days for
 *   S5) and folds every load of the dropped sessions that is still in the S5
 *   window into `recentLoads`;
 * - `foldLoads` reduces references to one per exercise: the LOWEST load at the
 *   LATEST time. S5's ceiling is 10 % above the lowest reference in the
 *   window, so a folded list gives the same ceiling or a lower one — never a
 *   looser one;
 * - `s5WindowReferences` gives `evaluateProgression` only what S5 reads at
 *   `nowMs` (at most one reference, same ceiling), so its 500 cap is never hit.
 * Pure; the device and the server get the same result from the same input.
 */

const DAY_MS = 86_400_000;

const inWindow = (at: string, nowMs: number) => !(Date.parse(at) < nowMs - S5_WINDOW_DAYS * DAY_MS);
const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

/** One reference per exercise: its lowest positive load at its latest time (zero loads are no reference for S5). */
export function foldLoads(loads: readonly FoldedLoad[]): FoldedLoad[] {
  const by = new Map<string, FoldedLoad>();
  for (const l of loads) {
    if (!(l.loadKg > 0)) continue;
    const prev = by.get(l.exerciseId);
    by.set(l.exerciseId, prev ? { exerciseId: l.exerciseId, loadKg: Math.min(prev.loadKg, l.loadKg), at: later(prev.at, l.at) } : { ...l });
  }
  return [...by.values()].sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0));
}

/** Every S5 reference a history entry holds, per exercise (prescribed loads, done loads, folded overflow). */
export function entryLoads(h: SessionHistoryEntry): FoldedLoad[] {
  const out: FoldedLoad[] = [];
  for (const e of h.exercises) {
    if (e.prescribedLoadKg !== null) out.push({ exerciseId: e.exerciseId, loadKg: e.prescribedLoadKg, at: h.prescribedAt });
    for (const p of e.performed) if (p.status === 'done' && p.loadKg !== null) out.push({ exerciseId: e.exerciseId, loadKg: p.loadKg, at: h.startedAt });
  }
  for (const o of h.overflowLoads ?? []) out.push(o);
  return out;
}

/** The references S5 reads at `nowMs`, reduced to the one that sets the ceiling (same ceiling as the full list). */
export function s5WindowReferences(references: readonly LoadReference[], nowMs: number): LoadReference[] {
  let lowest: LoadReference | null = null;
  for (const r of references) {
    if (!inWindow(r.at, nowMs)) continue;
    // Unreadable loads never reach here (zod); keep them anyway so S5 fails closed on them.
    if (!Number.isFinite(r.loadKg) || r.loadKg < 0) return [r];
    if (r.loadKg > 0 && (lowest === null || r.loadKg < lowest.loadKg)) lowest = r;
  }
  return lowest === null ? [] : [lowest];
}

const toRecent = (l: FoldedLoad): RecentLoad => ({ exerciseId: l.exerciseId, loadKg: l.loadKg, prescribedAt: l.at });

/**
 * The input with at most 60 sessions of history and 500 recent loads, keeping
 * every S5 reference in the window at `nowMs` (folded). Unchanged when already
 * within the caps. History is oldest first (buildSessionHistory); the newest
 * sessions are kept.
 */
export function boundSessionInput<T extends Pick<GenerateSessionInput, 'history' | 'recentLoads'>>(input: T, nowMs: number): T {
  const history = input.history ?? [];
  const recent = input.recentLoads ?? [];
  if (history.length <= SESSION_HISTORY_MAX && recent.length <= RECENT_LOADS_MAX) return input;
  const kept = history.slice(Math.max(0, history.length - SESSION_HISTORY_MAX));
  const dropped = history.slice(0, Math.max(0, history.length - SESSION_HISTORY_MAX)).flatMap(entryLoads).filter((l) => inWindow(l.at, nowMs));
  let loads: RecentLoad[] = [...recent, ...foldLoads(dropped).map(toRecent)];
  if (loads.length > RECENT_LOADS_MAX) {
    // Only the S5 window matters at `nowMs`; fold it per exercise (never looser).
    loads = foldLoads(loads.filter((l) => inWindow(l.prescribedAt, nowMs)).map((l) => ({ exerciseId: l.exerciseId, loadKg: l.loadKg, at: l.prescribedAt }))).map(toRecent);
  }
  return { ...input, ...(input.history !== undefined ? { history: kept } : {}), ...(loads.length > 0 || input.recentLoads !== undefined ? { recentLoads: loads } : {}) };
}
