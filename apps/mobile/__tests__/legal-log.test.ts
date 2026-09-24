import { verifyChain, type DefensibilityEvent } from '@fitadapt/legal';
import { randomUUID } from 'node:crypto';
import { DeviceLogIntegrityError, createLegalStore } from '../src/legal/legal-store';
import { installErrorReporter } from '../src/observability';
import { MemoryKeyValueStore } from '../src/storage/app-state';

// A small segment size so the size limit is reached in a test (the real value is in legal-log.config.ts).
jest.mock('../src/config/legal-log.config', () => ({ legalLogValue: () => 4 }));

/**
 * MOB-11: the device defensibility buffer is never silently discarded. A
 * segment that does not verify is kept aside exactly as stored, a new
 * segment records the break and the failure is reported; storage is bounded
 * per segment (a full segment is closed and kept, never rewritten).
 */
const LOG = 'defensibility_device_log';
const NOW = new Date('2026-09-24T10:00:00.000Z');
const store = (kv: MemoryKeyValueStore) => createLegalStore({ kv, newId: randomUUID, now: () => NOW, jurisdiction: 'FR' });
const events = (kv: MemoryKeyValueStore) => JSON.parse(kv.get(LOG)!) as DefensibilityEvent[];

let reported: unknown[];
beforeEach(() => {
  reported = [];
  installErrorReporter((error) => reported.push(error));
});
afterEach(() => installErrorReporter(null));

describe('MOB-11: a broken device chain is kept, never overwritten', () => {
  it('one altered event: the old segment is kept byte for byte, a new segment starts with log.segment_started, the failure is reported', () => {
    const kv = new MemoryKeyValueStore();
    const legal = store(kv);
    legal.getState().accept('terms', 'en');
    legal.getState().accept('privacy', 'en');
    const tampered = events(kv);
    tampered[0] = { ...tampered[0]!, occurredAt: '2020-01-01T00:00:00.000Z' };
    const raw = JSON.stringify(tampered);
    kv.set(LOG, raw);

    const reopened = store(kv);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(DeviceLogIntegrityError);
    expect((reported[0] as DeviceLogIntegrityError).reason).toBe('hash_mismatch');
    const [kept] = reopened.getState().archivedSegments();
    expect(kept!.stored).toBe(raw);
    expect(kept!.segment).toMatchObject({ reason: 'chain_broken', events: 2, head: null });
    const current = reopened.getState().events;
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ type: 'log.segment_started', payload: { reason: 'chain_broken', segment: 2, previousEvents: 2, previousHead: null, brokenAt: 0 } });
    // Appending continues the new segment; the kept one is never touched again.
    reopened.getState().accept('exercise_risk', 'en');
    expect(verifyChain(events(kv)).ok).toBe(true);
    expect(events(kv)).toHaveLength(2);
    expect(reopened.getState().archivedSegments()[0]!.stored).toBe(raw);
    // A third start verifies the new segment and changes nothing.
    store(kv);
    expect(reported).toHaveLength(1);
  });

  it('an unreadable value is kept as it was, too', () => {
    const kv = new MemoryKeyValueStore();
    kv.set(LOG, '{not json');
    const legal = store(kv);
    expect((reported[0] as DeviceLogIntegrityError).reason).toBe('unreadable');
    expect(legal.getState().archivedSegments()[0]!.stored).toBe('{not json');
    expect(legal.getState().events[0]).toMatchObject({ type: 'log.segment_started', payload: { reason: 'chain_broken', previousEvents: 0, brokenAt: null } });
  });
});

describe('MOB-11: storage is bounded per segment', () => {
  it('a full segment is closed and kept; the next one links to its head; every segment verifies', () => {
    const kv = new MemoryKeyValueStore();
    const legal = store(kv);
    for (let i = 0; i < 6; i += 1) legal.getState().accept(i % 2 === 0 ? 'terms' : 'privacy', 'en');
    const closed = legal.getState().archivedSegments();
    expect(closed).toHaveLength(1);
    const first = JSON.parse(closed[0]!.stored) as DefensibilityEvent[];
    expect(first).toHaveLength(4);
    expect(verifyChain(first).ok).toBe(true);
    expect(closed[0]!.segment).toMatchObject({ reason: 'size_limit', events: 4, head: first[3]!.hash });
    const current = events(kv);
    expect(current[0]).toMatchObject({ type: 'log.segment_started', payload: { reason: 'size_limit', segment: 2, previousEvents: 4, previousHead: first[3]!.hash } });
    expect(current).toHaveLength(3);
    expect(verifyChain(current).ok).toBe(true);
    expect(reported).toEqual([]);
    // The account wipe removes every segment with the rest of the ledger.
    legal.getState().clear();
    expect([...kv.data.keys()]).toEqual([]);
  });
});
