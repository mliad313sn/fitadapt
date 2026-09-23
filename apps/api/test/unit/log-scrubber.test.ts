import { Writable } from 'node:stream';
import { findPersonalDataInLogLines } from '@fitadapt/privacy';
import { unvalidatedKeys } from '@fitadapt/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { privacyConfig, privacyValue } from '../../src/config/privacy.config.js';
import { applyLoggingHygiene, loggerOptions } from '../../src/observability/logger.js';

/** Fictional canaries (L12), one per category named by the M17 goal. */
const CANARY = {
  email: 'jeanne.testeur@example.test',
  name: 'Jeanne Testeur',
  weight: '82.5 kg',
  pain: 'right shoulder pain 6/10',
  freeText: 'I skipped the session because my knee felt unstable',
};

function capture() {
  const lines: string[] = [];
  const stream = new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) });
  return { lines, stream };
}

describe('log scrubber on the API logger (goal condition 3)', () => {
  it('no email, name, weight, pain report or free text reaches the log output, whatever the shape', async () => {
    const { lines, stream } = capture();
    const app = Fastify({ logger: loggerOptions('trace', stream) });
    const log = app.log;
    log.info({ user: { mail: CANARY.email, firstName: 'Jeanne', fullName: CANARY.name } }, 'profile loaded');
    log.info({ who: CANARY.name, measurement: { bodyWeight: 82.5, label: CANARY.weight } }, 'measurement');
    log.warn({ checkin: { joint: 'shoulder', painLevel: 6 }, reason: CANARY.pain }, 'check-in');
    log.info({ feedback: CANARY.freeText, context: CANARY.freeText, list: [CANARY.email, CANARY.weight] }, 'feedback');
    log.error({ err: new Error(`duplicate key (email)=(${CANARY.email})`) }, 'insert failed');
    log.error(new Error(`value ${CANARY.freeText}`));
    log.info(`code sent to ${CANARY.email}`);
    log.info('%s weighs %s', CANARY.name, CANARY.weight);
    log.info({ step: 'interpolation' }, 'said %s about %o', CANARY.freeText, { note: CANARY.pain });
    log.child({ requester: CANARY.email }).info('child logger');
    await app.close();

    const out = lines.join('');
    expect(lines.length).toBe(10);
    expect(findPersonalDataInLogLines(lines)).toEqual([]);
    for (const leaked of [...Object.values(CANARY), 'Jeanne', '82.5', 'unstable']) expect(out).not.toContain(leaked);
    // Records stay useful: messages, error types and redaction markers remain.
    expect(out).toContain('"msg":"insert failed"');
    expect(out).toContain('"type":"Error"');
    expect(out).toContain('[redacted]');
  });

  it('the detector would catch a leak: a logger without the scrubber fails the check', async () => {
    const { lines, stream } = capture();
    const unscrubbed = Fastify({ logger: { level: 'info', stream } });
    unscrubbed.log.info({ reporter: CANARY.name, detail: CANARY.freeText, bodyWeight: 82.5, report: CANARY.pain, contact: CANARY.email }, 'raw');
    await unscrubbed.close();
    const categories = new Set(findPersonalDataInLogLines(lines).map((f) => f.category));
    for (const category of ['email', 'name', 'weight', 'pain', 'free_text'] as const) expect({ category, caught: categories.has(category) }).toEqual({ category, caught: true });
  });

  it('500 responses log the error type only', async () => {
    const { lines, stream } = capture();
    const app = Fastify({ logger: loggerOptions('info', stream) });
    applyLoggingHygiene(app);
    app.get('/boom', async () => {
      throw Object.assign(new Error(`user ${CANARY.email} typed ${CANARY.freeText}`), { code: 'E_DEMO' });
    });
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    expect(findPersonalDataInLogLines(lines)).toEqual([]);
    expect(lines.join('')).not.toContain(CANARY.email);
  });
});

describe('privacy configuration', () => {
  it('every privacy threshold carries a source and awaits validation', () => {
    expect(privacyValue('hstsMaxAgeSeconds')).toBe(31_536_000);
    expect(Object.values(privacyConfig).every((v) => v.source.length > 0 && !v.validated)).toBe(true);
    expect(unvalidatedKeys(privacyConfig)).toHaveLength(Object.keys(privacyConfig).length);
  });
});
