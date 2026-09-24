import type { PainReport, SafetyStopEvent } from '@fitadapt/safety';
import type { ExecutionLog } from '@fitadapt/shared';

/**
 * The M05 facts the device and the server read from the same append-only
 * execution logs (so both derive the same S2 flags, S3 lock and deloads):
 * pain reports with their phase and session, and the red flags and
 * medical-review attestations, in the order recorded.
 */
export function painReportsFrom(logs: readonly ExecutionLog[]): PainReport[] {
  return logs.flatMap((e) => (e.kind === 'pain' ? [{ joint: e.joint, score: e.score, at: e.at, phase: e.phase ?? 'during', ...(e.settled === undefined ? {} : { settled: e.settled }), sessionId: e.planId }] : []));
}

export function safetyStopsFrom(logs: readonly ExecutionLog[]): SafetyStopEvent[] {
  return logs.flatMap((e) => (e.kind === 'red_flag' || e.kind === 'medical_review_attested' ? [{ kind: e.kind, at: e.at }] : []));
}
