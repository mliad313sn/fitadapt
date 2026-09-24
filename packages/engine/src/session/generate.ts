import { evaluateAgeGate } from '@fitadapt/safety';
import { GenerateSessionInputSchema, GenerateSessionResultSchema } from '@fitadapt/shared';
import type { EngineContext } from '../context.js';
import { ageGateDate } from '../local-date.js';
import { boundSessionInput } from './bounds.js';

export { ageGateDate } from '../local-date.js';
import { firstSession, firstSessionRir } from './first-session.js';
import type { SessionLibrary } from './library.js';
import { programSession } from './program-session.js';
import { mobilitySession } from '../recovery/mobility-session.js';
import { cardioSession } from '../cardio/session.js';
import type { GenerateSessionInput, GenerateSessionResult } from './types.js';

/**
 * The only source of training sessions (CLAUDE.md rule 2). One generator:
 * the M07 first session from the capacity model, and every later session
 * from the M08 program day (with history, progression, time-boxing and the
 * Anywhere Switcher). Input and output are zod-validated at this boundary;
 * the engine is pure (injected clock and seed, no I/O).
 *
 * Gates first, in this order (fail closed):
 * - S7 / M01: blocked, not screened, or excluded from automatic programming (pregnancy/postpartum, low-intensity library) → no session;
 * - S1: no reserve the screening gate accepts → no session (effort cap);
 * - SAF-12/SAF-5: a local date more than a day from the engine clock's → no session (clock mismatch);
 * - S7 / M17: a date of birth under 16 on the earlier of the local and UTC dates → no session;
 * - S3: intensity locked after a red-flag stop until a medical review is attested → no session.
 * Then the route: a standalone mobility and balance session (M05, mode
 * 'mobility_balance'), a cardio session (M03, mode 'cardio'), the M08
 * program session (with its M03 conditioning block), or the M07 first session.
 */
export function generateSession(rawInput: GenerateSessionInput, library: SessionLibrary, ctx: EngineContext): GenerateSessionResult {
  // SAF-1: a long-time user's history exceeds the boundary cap; keep the newest sessions, folding dropped S5 references.
  const input = GenerateSessionInputSchema.parse(boundSessionInput(rawInput, ctx.clock.now())) as GenerateSessionInput;
  const profile = input.safetyProfile;
  const unavailable = (code: string): GenerateSessionResult => ({ status: 'unavailable', reasonCodes: [code] });
  if (profile.screeningOutcome === 'blocked') return unavailable('session.unavailable.blocked');
  if (profile.screeningOutcome === 'not_screened') return unavailable('session.unavailable.not_screened');
  if (!profile.automaticProgrammingAllowed || profile.lowIntensityLibraryOnly) return unavailable('session.unavailable.professional_guidance');
  const firstRir = firstSessionRir(profile);
  if (firstRir === null) return unavailable('session.unavailable.effort_cap');
  const gateDate = ageGateDate(input.localDate, ctx.clock.now());
  if (gateDate === null) return unavailable('session.unavailable.clock_mismatch');
  if (input.birthDate) {
    const gate = evaluateAgeGate(input.birthDate, gateDate);
    if (gate.status !== 'allowed') return unavailable('session.unavailable.s7_age');
  }
  if (input.intensityLock.locked) return unavailable('session.unavailable.s3_intensity_locked');

  let result: GenerateSessionResult;
  if (input.mode === 'mobility_balance') result = mobilitySession(input, library, ctx);
  else if (input.mode === 'cardio') result = cardioSession(input, library, ctx);
  else if (input.programSession) result = programSession(input, library, ctx);
  else if (input.capacity) result = firstSession(input, library, ctx, firstRir);
  else result = unavailable('session.unavailable.no_program');
  return GenerateSessionResultSchema.parse(result) as GenerateSessionResult;
}
