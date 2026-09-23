// @ts-check
/**
 * Store listing metadata (fastlane layout) generated from the i18n
 * catalogues (`store.listing.*`), so store copy goes through FR/EN i18n
 * (CLAUDE.md rule 5) and through the claims linter.
 */
export const STORE_LOCALES = /** @type {const} */ ({ 'en-US': 'en', 'fr-FR': 'fr' });
export const STORE_FIELDS = /** @type {const} */ ({
  'name.txt': 'store.listing.name',
  'subtitle.txt': 'store.listing.subtitle',
  'description.txt': 'store.listing.description',
  'keywords.txt': 'store.listing.keywords',
  'promotional_text.txt': 'store.listing.promotionalText',
});

/**
 * @param {{ en: Record<string, string>, fr: Record<string, string> }} catalogues
 * @returns {Record<string, string>} repository-relative path -> content
 */
export function storeMetadataFiles(catalogues) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const [storeLocale, locale] of Object.entries(STORE_LOCALES)) {
    for (const [file, key] of Object.entries(STORE_FIELDS)) {
      const text = catalogues[locale][key];
      if (text === undefined) throw new Error(`missing catalogue key ${key} (${locale})`);
      files[`store/metadata/${storeLocale}/${file}`] = `${text}\n`;
    }
  }
  return files;
}
