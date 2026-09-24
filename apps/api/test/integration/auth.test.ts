import type { AuthResponse, TokenPair } from '@fitadapt/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, device, requestCode, signIn, truncateAll, uniqueEmail, verify, type Harness } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h);
  h.mailer.sent.length = 0;
});

const refresh = (token: string) => h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: token } });
const me = (accessToken: string) => h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(accessToken) });

describe('one-time-code sign-up', () => {
  it('creates the account on first verification and returns tokens', async () => {
    const email = uniqueEmail();
    const req = await requestCode(h, `  ${email.toUpperCase()} `, 'en');
    expect(req.statusCode).toBe(202);
    expect(req.json()).toEqual({ status: 'sent', expiresInSeconds: 600 });

    // The code reaches the user only through the mailer.
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]).toMatchObject({ to: email, locale: 'en', expiresInSeconds: 600 });
    const code = h.mailer.lastCodeFor(email)!;
    expect(code).toMatch(/^\d{6}$/);

    const res = await verify(h, email, code);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AuthResponse;
    expect(body.isNewUser).toBe(true);
    expect(body.user).toMatchObject({ email, locale: 'en', unitSystem: 'metric' });
    expect(body.tokens).toMatchObject({ tokenType: 'Bearer', accessTokenExpiresInSeconds: 900, refreshTokenExpiresInSeconds: 2_592_000 });

    const profile = await me(body.tokens.accessToken);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual({ user: body.user });
  });

  it('a code works once only', async () => {
    const email = uniqueEmail();
    await requestCode(h, email);
    const code = h.mailer.lastCodeFor(email)!;
    expect((await verify(h, email, code)).statusCode).toBe(200);
    const again = await verify(h, email, code);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: { code: 'auth.invalid_code' } });
  });
});

describe('one-time-code sign-in', () => {
  it('signs an existing user in without creating a new account', async () => {
    const email = uniqueEmail();
    const first = await signIn(h, email);
    const second = await signIn(h, email, device('android'));
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.tokens.refreshToken).not.toBe(first.tokens.refreshToken);
    // Both device sessions are valid independently.
    expect((await me(first.tokens.accessToken)).statusCode).toBe(200);
    expect((await me(second.tokens.accessToken)).statusCode).toBe(200);
  });

  it('rejects a wrong code and locks the code after too many attempts', async () => {
    const email = uniqueEmail();
    await requestCode(h, email);
    const code = h.mailer.lastCodeFor(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const res = await verify(h, email, wrong);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: { code: 'auth.invalid_code' } });
    }
    expect((await verify(h, email, wrong)).statusCode).toBe(400); // 5th attempt exhausts the code
    expect((await verify(h, email, code)).statusCode).toBe(400); // even the right code is now dead
  });

  it('rejects an expired code', async () => {
    const email = uniqueEmail();
    await requestCode(h, email);
    const code = h.mailer.lastCodeFor(email)!;
    h.clock.advance(601);
    expect((await verify(h, email, code)).statusCode).toBe(400);
  });

  it('only the newest code is valid', async () => {
    const email = uniqueEmail();
    await requestCode(h, email);
    const oldCode = h.mailer.lastCodeFor(email)!;
    await requestCode(h, email);
    const newCode = h.mailer.lastCodeFor(email)!;
    if (oldCode !== newCode) expect((await verify(h, email, oldCode)).statusCode).toBe(400);
    expect((await verify(h, email, newCode)).statusCode).toBe(200);
  });

  it('rate-limits code requests per email', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) expect((await requestCode(h, email)).statusCode).toBe(202);
    const limited = await requestCode(h, email);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: 'auth.rate_limited' } });
  });

  it('rate-limits verification attempts per email', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 10; i++) await verify(h, email, '123456');
    expect((await verify(h, email, '123456')).statusCode).toBe(429);
  });

  it('rejects malformed input without echoing it', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { email: 'nope', code: '12' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'validation_error' } });
    const bad = await h.app.inject({ method: 'POST', url: '/v1/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: { code: 'bad_request' } });
  });
});

describe('refresh-token rotation', () => {
  it('rotates the refresh token and rejects reuse of an old one, revoking the family', async () => {
    const { tokens } = await signIn(h, uniqueEmail());

    const rotated = await refresh(tokens.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const next = (rotated.json() as { tokens: TokenPair }).tokens;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await me(next.accessToken)).statusCode).toBe(200);

    // Reusing the old (rotated) refresh token is rejected ...
    const reuse = await refresh(tokens.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toEqual({ error: { code: 'auth.refresh_token_reused' } });

    // ... and revokes the whole family: the newest tokens stop working too.
    const afterReuse = await refresh(next.refreshToken);
    expect(afterReuse.statusCode).toBe(401);
    expect(afterReuse.json()).toEqual({ error: { code: 'auth.invalid_refresh_token' } });
    expect((await me(next.accessToken)).statusCode).toBe(401);
  });

  it('chains several rotations', async () => {
    let { tokens } = await signIn(h, uniqueEmail());
    for (let i = 0; i < 3; i++) {
      const res = await refresh(tokens.refreshToken);
      expect(res.statusCode).toBe(200);
      tokens = (res.json() as { tokens: TokenPair }).tokens;
    }
    expect((await me(tokens.accessToken)).statusCode).toBe(200);
  });

  it('rejects unknown and expired refresh tokens', async () => {
    expect((await refresh('not-a-real-token')).json()).toEqual({ error: { code: 'auth.invalid_refresh_token' } });
    const { tokens } = await signIn(h, uniqueEmail());
    h.clock.advance(2_592_001);
    expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
  });

  it('access tokens are short-lived', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    h.clock.advance(901);
    expect((await me(tokens.accessToken)).statusCode).toBe(401);
  });
});

describe('logout', () => {
  it('ends the session: refresh and access tokens stop working', async () => {
    const other = await signIn(h, uniqueEmail());
    const { tokens } = await signIn(h, uniqueEmail());
    const out = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: tokens.refreshToken } });
    expect(out.statusCode).toBe(204);
    expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
    expect((await me(tokens.accessToken)).statusCode).toBe(401);
    // Idempotent, and other sessions are unaffected.
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: tokens.refreshToken } })).statusCode).toBe(204);
    expect((await me(other.tokens.accessToken)).statusCode).toBe(200);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: 'unknown' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('access control and stubs', () => {
  it('requires a valid bearer token', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Basic abc' } })).statusCode).toBe(401);
    expect((await me('not.a.jwt')).json()).toEqual({ error: { code: 'auth.unauthorized' } });
  });

  it('Sign in with Apple/Google is stubbed and answers 501', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/federated',
      payload: { provider: 'apple', idToken: 'x', device: device() },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: { code: 'auth.provider_not_configured' } });
  });

  it('serves health and an OpenAPI document', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    const doc = (await h.app.inject({ method: 'GET', url: '/docs/openapi.json' })).json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/v1/analytics/events',
      '/v1/auth/federated',
      '/v1/auth/logout',
      '/v1/auth/otp/request',
      '/v1/auth/otp/verify',
      '/v1/auth/refresh',
      '/v1/legal/acceptances',
      '/v1/legal/documents/{documentId}',
      '/v1/legal/notices',
      '/v1/legal/status',
      '/v1/me',
      // M09: multi-device Fair Pair (the session itself runs over the WebSocket, not in OpenAPI).
      '/v1/pair/sessions',
      '/v1/pair/sessions/join',
      // M04: the end-to-end-encrypted progress-photo backup.
      '/v1/photos/backup',
      '/v1/photos/backup/key',
      '/v1/photos/backup/photos',
      '/v1/photos/backup/photos/{photoId}',
      '/v1/privacy/consents',
      '/v1/privacy/deletion',
      '/v1/privacy/export',
      // MOB-08: the S3 intensity lock that outlives a health-consent withdrawal (ADR-027).
      '/v1/safety/intensity-lock',
      '/v1/sync/pull',
      '/v1/sync/push',
    ]);
  });
});

describe('logging hygiene', () => {
  it('never logs the one-time code, email, tokens or IP', async () => {
    h.logs.length = 0;
    const email = uniqueEmail();
    const { tokens } = await signIn(h, email);
    await refresh(tokens.refreshToken);
    await me(tokens.accessToken);
    const code = h.mailer.lastCodeFor(email)!;
    const output = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(0);
    expect(output).toContain('/v1/auth/otp/verify');
    for (const secret of [email, tokens.refreshToken, tokens.accessToken, '127.0.0.1']) {
      expect(output).not.toContain(secret);
    }
    // The code is six digits: check it never appears as a JSON value or quoted string.
    expect(output).not.toMatch(new RegExp(`["':]\\s*"?${code}"?`));
  });
});
