import { isAtLeastAsStrict } from '@fitadapt/safety';
import { orderChain, type AssessmentRecord, type ChainOrder, type ExecutionLog, type Joint, type ProgramRecord, type ReflowRecord } from '@fitadapt/shared';

/**
 * ADR-023 on the device: the histories where the latest counts are ordered
 * by their `supersedes` chains (packages/shared orderChain), never by the
 * device clock, and a new record names the heads it replaces. Where the
 * chain leaves several candidates, the selectors fail closed.
 */
interface Entry<T> {
  readonly id: string;
  readonly data: T;
}

export function orderAssessments<T extends Entry<AssessmentRecord>>(list: readonly T[]): ChainOrder<T> {
  return orderChain(list, (a) => ({ id: a.id, supersedes: a.data.supersedes, at: a.data.capacity.assessedAt }));
}

export function orderPrograms<T extends Entry<ProgramRecord>>(list: readonly T[]): ChainOrder<T> {
  return orderChain(list, (p) => ({ id: p.id, supersedes: p.data.supersedes, at: p.data.program.generatedAt }));
}

/** Reflows are replayed in chain order (each names the reflows of its program it follows); older ones by `decidedAt`. */
export function orderReflows<T extends Entry<ReflowRecord>>(list: readonly T[]): ChainOrder<T> {
  return orderChain(list, (r) => ({ id: r.id, supersedes: r.data.supersedes, at: r.data.decidedAt }));
}

/** The reflows of one program a new reflow follows: the heads of that program's chain. */
export function reflowHeads(list: readonly Entry<ReflowRecord>[], programId: string): string[] {
  return orderReflows(list.filter((r) => r.data.programId === programId)).heads.map((r) => r.id);
}

/**
 * The capacity model that counts. Several candidates (two devices assessed
 * without knowing each other): the most conservative starting point — the
 * lowest rungs, then the lowest starting loads (fail closed), then the chain
 * order. Each candidate is one the server stores, as it requires.
 */
export function latestAssessment<T extends Entry<AssessmentRecord>>(list: readonly T[]): T | null {
  const { heads } = orderAssessments(list);
  if (heads.length <= 1) return heads[0] ?? null;
  const weight = (a: T) => {
    const slots = a.data.capacity.slots;
    return [slots.reduce((s, x) => s + x.stepIndex, 0), slots.reduce((s, x) => s + (x.loadKg ?? 0), 0)] as const;
  };
  return heads.reduce((best, h) => {
    const [bs, bl] = weight(best);
    const [hs, hl] = weight(h);
    return hs < bs || (hs === bs && hl < bl) ? h : best;
  });
}

/**
 * The program that counts. Several candidates: the one made on a
 * SafetyProfile at least as strict as the others' (fail closed), then the
 * chain order. Sessions are re-checked against the current SafetyProfile in
 * any case (engine and server).
 */
export function latestProgram<T extends Entry<ProgramRecord>>(list: readonly T[]): T | null {
  const { heads } = orderPrograms(list);
  if (heads.length <= 1) return heads[0] ?? null;
  const score = (p: T) => heads.filter((o) => isAtLeastAsStrict(p.data.input.safetyProfile, o.data.input.safetyProfile)).length;
  return heads.reduce((best, h) => (score(h) > score(best) ? h : best));
}

/**
 * The links a new execution event carries (ADR-023): its own id, and
 * - a pain report: the latest reports of the same joint it follows;
 * - an attestation: the red flags it covers (every one not yet named).
 */
export function executionLinks(event: ExecutionLog, eventId: string, existing: readonly ExecutionLog[]): ExecutionLog {
  if (event.kind === 'pain') {
    const joint: Joint = event.joint;
    const reports = existing.filter((e): e is Extract<ExecutionLog, { kind: 'pain' }> => e.kind === 'pain' && e.joint === joint && e.eventId !== undefined);
    const named = new Set(reports.flatMap((r) => r.after ?? []));
    return { ...event, eventId, after: reports.filter((r) => !named.has(r.eventId!)).map((r) => r.eventId!) };
  }
  if (event.kind === 'red_flag') return { ...event, eventId };
  if (event.kind === 'medical_review_attested') {
    const attested = new Set(existing.flatMap((e) => (e.kind === 'medical_review_attested' ? (e.attests ?? []) : [])));
    const flags = existing.flatMap((e) => (e.kind === 'red_flag' && e.eventId !== undefined && !attested.has(e.eventId) ? [e.eventId] : []));
    return { ...event, attests: flags };
  }
  return event;
}
