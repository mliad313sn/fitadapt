import { describe, expect, it } from 'vitest';
import {
  AuthResponseSchema,
  ConfigValueSchema,
  EmailSchema,
  ErrorResponseSchema,
  OtpVerifySchema,
  PullRequestSchema,
  PushRequestSchema,
  MAX_MUTATIONS_PER_PUSH,
  OutboxItemSchema,
  defineConfig,
  unvalidatedKeys,
} from './index.js';

const uuid = '0b9c4c1e-3f7e-4f59-9a43-2d1c3a1e8f10';
const now = '2026-09-23T10:00:00.000Z';

describe('EmailSchema', () => {
  it('normalises case and whitespace', () => {
    expect(EmailSchema.parse('  Test.User@Example.ORG ')).toBe('test.user@example.org');
  });
  it('rejects invalid emails', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('auth schemas', () => {
  it('accepts a six-digit code only', () => {
    const base = { email: 'a@example.org', device: { id: uuid, platform: 'ios' } };
    expect(OtpVerifySchema.safeParse({ ...base, code: '123456' }).success).toBe(true);
    expect(OtpVerifySchema.safeParse({ ...base, code: '12345' }).success).toBe(false);
    expect(OtpVerifySchema.safeParse({ ...base, code: '12a456' }).success).toBe(false);
  });
  it('parses an auth response', () => {
    const parsed = AuthResponseSchema.parse({
      user: { id: uuid, email: 'a@example.org', locale: 'fr', unitSystem: 'metric', createdAt: now },
      isNewUser: true,
      tokens: {
        tokenType: 'Bearer',
        accessToken: 'a',
        accessTokenExpiresInSeconds: 900,
        refreshToken: 'r',
        refreshTokenExpiresInSeconds: 3600,
      },
    });
    expect(parsed.isNewUser).toBe(true);
  });
  it('parses error responses', () => {
    expect(ErrorResponseSchema.parse({ error: { code: 'auth.invalid_code' } }).error.code).toBe('auth.invalid_code');
  });
});

describe('sync schemas', () => {
  const mutation = {
    mutationId: uuid,
    collection: 'set_logs',
    recordId: uuid,
    op: 'insert',
    baseRevision: null,
    data: { reps: 8 },
    clientCreatedAt: now,
  };
  it('limits push batch size', () => {
    expect(PushRequestSchema.safeParse({ deviceId: uuid, mutations: [mutation] }).success).toBe(true);
    const tooMany = Array.from({ length: MAX_MUTATIONS_PER_PUSH + 1 }, () => mutation);
    expect(PushRequestSchema.safeParse({ deviceId: uuid, mutations: tooMany }).success).toBe(false);
  });
  it('rejects invalid collection names', () => {
    expect(
      PushRequestSchema.safeParse({ deviceId: uuid, mutations: [{ ...mutation, collection: 'Drop Table' }] }).success,
    ).toBe(false);
  });
  it('defaults the pull limit', () => {
    expect(PullRequestSchema.parse({ deviceId: uuid, since: 0 }).limit).toBe(500);
  });
  it('parses outbox items', () => {
    const item = OutboxItemSchema.parse({ id: uuid, mutation, status: 'pending', attempts: 0, createdAt: now, lastError: null });
    expect(item.status).toBe('pending');
  });
});

describe('config values', () => {
  it('requires validatedBy and signOff when validated', () => {
    expect(ConfigValueSchema.safeParse({ value: 1, source: 'x', validated: true }).success).toBe(false);
    expect(
      ConfigValueSchema.safeParse({ value: 1, source: 'x', validated: true, validatedBy: 'A3', signOff: 'f.md' }).success,
    ).toBe(true);
  });
  it('defineConfig validates and unvalidatedKeys lists pending items', () => {
    const cfg = defineConfig({
      b: { value: 2, source: 'ADR', validated: false },
      a: { value: 1, source: 'ADR', validated: false },
      c: { value: 3, source: 'ADR', validated: true, validatedBy: 'A3', signOff: 'rec.md' },
    });
    expect(unvalidatedKeys(cfg)).toEqual(['a', 'b']);
    expect(() => defineConfig({ x: { value: 1, source: '', validated: false } })).toThrow(/Invalid config value "x"/);
  });
});
