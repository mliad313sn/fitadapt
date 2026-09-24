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
const { en, fr } = require('@fitadapt/i18n');

/**
 * M04: the camera and photo-library permission texts come from packages/i18n
 * (CLAUDE.md rule 5): English in the plugin, English and French in the iOS
 * InfoPlist.strings (`locales`). No microphone (the picker records no video).
 */
const permissionTexts = (catalogue) => ({ NSCameraUsageDescription: catalogue['photos.permission.camera'], NSPhotoLibraryUsageDescription: catalogue['photos.permission.library'] });

/** @param {{ config: Record<string, unknown> }} context */
module.exports = ({ config }) => {
  const profile = buildProfileFrom(process.env);
  assertLegalReleaseReady(profile);
  assertLibraryReleaseReady({ production: profile === 'production' }, SEED_EXERCISES);
  for (const plugin of Array.isArray(config.plugins) ? config.plugins : []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-image-picker') {
      plugin[1] = { ...plugin[1], cameraPermission: en['photos.permission.camera'], photosPermission: en['photos.permission.library'] };
    }
  }
  config.locales = { ...(config.locales ?? {}), en: permissionTexts(en), fr: permissionTexts(fr) };
  return config;
};
