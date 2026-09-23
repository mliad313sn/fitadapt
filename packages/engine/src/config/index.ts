import type { ConfigValue } from '@fitadapt/shared';
import { ASSESSMENT_CONFIG, FIRST_SESSION_CONFIG } from '../assessment/config.js';
import { PROGRAM_CONFIG } from '../program/config.js';
import { SUBSTITUTION_CONFIG } from '../substitution.js';
import { INCREMENT_CONFIG, SESSION_CONFIG } from './session.js';

export * from './session.js';

/**
 * Every coefficient and threshold of the engine, in one place (goal
 * condition 7): M02 session and increment values live here; the M07
 * assessment, M08 program and M06 substitution values stay next to their
 * rules and are listed here. Each value has a `source` and `validated`
 * (false for all of them until a council sign-off record exists).
 */
export const ENGINE_CONFIGS: Readonly<Record<string, Readonly<Record<string, ConfigValue>>>> = Object.freeze({
  session: SESSION_CONFIG,
  increments: INCREMENT_CONFIG,
  firstSession: FIRST_SESSION_CONFIG,
  assessment: ASSESSMENT_CONFIG,
  program: PROGRAM_CONFIG,
  substitution: SUBSTITUTION_CONFIG,
});
