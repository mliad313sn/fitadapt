import { DEFAULT_REGISTRY, type LegalRegistry } from '@fitadapt/legal';

/**
 * The legal document registry bundled with the app (packages/legal, M20). The
 * device evaluates acceptances offline against it; tests replace this module
 * to publish a new material version.
 */
export function currentLegalRegistry(): LegalRegistry {
  return DEFAULT_REGISTRY;
}
