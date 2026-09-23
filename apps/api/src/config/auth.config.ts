import { defineConfig } from '@fitadapt/shared';

/**
 * Authentication security parameters (CLAUDE.md rule 4: every threshold carries
 * a source and a validation status). These are engineering defaults chosen in
 * ADR-003, not health or training values; they await security review in M17.
 */
const SOURCE = 'docs/adr/ADR-003-auth.md (engineering default)';

export const authConfig = defineConfig({
  otpTtlSeconds: { value: 600, unit: 's', source: SOURCE, validated: false },
  otpMaxVerifyAttempts: { value: 5, unit: 'attempts per code', source: SOURCE, validated: false },
  otpRequestsPerEmailPerWindow: { value: 5, unit: 'requests', source: SOURCE, validated: false },
  otpRequestsPerIpPerWindow: { value: 20, unit: 'requests', source: SOURCE, validated: false },
  otpVerifyPerEmailPerWindow: { value: 10, unit: 'attempts', source: SOURCE, validated: false },
  rateLimitWindowSeconds: { value: 900, unit: 's', source: SOURCE, validated: false },
  accessTokenTtlSeconds: { value: 900, unit: 's', source: SOURCE, validated: false },
  refreshTokenTtlSeconds: { value: 2_592_000, unit: 's', source: SOURCE, validated: false },
});

export type AuthConfigKey = keyof typeof authConfig;

export function authValue(key: AuthConfigKey): number {
  return authConfig[key].value;
}
