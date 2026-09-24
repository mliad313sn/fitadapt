import { randomUUID } from 'node:crypto';
import type { AuthResponse, DeviceInfo, FederatedSignIn, Locale, TokenPair, User } from '@fitadapt/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { authValue } from '../config/auth.config.js';
import type { Database } from '../db/client.js';
import { authSessions, devices, otpCodes, refreshTokens, users } from '../db/schema.js';
import { generateOtp, generateRefreshToken, keyedHash, safeEqual } from './crypto.js';
import { authErrors } from './errors.js';
import type { IdentityProviderVerifier } from './identity-providers.js';
import type { Mailer } from './mailer.js';
import type { RateLimiter } from './rate-limit.js';
import type { AccessClaims, AccessTokenSigner } from './tokens.js';

export interface AuthServiceDeps {
  db: Database;
  mailer: Mailer;
  rateLimiter: RateLimiter;
  signer: AccessTokenSigner;
  identityVerifier: IdentityProviderVerifier;
  pepper: string;
  now: () => Date;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale,
    unitSystem: row.unitSystem,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Email one-time-code sign-up/sign-in with short-lived access tokens and
 * rotating refresh tokens; reuse of a rotated refresh token revokes the whole
 * family (ADR-003).
 */
export class AuthService {
  private readonly revokedListeners = new Set<(sessionId: string) => void>();

  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * API-6: called after a session is revoked (logout, refresh-token reuse), so long-lived channels
   * (the pair WebSocket) close at once on this instance; other instances re-check on a timer.
   */
  onSessionRevoked(listener: (sessionId: string) => void): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  private revoked(sessionId: string) {
    for (const listener of this.revokedListeners) listener(sessionId);
  }

  private hash(...parts: string[]): string {
    return keyedHash(this.deps.pepper, ...parts);
  }

  async requestCode(email: string, locale: Locale, clientIp: string): Promise<{ expiresInSeconds: number }> {
    const window = authValue('rateLimitWindowSeconds');
    const emailHash = this.hash('email', email);
    const [emailOk, ipOk] = await Promise.all([
      this.deps.rateLimiter.hit('otp-request-email', emailHash, authValue('otpRequestsPerEmailPerWindow'), window),
      this.deps.rateLimiter.hit('otp-request-ip', this.hash('ip', clientIp), authValue('otpRequestsPerIpPerWindow'), window),
    ]);
    if (!emailOk || !ipOk) throw authErrors.rateLimited();

    const now = this.deps.now();
    const ttl = authValue('otpTtlSeconds');
    const code = generateOtp();
    const id = randomUUID();
    await this.deps.db.transaction(async (tx) => {
      // Only the newest code is valid.
      await tx
        .update(otpCodes)
        .set({ consumedAt: now })
        .where(and(eq(otpCodes.emailHash, emailHash), isNull(otpCodes.consumedAt)));
      await tx.insert(otpCodes).values({
        id,
        emailHash,
        codeHash: this.hash('otp', id, code),
        locale,
        expiresAt: addSeconds(now, ttl),
        createdAt: now,
      });
    });
    await this.deps.mailer.sendOneTimeCode({ to: email, code, locale, expiresInSeconds: ttl });
    return { expiresInSeconds: ttl };
  }

  async verifyCode(email: string, code: string, device: DeviceInfo): Promise<AuthResponse> {
    const emailHash = this.hash('email', email);
    const allowed = await this.deps.rateLimiter.hit(
      'otp-verify-email',
      emailHash,
      authValue('otpVerifyPerEmailPerWindow'),
      authValue('rateLimitWindowSeconds'),
    );
    if (!allowed) throw authErrors.rateLimited();

    const now = this.deps.now();
    const otp = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(otpCodes)
        .where(and(eq(otpCodes.emailHash, emailHash), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, now)))
        .orderBy(desc(otpCodes.createdAt))
        .limit(1)
        .for('update');
      if (!row) return null;
      const attempts = row.attempts + 1;
      const matches = safeEqual(row.codeHash, this.hash('otp', row.id, code));
      const exhausted = attempts >= authValue('otpMaxVerifyAttempts');
      await tx
        .update(otpCodes)
        .set({ attempts, consumedAt: matches || exhausted ? now : null })
        .where(eq(otpCodes.id, row.id));
      return matches ? row : null;
    });
    if (!otp) throw authErrors.invalidCode();

    return this.deps.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      let user = existing;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ id: randomUUID(), email, locale: otp.locale, createdAt: now })
          .onConflictDoNothing({ target: users.email })
          .returning();
        // A concurrent sign-up for the same email won the race: use its row.
        user ??= (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
      }
      if (!user) throw authErrors.invalidCode();
      const tokens = await this.startSession(tx, user.id, device, now);
      return { user: toUser(user), isNewUser: !existing, tokens };
    });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = this.deps.now();
    const outcome = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ token: refreshTokens, session: authSessions })
        .from(refreshTokens)
        .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
        .where(eq(refreshTokens.tokenHash, this.hash('refresh', refreshToken)))
        .limit(1)
        .for('update');
      if (!row || row.session.revokedAt) return { error: 'invalid' as const };
      if (row.token.usedAt) {
        // Reuse of a rotated token: assume theft and revoke the whole family.
        await tx
          .update(authSessions)
          .set({ revokedAt: now, revokedReason: 'refresh_token_reuse' })
          .where(eq(authSessions.id, row.session.id));
        return { error: 'reused' as const, sessionId: row.session.id };
      }
      if (row.token.expiresAt <= now) return { error: 'invalid' as const };
      await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.token.id));
      return { tokens: await this.issueTokens(tx, row.session.userId, row.session.id, row.session.deviceId, now) };
    });
    if ('error' in outcome) {
      if (outcome.error === 'reused') {
        this.revoked(outcome.sessionId);
        throw authErrors.refreshTokenReused();
      }
      throw authErrors.invalidRefreshToken();
    }
    return outcome.tokens;
  }

  /** Ends the session (token family) the refresh token belongs to. Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    const now = this.deps.now();
    const [row] = await this.deps.db
      .select({ sessionId: refreshTokens.sessionId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.hash('refresh', refreshToken)))
      .limit(1);
    if (!row) throw authErrors.invalidRefreshToken();
    await this.deps.db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: 'logout' })
      .where(and(eq(authSessions.id, row.sessionId), isNull(authSessions.revokedAt)));
    this.revoked(row.sessionId);
  }

  async signInWithProvider(request: FederatedSignIn): Promise<AuthResponse> {
    // Throws "provider not configured" until real verifiers exist (ADR-003).
    await this.deps.identityVerifier.verify(request.provider, request.idToken);
    throw authErrors.providerNotConfigured();
  }

  /** Validates an access token and checks its session is still active (logout takes effect at once). */
  async authenticate(accessToken: string): Promise<AccessClaims> {
    const claims = await this.deps.signer.verify(accessToken);
    if (!claims) throw authErrors.unauthorized();
    const [session] = await this.deps.db
      .select({ revokedAt: authSessions.revokedAt, userId: authSessions.userId })
      .from(authSessions)
      .where(eq(authSessions.id, claims.sessionId))
      .limit(1);
    if (!session || session.revokedAt || session.userId !== claims.userId) throw authErrors.unauthorized();
    return claims;
  }

  async getUser(userId: string): Promise<User> {
    const [row] = await this.deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw authErrors.unauthorized();
    return toUser(row);
  }

  private async startSession(tx: Tx, userId: string, device: DeviceInfo, now: Date): Promise<TokenPair> {
    await tx
      .insert(devices)
      .values({ userId, id: device.id, platform: device.platform, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: [devices.userId, devices.id], set: { lastSeenAt: now, platform: device.platform } });
    const sessionId = randomUUID();
    await tx.insert(authSessions).values({ id: sessionId, userId, deviceId: device.id, createdAt: now });
    return this.issueTokens(tx, userId, sessionId, device.id, now);
  }

  private async issueTokens(tx: Tx, userId: string, sessionId: string, deviceId: string, now: Date): Promise<TokenPair> {
    const refreshToken = generateRefreshToken();
    const refreshTtl = authValue('refreshTokenTtlSeconds');
    await tx.insert(refreshTokens).values({
      id: randomUUID(),
      sessionId,
      tokenHash: this.hash('refresh', refreshToken),
      createdAt: now,
      expiresAt: addSeconds(now, refreshTtl),
    });
    return {
      tokenType: 'Bearer',
      accessToken: await this.deps.signer.sign({ userId, sessionId, deviceId }),
      accessTokenExpiresInSeconds: authValue('accessTokenTtlSeconds'),
      refreshToken,
      refreshTokenExpiresInSeconds: refreshTtl,
    };
  }
}
