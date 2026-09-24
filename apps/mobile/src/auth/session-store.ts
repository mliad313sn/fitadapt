import { AuthErrorCode, type DeviceInfo, type Locale, type TokenPair } from '@fitadapt/shared';
import { createStore } from 'zustand';
import { mobileAuthConfig } from '../config/auth.config';
import { reportError } from '../observability';
import { OtherAccountDataError } from '../account/account-binding';
import { ApiRequestError, type AuthApi } from './auth-api';
import type { TokenVault } from './vault';

export type SessionStatus = 'unknown' | 'signed_out' | 'signed_in';

/** Thrown by getAccessToken when there is no session; sync treats it as offline. */
export class NotSignedInError extends Error {
  constructor() {
    super('not signed in');
    this.name = 'NotSignedInError';
  }
}

export interface SessionDeps {
  api: AuthApi;
  vault: TokenVault;
  device: () => DeviceInfo;
  now: () => Date;
  /** Runs after a successful sign-in (upload the device ledgers, then sync). */
  onSignedIn?: () => void;
  /**
   * MOB-07: whether this phone's data may go to the account that just signed
   * in (AccountBinding.claim). When false the new session is ended at once
   * (logout), nothing is kept, and verifyCode throws OtherAccountDataError.
   */
  claimAccount?: (accountId: string) => boolean;
}

export interface SessionState {
  status: SessionStatus;
  /** Reads the refresh token from the keystore at start. */
  restore(): Promise<void>;
  requestCode(email: string, locale: Locale): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ isNewUser: boolean }>;
  /** A valid access token, refreshed (rotation) when it is about to expire. */
  getAccessToken(): Promise<string>;
  signOut(): Promise<void>;
  /** Forgets the session on this device without calling the API (account deleted). */
  forget(): Promise<void>;
}

const ENDED = new Set<string>([AuthErrorCode.InvalidRefreshToken, AuthErrorCode.RefreshTokenReused, AuthErrorCode.Unauthorized]);

/**
 * Device session (ADR-003, ADR-013): refresh token in the OS keystore, access
 * token in memory only. Signing in is optional: the app works offline without
 * an account; sync and the data-rights endpoints need it.
 */
export function createSessionStore({ api, vault, device, now, onSignedIn, claimAccount }: SessionDeps) {
  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;
  const margin = mobileAuthConfig.accessTokenRefreshMarginSeconds.value * 1000;

  return createStore<SessionState>((set, get) => {
    const keep = async (tokens: TokenPair) => {
      await vault.set(tokens.refreshToken);
      access = { token: tokens.accessToken, expiresAt: now().getTime() + tokens.accessTokenExpiresInSeconds * 1000 };
    };
    const end = async () => {
      access = null;
      await vault.remove().catch((error: unknown) => reportError(error, { area: 'auth' }));
      set({ status: 'signed_out' });
    };
    return {
      status: 'unknown',
      async restore() {
        try {
          set({ status: (await vault.get()) ? 'signed_in' : 'signed_out' });
        } catch (error) {
          reportError(error, { area: 'auth' });
          set({ status: 'signed_out' });
        }
      },
      requestCode: (email, locale) => api.requestCode(email, locale),
      async verifyCode(email, code) {
        const res = await api.verifyCode(email, code, device());
        if (claimAccount && !claimAccount(res.user.id)) {
          // Another account's data is on this phone: its outbox and ledgers must never reach this account.
          await api.logout(res.tokens.refreshToken).catch((error: unknown) => reportError(error, { area: 'auth' }));
          throw new OtherAccountDataError();
        }
        await keep(res.tokens);
        set({ status: 'signed_in' });
        onSignedIn?.();
        return { isNewUser: res.isNewUser };
      },
      async getAccessToken() {
        if (access && access.expiresAt - margin > now().getTime()) return access.token;
        if (get().status !== 'signed_in') throw new NotSignedInError();
        refreshing ??= (async () => {
          try {
            const refreshToken = await vault.get();
            if (!refreshToken) throw new NotSignedInError();
            const tokens = await api.refresh(refreshToken);
            await keep(tokens);
            return tokens.accessToken;
          } catch (error) {
            // Session ended on the server (expired, reused, revoked): sign out on the device too.
            if (error instanceof NotSignedInError || (error instanceof ApiRequestError && error.code !== undefined && ENDED.has(error.code))) await end();
            throw error;
          } finally {
            refreshing = null;
          }
        })();
        return refreshing;
      },
      async signOut() {
        const refreshToken = await vault.get().catch(() => null);
        if (refreshToken) await api.logout(refreshToken).catch((error: unknown) => reportError(error, { area: 'auth' }));
        await end();
      },
      forget: end,
    };
  });
}

export type SessionStore = ReturnType<typeof createSessionStore>;
