import { defineConfig } from '@fitadapt/shared';

/**
 * Device-side session parameters (M01, ADR-013). Engineering defaults without
 * an external source; for security review with the M00 auth thresholds.
 */
export const mobileAuthConfig = defineConfig({
  accessTokenRefreshMarginSeconds: {
    value: 30,
    unit: 's',
    source: 'docs/adr/ADR-013-mobile-sign-in-and-account-sync.md (engineering default, no external source)',
    validated: false,
  },
});
