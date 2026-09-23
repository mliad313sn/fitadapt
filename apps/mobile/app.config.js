// @ts-check
/**
 * Expo reads app.json, then this file. M20 release guard: a production build
 * (eas.json sets APP_VARIANT=production) refuses to build while any enabled
 * legal text lacks counsel approval (docs/legal/counsel-signoff-tracker.md).
 * Today every text is a draft, so a production build fails here on purpose.
 */
const { assertLegalReleaseReady, buildProfileFrom } = require('@fitadapt/legal');

/** @param {{ config: Record<string, unknown> }} context */
module.exports = ({ config }) => {
  assertLegalReleaseReady(buildProfileFrom(process.env));
  return config;
};
