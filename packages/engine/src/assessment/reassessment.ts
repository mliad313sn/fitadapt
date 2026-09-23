import type { CapacityModel } from '@fitadapt/shared';
import type { Clock } from '../clock.js';

export type ReassessmentStatus =
  | { readonly status: 'never_assessed' }
  | { readonly status: 'not_due'; readonly dueAt: string }
  | { readonly status: 'due'; readonly dueAt: string; readonly reasonCode: 'assessment.reassess.mesocycle_end' };

/**
 * Re-assessment at the end of each mesocycle (M07 spec). The end is the one
 * M08 gives for the current block when it exists, otherwise the capacity
 * model's default (assessedAt + defaultMesocycleWeeks). On demand is always
 * possible; this only decides when the app prompts. Injected clock.
 */
export function reassessmentStatus(latest: Pick<CapacityModel, 'reassessDueAt'> | null, clock: Clock, mesocycleEndsAt: string | null = null): ReassessmentStatus {
  if (!latest) return { status: 'never_assessed' };
  const dueAt = mesocycleEndsAt ?? latest.reassessDueAt;
  return clock.now() >= Date.parse(dueAt) ? { status: 'due', dueAt, reasonCode: 'assessment.reassess.mesocycle_end' } : { status: 'not_due', dueAt };
}
