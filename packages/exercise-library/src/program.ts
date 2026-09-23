import { generateProgram as generateOnLibrary, type EngineContext, type GenerateProgramResult, type ProgramLibrary } from '@fitadapt/engine';
import type { ProgramInput } from '@fitadapt/shared';
import { seedLibrary } from './library.js';

/**
 * M08 bound to the M06 seed: the engine's program generator over the seed's
 * exercises (which movement patterns a place and a SafetyProfile allow). The
 * rules live in packages/engine/src/program.
 */
export function programLibrary(): ProgramLibrary {
  return { exercises: seedLibrary().graph.exercises };
}

let bound: ProgramLibrary | undefined;

export function generateProgram(input: ProgramInput, ctx: EngineContext): GenerateProgramResult {
  return generateOnLibrary(input, (bound ??= programLibrary()), ctx);
}
