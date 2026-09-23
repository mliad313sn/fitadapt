import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { authConfig, authValue } from '../../src/config/auth.config.js';
import { loadEnv } from '../../src/config/env.js';
import { generateOtp, generateRefreshToken, keyedHash, safeEqual } from '../../src/auth/crypto.js';
import { ApiError, authErrors } from '../../src/auth/errors.js';
import { NotConfiguredIdentityVerifier } from '../../src/auth/identity-providers.js';
import { MemoryMailer } from '../../src/auth/mailer.js';
import { AccessTokenSigner } from '../../src/auth/tokens.js';
import { applyLoggingHygiene, loggerOptions, REDACT_PATHS } from '../../src/observability/logger.js';
import { initErrorReporting, noopReporter, scrubEvent } from '../../src/observability/sentry.js';
import { registerTracing } from '../../src/observability/tracing.js';
import { unvalidatedKeys } from '@fitadapt/shared';
import { Writable } from 'node:stream';

const ids = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
};
const secret = 'unit-test-secret-unit-test-secret-000';

describe('crypto helpers', () => {
  it('generates six-digit codes with leading zeros kept', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('generates distinct URL-safe refresh tokens', () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
  });
  it('keyed hashes depend on pepper and part boundaries', () => {
    expect(keyedHash('p', 'a', 'b')).toBe(keyedHash('p', 'a', 'b'));
    expect(keyedHash('p', 'ab')).not.toBe(keyedHash('p', 'a', 'b'));
    expect(keyedHash('q', 'a')).not.toBe(keyedHash('p', 'a'));
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips claims and expires after the TTL', async () => {
    let t = Date.UTC(2026, 8, 23);
    const signer = new AccessTokenSigner(secret, 900, () => new Date(t));
    const token = await signer.sign(ids);
    expect(await signer.verify(token)).toEqual(ids);
    t += 901_000;
    expect(await signer.verify(token)).toBeNull();
  });
  it('rejects tokens signed with another key or tampered', async () => {
    const now = () => new Date();
    const token = await new AccessTokenSigner(secret, 900, now).sign(ids);
    expect(await new AccessTokenSigner(`${secret}x`, 900, now).verify(token)).toBeNull();
    expect(await new AccessTokenSigner(secret, 900, now).verify(`${token}x`)).toBeNull();
  });
});

describe('errors, mailer and identity providers', () => {
  it('maps auth errors to status codes and stable codes', () => {
    expect(authErrors.invalidCode()).toMatchObject({ statusCode: 400, code: 'auth.invalid_code' });
    expect(authErrors.rateLimited()).toMatchObject({ statusCode: 429 });
    expect(authErrors.refreshTokenReused()).toMatchObject({ statusCode: 401, code: 'auth.refresh_token_reused' });
    expect(authErrors.providerNotConfigured()).toBeInstanceOf(ApiError);
  });
  it('memory mailer captures the latest code per address', async () => {
    const mailer = new MemoryMailer();
    await mailer.sendOneTimeCode({ to: 'a@example.test', code: '111111', locale: 'fr', expiresInSeconds: 600 });
    await mailer.sendOneTimeCode({ to: 'a@example.test', code: '222222', locale: 'fr', expiresInSeconds: 600 });
    expect(mailer.lastCodeFor('a@example.test')).toBe('222222');
    expect(mailer.lastCodeFor('b@example.test')).toBeUndefined();
  });
  it('federated sign-in is not configured', async () => {
    await expect(new NotConfiguredIdentityVerifier().verify()).rejects.toMatchObject({ statusCode: 501 });
  });
});

describe('configuration', () => {
  const valid = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'x'.repeat(32),
    AUTH_TOKEN_PEPPER: 'y'.repeat(32),
    SENTRY_DSN: '',
  };
  it('parses the environment with defaults', () => {
    expect(loadEnv(valid)).toMatchObject({ API_PORT: 3000, NODE_ENV: 'development', SENTRY_DSN: undefined });
  });
  it('names invalid fields without echoing values', () => {
    expect(() => loadEnv({ ...valid, AUTH_JWT_SECRET: 'short-secret-value' })).toThrow('Invalid environment: AUTH_JWT_SECRET');
    try {
      loadEnv({ ...valid, AUTH_JWT_SECRET: 'short-secret-value' });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });
  it('refuses the public .env.example secrets in production, and allows them in development', () => {
    const example = {
      ...valid,
      AUTH_JWT_SECRET: 'dev-only-change-me-dev-only-change-me-0000',
      AUTH_TOKEN_PEPPER: 'dev-only-pepper-change-me-0000000000000',
    };
    expect(() => loadEnv({ ...example, NODE_ENV: 'production' })).toThrow(
      'Invalid environment: AUTH_JWT_SECRET, AUTH_TOKEN_PEPPER',
    );
    expect(loadEnv(example).NODE_ENV).toBe('development');
    expect(loadEnv({ ...valid, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });
  it('auth thresholds carry a source and are listed as unvalidated', () => {
    expect(authValue('accessTokenTtlSeconds')).toBe(900);
    expect(Object.values(authConfig).every((v) => v.source.includes('ADR-003'))).toBe(true);
    expect(unvalidatedKeys(authConfig)).toHaveLength(8);
  });
});

describe('observability', () => {
  it('redacts personal data and secrets from explicit logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) });
    const app = Fastify({ logger: loggerOptions('info', stream) });
    app.log.info({ email: 'a@example.test', code: '123456', user: { email: 'b@example.test', refreshToken: 'r' }, data: { weightKg: 80 } }, 'event');
    await app.close();
    const out = lines.join('');
    for (const leaked of ['a@example.test', 'b@example.test', '123456', '"r"', 'weightKg']) expect(out).not.toContain(leaked);
    expect(out).toContain('[redacted]');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('request logs keep route and status only', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) });
    const app = Fastify({ logger: loggerOptions('info', stream) });
    applyLoggingHygiene(app);
    registerTracing(app);
    app.get('/things/:id', async () => ({ ok: true }));
    app.get('/boom', async () => {
      throw new Error('x');
    });
    await app.inject({ method: 'GET', url: '/things/42?email=a@example.test', headers: { authorization: 'Bearer secret' } });
    await app.inject({ method: 'GET', url: '/boom' });
    const missing = await app.inject({ method: 'GET', url: '/missing?email=a@example.test' });
    expect(missing.json()).toEqual({ error: { code: 'not_found' } });
    await app.close();
    const out = lines.join('');
    expect(out).toContain('/things/:id');
    expect(out).not.toContain('a@example.test');
    expect(out).not.toContain('Bearer secret');
    expect(out).not.toContain('127.0.0.1');
  });

  it('error reporting is a no-op without a DSN and scrubs events', async () => {
    expect(await initErrorReporting(undefined, 'test')).toBe(noopReporter);
    expect(() => noopReporter.capture(new Error('x'))).not.toThrow();
    expect(scrubEvent({ message: 'm', request: { url: 'u' }, user: { email: 'e' }, breadcrumbs: [], extra: { a: 1 } })).toEqual({ message: 'm' });
  });

  it('with a DSN, initialises the SDK with scrubbing and no PII', async () => {
    const init = vi.fn();
    const captureException = vi.fn();
    const reporter = await initErrorReporting('https://key@example.test/1', 'test', async () => ({ init, captureException }));
    const options = init.mock.calls[0]![0] as Record<string, unknown> & { beforeSend: (e: object) => object; beforeSendTransaction: (e: object) => object };
    expect(options).toMatchObject({ dsn: 'https://key@example.test/1', sendDefaultPii: false, dataCollection: { userInfo: false, httpBodies: [] } });
    expect(options.beforeSend({ message: 'm', user: { id: 1 } })).toEqual({ message: 'm' });
    expect(options.beforeSendTransaction({ transaction: 't', request: {} })).toEqual({ transaction: 't' });
    reporter.capture(new Error('x'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('with a DSN but no SDK installed, warns and stays a no-op', async () => {
    const warn = vi.fn();
    const reporter = await initErrorReporting('https://key@example.test/1', 'test', async () => Promise.reject(new Error('missing')), warn);
    expect(reporter).toBe(noopReporter);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not installed'));
  });
});
