/**
 * Bumped whenever engine behaviour changes; recorded with every future prescription.
 * The golden files record it, and packages/exercise-library golden-versions.test.ts fails when their content
 * changes without a bump (SAF-10). 0.5.0: the FIX-A safety and engine fixes (docs/status/FIX-A-engine-safety.md).
 */
export const ENGINE_VERSION = '0.5.0';
