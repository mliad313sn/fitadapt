import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  MemoryDefensibilityLog,
  buildLegalHoldExport,
  chainEvent,
  isCanonicalTimestamp,
  parsePayload,
  verifyChain,
  type DefensibilityEvent,
} from './index.js';

// Regression tests for the packages/tooling review (PKG-01, PKG-10, PKG-11).

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

function chainOf(length: number) {
  const log = new MemoryDefensibilityLog(ids());
  for (let i = 0; i < length; i++) {
    log.append({ type: 'consent.recorded', chain: 'subject-1', occurredAt: `2026-09-23T10:${String(i % 60).padStart(2, '0')}:00.000Z`, payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'fr', jurisdiction: 'FR' } });
  }
  log.append({ type: 'safety.event', chain: 'subject-1', occurredAt: '2026-09-23T11:00:00.000Z', payload: { invariant: 'S3', reasonCode: 'safety.s3.red_flag', action: 'session_ended', engineVersion: '1.0.0' } });
  return log;
}

describe('PKG-01: truncation is detected against the anchored head', () => {
  it('a tail-truncated or fully deleted chain fails against its head; the full chain passes', () => {
    const log = chainOf(2);
    const events = log.events('subject-1');
    const head = log.head('subject-1')!;
    expect(head).toEqual({ length: 3, head: events[2]!.hash });
    expect(verifyChain(events, head)).toEqual({ ok: true, length: 3, head: head.head });
    // Without the anchor a prefix still verifies: that is why the anchor is required.
    expect(verifyChain(events.slice(0, 2)).ok).toBe(true);
    expect(verifyChain(events.slice(0, 2), head)).toEqual({ ok: false, brokenAt: 2, reason: 'truncated' });
    expect(verifyChain([], head)).toEqual({ ok: false, brokenAt: 0, reason: 'truncated' });
  });

  it('a head that disagrees with the last hash, or extra events, fail with head_mismatch', () => {
    const log = chainOf(2);
    const events = log.events('subject-1');
    expect(verifyChain(events, { length: 3, head: GENESIS_HASH })).toEqual({ ok: false, brokenAt: 2, reason: 'head_mismatch' });
    expect(verifyChain(events, { length: 2, head: events[1]!.hash })).toEqual({ ok: false, brokenAt: 1, reason: 'head_mismatch' });
  });

  it('MemoryDefensibilityLog.verify compares against its own head; an unknown chain is empty and ok', () => {
    const log = chainOf(1);
    expect(log.verify('subject-1')).toMatchObject({ ok: true, length: 2 });
    expect(log.verify('nobody')).toEqual({ ok: true, length: 0, head: GENESIS_HASH });
    expect(log.head('nobody')).toBeUndefined();
  });

  it('the legal-hold export verifies against the anchored head and carries it', () => {
    const log = chainOf(2);
    const events = log.events('subject-1');
    const head = log.head('subject-1')!;
    const truncated = buildLegalHoldExport('subject-1', events.slice(0, 1), '2026-09-24T00:00:00.000Z', head);
    expect(truncated.integrity).toEqual({ ok: false, brokenAt: 1, reason: 'truncated' });
    expect(truncated.anchoredHead).toEqual(head);
    expect(buildLegalHoldExport('subject-1', events, '2026-09-24T00:00:00.000Z', head).integrity.ok).toBe(true);
    expect(buildLegalHoldExport('subject-1', events, '2026-09-24T00:00:00.000Z').anchoredHead).toBeUndefined();
  });

  it('property: every strict prefix of a chain fails against the full head', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.nat(), (n, cut) => {
        const log = chainOf(n);
        const events = log.events('subject-1');
        const keep = cut % events.length;
        const r = verifyChain(events.slice(0, keep), log.head('subject-1'));
        return !r.ok && r.reason === 'truncated' && r.brokenAt === keep;
      }),
      { numRuns: 60 },
    );
  });
});

describe('PKG-10: prototype keys are unknown event types, never a crash', () => {
  it('verifyChain reports invalid_payload for constructor / toString / __proto__', () => {
    const [first] = chainOf(0).events('subject-1');
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const bad = { ...first!, type } as unknown as DefensibilityEvent;
      expect(verifyChain([bad])).toEqual({ ok: false, brokenAt: 0, reason: 'invalid_payload' });
    }
  });

  it('parsePayload throws the unknown-type error, not a TypeError', () => {
    expect(() => parsePayload('toString' as never, {})).toThrow(/unknown defensibility event type/);
    expect(() => parsePayload('constructor' as never, {})).toThrow(/unknown defensibility event type/);
  });
});

describe('PKG-11: occurredAt must be canonical ISO 8601 UTC', () => {
  const input = (occurredAt: string) => ({ type: 'pair.partner_left' as const, chain: 'x', occurredAt, payload: { pairSessionId: '00000000-0000-4000-8000-000000000001' } });
  it('chainEvent refuses non-canonical timestamps', () => {
    for (const bad of ['Sep 23 2026', '2026-09-23', '2026-09-23T10:00:00+02:00', '2026-09-23T10:00:00.000', '2026-02-30T10:00:00.000Z', '2026-09-23 10:00:00Z', ' 2026-09-23T10:00:00.000Z']) {
      expect(() => chainEvent(undefined, input(bad), '00000000-0000-4000-8000-000000000009'), bad).toThrow(/ISO 8601 UTC/);
    }
    expect(chainEvent(undefined, input('2026-09-23T10:00:00Z'), '00000000-0000-4000-8000-000000000009').occurredAt).toBe('2026-09-23T10:00:00Z');
  });

  it('verifyChain reports invalid_timestamp for a stored non-canonical timestamp', () => {
    const [first] = chainOf(0).events('subject-1');
    expect(verifyChain([{ ...first!, occurredAt: 'Sep 23 2026' }])).toEqual({ ok: false, brokenAt: 0, reason: 'invalid_timestamp' });
  });

  it('property: every toISOString() is canonical', () => {
    fc.assert(fc.property(fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('9999-12-31T23:59:59Z'), noInvalidDate: true }), (d) => isCanonicalTimestamp(d.toISOString())));
    expect(isCanonicalTimestamp(42)).toBe(false);
  });
});
