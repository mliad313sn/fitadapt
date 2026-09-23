import type { IdentityProvider } from '@fitadapt/shared';
import { authErrors } from './errors.js';

export interface VerifiedIdentity {
  provider: IdentityProvider;
  /** Stable subject identifier from the provider. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Verifies a Sign in with Apple / Google ID token (signature, issuer, audience,
 * expiry, nonce). Real verifiers need provider credentials and are added once
 * they exist (ADR-003); until then every provider answers "not configured".
 */
export interface IdentityProviderVerifier {
  verify(provider: IdentityProvider, idToken: string): Promise<VerifiedIdentity>;
}

export class NotConfiguredIdentityVerifier implements IdentityProviderVerifier {
  async verify(): Promise<VerifiedIdentity> {
    throw authErrors.providerNotConfigured();
  }
}
