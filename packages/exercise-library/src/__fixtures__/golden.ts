/**
 * SAF-10: every golden file records the engine and rules versions it was
 * produced with, so a golden diff shows whether the version moved with it,
 * and golden-versions.test.ts ties the goldens' content to ENGINE_VERSION
 * (a prescription change without a version bump fails). Test-only.
 */
import { ENGINE_VERSION, PAIR_RULES_VERSION, PROGRAM_RULES_VERSION, SESSION_RULES_VERSION } from '@fitadapt/engine';

const RULES = { sessions: SESSION_RULES_VERSION, program: PROGRAM_RULES_VERSION, pair: PAIR_RULES_VERSION } as const;

export function versioned<T extends object>(kind: keyof typeof RULES, body: T): { engineVersion: string; rulesVersion: string } & T {
  return { engineVersion: ENGINE_VERSION, rulesVersion: RULES[kind], ...body };
}
