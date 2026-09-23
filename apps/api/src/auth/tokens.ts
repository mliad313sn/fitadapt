import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const ISSUER = 'api';
const AUDIENCE = 'app';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  deviceId: string;
}

const ClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  did: z.uuid(),
});

export class AccessTokenSigner {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly now: () => Date,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims): Promise<string> {
    const iat = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ sid: claims.sessionId, did: claims.deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.ttlSeconds)
      .sign(this.key);
  }

  /** Returns the claims, or null for any invalid, expired or tampered token. */
  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.now(),
      });
      const claims = ClaimsSchema.parse(payload);
      return { userId: claims.sub, sessionId: claims.sid, deviceId: claims.did };
    } catch {
      return null;
    }
  }
}
