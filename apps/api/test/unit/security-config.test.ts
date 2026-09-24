import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { dbConfig, dbValue } from '../../src/config/db.config.js';
import { loadEnv } from '../../src/config/env.js';
import { pairConfig, pairValue } from '../../src/config/pair.config.js';
import { photosConfig, photosValue } from '../../src/config/photos.config.js';
import { privacyConfig } from '../../src/config/privacy.config.js';
import { syncConfig, syncValue } from '../../src/config/sync.config.js';
import { clientAddress } from '../../src/pair/ws.js';

/** The limits added by the API security fixes (docs/status/FIX-api-security.md). */
describe('security limits live in config, unvalidated, with a source (CLAUDE.md rule 4)', () => {
  it('every new limit carries a source and validated:false', () => {
    const added = [
      ...Object.values(dbConfig),
      ...Object.values(syncConfig),
      pairConfig.joinAttemptsPerUserPerWindow,
      pairConfig.joinAttemptsPerIpPerWindow,
      pairConfig.createsPerUserPerWindow,
      pairConfig.pairRateLimitWindowSeconds,
      pairConfig.joinCodeDrawAttempts,
      pairConfig.sessionRecheckIntervalMs,
      pairConfig.maxPendingHellos,
      pairConfig.maxPendingHellosPerIp,
      pairConfig.maxQueuedMessagesPerSocket,
      pairConfig.messagesPerSocketPerWindow,
      pairConfig.socketRateWindowMs,
      photosConfig.maxBytesPerUser,
      photosConfig.uploadsPerUserPerWindow,
      photosConfig.uploadRateLimitWindowSeconds,
      privacyConfig.consentDecisionsPerWindow,
      privacyConfig.acceptancesPerWindow,
      privacyConfig.noticesPerWindow,
    ];
    for (const v of added) {
      expect(v.validated).toBe(false);
      expect(v.source).toMatch(/FIX-api-security/);
    }
    expect(dbValue('poolMax')).toBeGreaterThan(0);
    expect(pairValue('maxPendingHellosPerIp')).toBeLessThanOrEqual(pairValue('maxPendingHellos'));
    expect(photosValue('maxBytesPerUser')).toBeGreaterThanOrEqual(photosValue('maxEnvelopeBytes'));
    expect(syncValue('pushBodyLimitBytes')).toBe(1024 * 1024);
  });
});

describe('API-8: trusted proxy hops', () => {
  const valid = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'x'.repeat(40),
    AUTH_TOKEN_PEPPER: 'y'.repeat(40),
  };
  it('TRUST_PROXY_HOPS defaults to 0 (no proxy trusted) and is a small non-negative integer', () => {
    expect(loadEnv(valid).TRUST_PROXY_HOPS).toBe(0);
    expect(loadEnv({ ...valid, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    expect(() => loadEnv({ ...valid, TRUST_PROXY_HOPS: '-1' })).toThrow('TRUST_PROXY_HOPS');
    expect(() => loadEnv({ ...valid, TRUST_PROXY_HOPS: 'all' })).toThrow('TRUST_PROXY_HOPS');
  });

  it('the WebSocket client address follows the same hop rule as request.ip', () => {
    const req = (remoteAddress: string, xff?: string | string[]) => ({ socket: { remoteAddress }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as unknown as IncomingMessage;
    expect(clientAddress(req('10.0.0.1', '198.51.100.7'), 0)).toBe('10.0.0.1');
    expect(clientAddress(req('10.0.0.1', '6.6.6.6, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientAddress(req('10.0.0.1', ['6.6.6.6', '198.51.100.7, 10.0.0.2']), 2)).toBe('198.51.100.7');
    // More hops than entries: the furthest address known.
    expect(clientAddress(req('10.0.0.1'), 1)).toBe('10.0.0.1');
    expect(clientAddress(req('10.0.0.1', '198.51.100.7'), 3)).toBe('198.51.100.7');
  });
});
