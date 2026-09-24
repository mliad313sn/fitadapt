import { createEngineContext, type GenerateSessionInput } from '@fitadapt/engine';
import { generateSession } from '@fitadapt/exercise-library';
import type { CoachContext, Locale } from '@fitadapt/shared';
import { clock } from '../clock';
import { useCapacity, useIntensityLock, useJointFlags, useLegal, useProfile, useProgram, useReadinessChecks, useReflows, useSafetyProfile, useSessionHistory } from '../profile/ProfileProvider';
import { localIsoDate, selectDeload, selectReadiness } from '../profile/selectors';
import { seedFrom, todayInput } from '../workout/today';
import { adjustmentFor } from './adjustments';
import { useCoachAdjustment } from './CoachProvider';

/**
 * The minimal context the coach may see (M11 spec), built from the device's
 * own records exactly as the workout screen builds today's session: the
 * SafetyProfile selector, the S2/S3 state, the program and its reflows, and
 * today's plan from the engine. No name, email or date of birth leaves in it
 * beyond what the engine input already needs; the server replaces its
 * safety-relevant parts with what it stores.
 */
export function useCoachContext(locale: Locale): () => CoachContext {
  const profile = useProfile((s) => s.profile);
  const places = useProfile((s) => s.equipment);
  const executionLogs = useProfile((s) => s.executionLogs);
  const readinessChecks = useReadinessChecks();
  const safetyProfile = useSafetyProfile();
  const program = useProgram();
  const reflows = useReflows();
  const capacity = useCapacity();
  const history = useSessionHistory();
  const jointFlags = useJointFlags();
  const intensityLock = useIntensityLock();
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const adjustment = useCoachAdjustment((s) => s.adjustment);

  return () => {
    const now = clock.now();
    const today = localIsoDate(now);
    const adj = adjustmentFor(adjustment, today);
    const facts = profile
      ? todayInput({ profile, safetyProfile, places, program, reflows, capacity, history, jointFlags, intensityLock, today, placeId: null, minutes: adj?.minutes ?? null, readiness: adj?.readiness ?? selectReadiness(readinessChecks, today) })
      : null;
    let todayCtx: CoachContext['today'] = null;
    if (facts?.status === 'ready') {
      const at = now.getTime();
      const deload = selectDeload(executionLogs, history, readinessChecks, at);
      const input: GenerateSessionInput = deload ? { ...facts.input, deload } : facts.input;
      const seed = seedFrom(at);
      const r = generateSession(input, createEngineContext({ clock: { now: () => at }, seed }));
      todayCtx = { input: input as NonNullable<CoachContext['today']>['input'], plan: r.status === 'ok' ? r.plan : null, started: false, generatedAt: now.toISOString(), seed };
    }
    return { locale, jurisdiction, today: todayCtx, program: program ? { record: program, reflows: [...reflows], today } : null };
  };
}
