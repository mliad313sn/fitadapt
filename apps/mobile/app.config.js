// @ts-check
/**
 * Expo reads app.json, then this file. Release guards for a production build
 * (eas.json sets APP_VARIANT=production):
 * - M20: refuses to build while any enabled legal text lacks counsel approval
 *   (docs/legal/counsel-signoff-tracker.md);
 * - M06: refuses to build while any bundled exercise lacks the physio review
 *   (seat A2), the coach review (seat A3) or validation.
 * Today every text and every exercise is a draft, so a production build fails
 * here on purpose.
 */
const { assertLegalReleaseReady, buildProfileFrom } = require('@fitadapt/legal');
const { assertLibraryReleaseReady, SEED_EXERCISES } = require('@fitadapt/exercise-library');

/** @param {{ config: Record<string, unknown> }} context */
module.exports = ({ config }) => {
  const profile = buildProfileFrom(process.env);
  assertLegalReleaseReady(profile);
  assertLibraryReleaseReady({ production: profile === 'production' }, SEED_EXERCISES);
  return config;
};
