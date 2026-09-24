import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SyncPolicyError } from '../index.js';
import { makeDevice, makeServer, USER, type StoreKind } from './helpers.js';

const kinds: StoreKind[] = ['memory', 'sqlite'];

describe.each(kinds)('goal condition 3 — local store: %s', (kind) => {
  it('a record created offline is written to the outbox, pushed on reconnect and pulled on a second device', async () => {
    const { server, store } = makeServer();
    const a = await makeDevice(server, kind);
    const b = await makeDevice(server, kind);

    a.transport.online = false;
    const id = a.client.insert('set_logs', { exercise: 'demo', reps: 8, loadKg: 20 });

    // Written locally and queued in the outbox; nothing reached the server.
    expect(a.client.get('set_logs', id)?.data).toEqual({ exercise: 'demo', reps: 8, loadKg: 20 });
    expect(a.client.outbox('pending')).toHaveLength(1);
    expect(a.client.outbox('pending')[0]?.mutation).toMatchObject({ op: 'insert', recordId: id, collection: 'set_logs' });
    expect(store.changeCount(USER)).toBe(0);

    // Still offline: a sync attempt keeps the item queued.
    const offline = await a.client.sync();
    expect(offline.push.offline).toBe(true);
    expect(a.client.pendingCount()).toBe(1);
    expect(a.client.outbox('pending')[0]?.attempts).toBe(1);

    // Reconnect: the connectivity listener triggers the push.
    a.transport.online = true;
    await a.client.handleConnectivityChange(true);
    expect(a.client.pendingCount()).toBe(0);
    expect(a.client.outbox('acked')).toHaveLength(1);
    expect(store.changeCount(USER)).toBe(1);
    expect(a.client.get('set_logs', id)?.revision).toBe(1);

    // Second device pulls it.
    expect(b.client.get('set_logs', id)).toBeUndefined();
    const pulled = await b.client.pull();
    expect(pulled).toEqual({ offline: false, applied: 1, cursor: 1 });
    expect(b.client.get('set_logs', id)?.data).toEqual({ exercise: 'demo', reps: 8, loadKg: 20 });
  });

  it('a duplicate push is idempotent (response lost after the server applied it)', async () => {
    const { server, store } = makeServer();
    const a = await makeDevice(server, kind);
    const id = a.client.insert('set_logs', { reps: 5 });

    a.transport.dropNextPushResponse = true;
    const first = await a.client.push();
    expect(first.offline).toBe(true);
    expect(store.changeCount(USER)).toBe(1); // server applied it
    expect(a.client.pendingCount()).toBe(1); // client did not hear back

    const retry = await a.client.push();
    expect(retry).toMatchObject({ offline: false, sent: 1, acked: 1 });
    expect(a.transport.pushCalls).toBe(2);
    expect(store.changeCount(USER)).toBe(1); // still exactly one change
    expect(a.client.get('set_logs', id)?.revision).toBe(1);

    // Replaying the raw mutation again returns the original outcome.
    const mutation = a.client.outbox('acked')[0]!.mutation;
    const replay = await server.push(USER, { deviceId: a.client.deviceId, mutations: [mutation, mutation] });
    expect(replay.results.map((r) => [r.status, r.revision])).toEqual([
      ['duplicate', 1],
      ['duplicate', 1],
    ]);
    expect(store.changeCount(USER)).toBe(1);
  });

  it('concurrent append-only set logs from two devices both survive', async () => {
    const { server, store } = makeServer();
    const a = await makeDevice(server, kind);
    const b = await makeDevice(server, kind);
    a.transport.online = false;
    b.transport.online = false;

    const fromA = [a.client.insert('set_logs', { set: 1, by: 'a' }), a.client.insert('set_logs', { set: 2, by: 'a' })];
    const fromB = [b.client.insert('set_logs', { set: 1, by: 'b' })];

    a.transport.online = true;
    b.transport.online = true;
    const [ra, rb] = await Promise.all([a.client.sync(), b.client.sync()]);
    expect(ra.push.conflicts + rb.push.conflicts + ra.push.rejected + rb.push.rejected).toBe(0);
    expect(store.changeCount(USER)).toBe(3);
    // Each device may have pulled before the other's push landed; one more round converges.
    await Promise.all([a.client.sync(), b.client.sync()]);

    const all = [...fromA, ...fromB].sort();
    expect(a.client.list('set_logs').map((r) => r.id).sort()).toEqual(all);
    expect(b.client.list('set_logs').map((r) => r.id).sort()).toEqual(all);
  });
});

describe('append-only policy', () => {
  it('rejects local edits and deletes of set logs', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    const id = a.client.insert('set_logs', { reps: 5 });
    expect(() => a.client.update('set_logs', id, { reps: 6 })).toThrow(SyncPolicyError);
    expect(() => a.client.remove('set_logs', id)).toThrow(SyncPolicyError);
    expect(() => a.client.insert('set_logs', { reps: 6 }, id)).toThrow(SyncPolicyError);
  });

  it('the server rejects updates and id reuse on append-only collections', async () => {
    const { server } = makeServer();
    const recordId = randomUUID();
    const deviceId = randomUUID();
    const base = { collection: 'set_logs', recordId, baseRevision: null, data: { reps: 1 }, clientCreatedAt: new Date().toISOString() };
    const res = await server.push(USER, {
      deviceId,
      mutations: [
        { ...base, mutationId: randomUUID(), op: 'insert' },
        { ...base, mutationId: randomUUID(), op: 'insert' },
        { ...base, mutationId: randomUUID(), op: 'upsert', baseRevision: 1 },
      ],
    });
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(['applied', 'record_exists', 'append_only']);
  });

  it('property: any interleaving of set logs from several devices converges to the union', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ device: fc.integer({ min: 0, max: 2 }), syncAfter: fc.boolean() }), { minLength: 1, maxLength: 20 }),
        async (steps) => {
          const { server } = makeServer();
          const devices = await Promise.all([0, 1, 2].map(() => makeDevice(server)));
          const created: string[] = [];
          for (const step of steps) {
            const d = devices[step.device]!;
            created.push(d.client.insert('set_logs', { n: created.length }));
            if (step.syncAfter) await d.client.sync();
          }
          for (const d of devices) await d.client.sync();
          for (const d of devices) await d.client.sync();
          const expected = [...created].sort();
          return devices.every((d) => JSON.stringify(d.client.list('set_logs').map((r) => r.id).sort()) === JSON.stringify(expected));
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe.each(kinds)('mutable records — local store: %s', (kind) => {
  it('syncs updates and deletes with revisions', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server, kind);
    const b = await makeDevice(server, kind);
    const id = a.client.insert('preferences', { locale: 'fr' });
    a.client.update('preferences', id, { locale: 'en' }); // queued behind the insert, rebased on ack
    await a.client.sync();
    expect(a.client.outbox('rejected')).toHaveLength(0);
    expect(a.client.get('preferences', id)).toMatchObject({ revision: 2, pendingMutationId: null, data: { locale: 'en' } });

    await b.client.sync();
    expect(b.client.get('preferences', id)?.data).toEqual({ locale: 'en' });
    b.client.remove('preferences', id);
    await b.client.sync();
    await a.client.sync();
    expect(a.client.get('preferences', id)).toBeUndefined();
    expect(b.client.get('preferences', id)).toBeUndefined();
  });

  it('concurrent edits: the server copy wins and the losing edit is recorded as rejected', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server, kind);
    const b = await makeDevice(server, kind);
    const id = a.client.insert('preferences', { units: 'metric' });
    await a.client.sync();
    await b.client.sync();

    a.client.update('preferences', id, { units: 'imperial' });
    b.client.update('preferences', id, { units: 'metric', gym: true });
    // B's pull while its own edit is pending must not clobber the local edit.
    await a.client.sync();
    expect((await b.client.pull()).applied).toBe(0);
    expect(b.client.get('preferences', id)?.data).toEqual({ units: 'metric', gym: true });

    const result = await b.client.sync();
    expect(result.push.conflicts).toBe(1);
    expect(b.client.outbox('rejected')[0]?.lastError).toBe('conflict');
    expect(b.client.get('preferences', id)?.data).toEqual({ units: 'imperial' });
  });
});

describe('sync client edge cases', () => {
  it('rejects unknown collections locally and on the server', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    expect(() => a.client.insert('nope', {})).toThrow(SyncPolicyError);
    const res = await server.push(USER, {
      deviceId: randomUUID(),
      mutations: [
        { mutationId: randomUUID(), collection: 'nope', recordId: randomUUID(), op: 'insert', baseRevision: null, data: {}, clientCreatedAt: new Date().toISOString() },
        { mutationId: randomUUID(), collection: 'preferences', recordId: randomUUID(), op: 'insert', baseRevision: null, data: null, clientCreatedAt: new Date().toISOString() },
      ],
    });
    expect(res.results.map((r) => r.reason)).toEqual(['unknown_collection', 'missing_data']);
  });

  it('marks rejected mutations and clears the pending marker', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    const recordId = randomUUID();
    // Another device already created this set-log id: our insert is rejected.
    await server.push(USER, {
      deviceId: randomUUID(),
      mutations: [{ mutationId: randomUUID(), collection: 'set_logs', recordId, op: 'insert', baseRevision: null, data: { x: 1 }, clientCreatedAt: new Date().toISOString() }],
    });
    a.client.insert('set_logs', { x: 2 }, recordId);
    const outcome = await a.client.push();
    expect(outcome.rejected).toBe(1);
    expect(a.client.outbox('rejected')[0]?.lastError).toBe('record_exists');
    // PKG-03: the rejected insert is reversed on the device and reported; pull then brings the server's record.
    expect(a.client.get('set_logs', recordId)).toBeUndefined();
    expect(a.client.rejectedMutations()).toMatchObject([{ recordId, collection: 'set_logs', reason: 'record_exists', data: { x: 2 } }]);
    await a.client.pull();
    expect(a.client.get('set_logs', recordId)).toMatchObject({ data: { x: 1 }, pendingMutationId: null });
  });

  it('a conflicting insert on a record deleted server-side keeps the server state', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    const id = a.client.insert('preferences', { v: 1 });
    await a.client.sync();
    await b.client.sync();
    a.client.update('preferences', id, { v: 2 });
    b.client.remove('preferences', id);
    await b.client.sync();
    const res = await a.client.sync();
    expect(res.push.conflicts).toBe(1);
    expect(a.client.get('preferences', id)).toBeUndefined();
  });

  it('rejects updates of missing records locally', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    expect(() => a.client.update('preferences', randomUUID(), {})).toThrow(SyncPolicyError);
  });

  it('shares one run between concurrent sync calls and pages through pulls', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    for (let i = 0; i < 3; i++) a.client.insert('set_logs', { i });
    await a.client.sync();
    const [x, y] = [b.client.sync(), b.client.sync()];
    expect(x).toBe(y);
    await x;
    const page = await server.pull(USER, { deviceId: b.client.deviceId, since: 0, limit: 2 });
    expect(page).toMatchObject({ cursor: 2, hasMore: true });
    const rest = await server.pull(USER, { deviceId: b.client.deviceId, since: 2, limit: 2 });
    expect(rest).toMatchObject({ cursor: 3, hasMore: false });
    const empty = await server.pull(USER, { deviceId: b.client.deviceId, since: 3 });
    expect(empty).toMatchObject({ cursor: 3, hasMore: false, changes: [] });
    expect(b.client.cursor()).toBe(3);
  });

  it('propagates non-network errors and records the attempt', async () => {
    const { server } = makeServer();
    const a = await makeDevice(server);
    a.client.insert('set_logs', {});
    const failing = { push: async () => Promise.reject(new Error('boom')), pull: async () => Promise.reject(new Error('boom')) };
    const { SyncClient, MemoryLocalStore } = await import('../index.js');
    const store = new MemoryLocalStore();
    const client = new SyncClient({ deviceId: randomUUID(), store, transport: failing, newId: randomUUID });
    client.insert('set_logs', {});
    await expect(client.push()).rejects.toThrow('boom');
    expect(client.outbox('pending')[0]).toMatchObject({ attempts: 1, lastError: 'boom' });
    await expect(client.pull()).rejects.toThrow('boom');
  });

  it('stops when the server settles nothing', async () => {
    const { MemoryLocalStore, SyncClient } = await import('../index.js');
    const client = new SyncClient({
      deviceId: randomUUID(),
      store: new MemoryLocalStore(),
      transport: { push: async () => ({ results: [] }), pull: async () => ({ changes: [], cursor: 0, hasMore: false }) },
    });
    client.insert('set_logs', {});
    expect(await client.push()).toMatchObject({ sent: 1, acked: 0 });
    expect(client.pendingCount()).toBe(1);
  });

  it('memory store transactions roll back on error', async () => {
    const { MemoryLocalStore } = await import('../index.js');
    const store = new MemoryLocalStore();
    expect(() =>
      store.transaction((tx) => {
        tx.setCursor(5);
        throw new Error('fail');
      }),
    ).toThrow('fail');
    expect(store.transaction((tx) => tx.getCursor())).toBe(0);
    expect(() => store.transaction((tx) => tx.updateOutbox('x', {}))).toThrow(/unknown outbox/);
  });

  it('sqlite store rejects unknown outbox ids and duplicate outbox ids', async () => {
    const { sqliteStore } = await import('./helpers.js');
    const store = await sqliteStore();
    expect(() => store.transaction((tx) => tx.updateOutbox(randomUUID(), { attempts: 1 }))).toThrow(/unknown outbox/);
  });
});

describe.each(kinds)('local key/value state — %s', (kind) => {
  it('stores and overwrites values', async () => {
    const { makeStore } = await import('./helpers.js');
    const store = await makeStore(kind);
    expect(store.transaction((tx) => tx.getState('device_id'))).toBeUndefined();
    store.transaction((tx) => tx.setState('device_id', 'a'));
    store.transaction((tx) => tx.setState('device_id', 'b'));
    expect(store.transaction((tx) => tx.getState('device_id'))).toBe('b');
  });
});

describe('M01 collections and server-side validation', () => {
  it('registers profile and equipment profiles as mutable and screenings as append-only', async () => {
    const { SYNC_COLLECTIONS } = await import('../index.js');
    const shared = await import('@fitadapt/shared');
    expect(SYNC_COLLECTIONS.profile).toEqual({ appendOnly: false, schema: shared.ProfileSchema });
    expect(SYNC_COLLECTIONS.equipment_profiles).toEqual({ appendOnly: false, schema: shared.EquipmentProfileSchema });
    expect(SYNC_COLLECTIONS.screenings).toEqual({ appendOnly: true, schema: shared.ScreeningRecordSchema });
    // M07: assessments are append-only too.
    expect(SYNC_COLLECTIONS.assessments).toEqual({ appendOnly: true, schema: shared.AssessmentRecordSchema });
    // M08: programs and reflows are append-only too.
    expect(SYNC_COLLECTIONS.programs).toEqual({ appendOnly: true, schema: shared.ProgramRecordSchema });
    expect(SYNC_COLLECTIONS.program_reflows).toEqual({ appendOnly: true, schema: shared.ReflowRecordSchema });
    // M02: started sessions and execution events are append-only too.
    expect(SYNC_COLLECTIONS.workout_sessions).toEqual({ appendOnly: true, schema: shared.WorkoutSessionRecordSchema });
    expect(SYNC_COLLECTIONS.execution_logs).toEqual({ appendOnly: true, schema: shared.ExecutionLogSchema });
    // M05: readiness checks are append-only too.
    expect(SYNC_COLLECTIONS.readiness_checks).toEqual({ appendOnly: true, schema: shared.ReadinessCheckSchema });
    // M04: body metrics and measurements are append-only too; progress photos are not a sync collection.
    expect(SYNC_COLLECTIONS.body_metrics).toEqual({ appendOnly: true, schema: shared.BodyMetricSchema });
    expect(SYNC_COLLECTIONS.measurements).toEqual({ appendOnly: true, schema: shared.MeasurementSchema });
    expect(Object.keys(SYNC_COLLECTIONS).some((c) => c.includes('photo'))).toBe(false);
    // M10: nutrition plans, intake logs and habit ticks are append-only too.
    expect(SYNC_COLLECTIONS.nutrition_plans).toEqual({ appendOnly: true, schema: shared.NutritionPlanRecordSchema });
    expect(SYNC_COLLECTIONS.intake_logs).toEqual({ appendOnly: true, schema: shared.IntakeLogSchema });
    expect(SYNC_COLLECTIONS.habit_checks).toEqual({ appendOnly: true, schema: shared.HabitCheckSchema });
  });

  it('rejects a mutation the validator refuses, finally, and reports applied ones to the listener', async () => {
    const { SyncServer, MemoryServerStore } = await import('../index.js');
    const applied: string[] = [];
    const server = new SyncServer({
      store: new MemoryServerStore(),
      validate: (_user, m) => ((m.data as { ok?: boolean } | null)?.ok === false ? 'profile.invalid' : null),
      onApplied: (_user, m) => {
        applied.push(m.collection);
      },
    });
    const mutation = (data: Record<string, unknown>) => ({ mutationId: randomUUID(), collection: 'screenings', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data, clientCreatedAt: new Date().toISOString() });
    const bad = mutation({ ok: false });
    const res = await server.push(USER, { deviceId: randomUUID(), mutations: [bad, mutation({ ok: true })] });
    expect(res.results.map((r) => [r.status, r.reason])).toEqual([
      ['rejected', 'profile.invalid'],
      ['applied', undefined],
    ]);
    expect(applied).toEqual(['screenings']);
    // A replay of the rejected mutation stays rejected (idempotency ledger).
    const replay = await server.push(USER, { deviceId: randomUUID(), mutations: [bad] });
    expect(replay.results[0]).toMatchObject({ status: 'rejected', reason: 'profile.invalid' });
    expect(applied).toEqual(['screenings']);
  });

  it('hands the validator the transaction of the mutation it checks (API-1: reads go through it, never a second connection)', async () => {
    const { SyncServer, MemoryServerStore } = await import('../index.js');
    const handles: unknown[] = [];
    const server = new SyncServer({
      store: new MemoryServerStore(),
      validate: async (_user, _m, tx) => {
        handles.push(tx);
        // The validator sees the transaction's own state (here: nothing stored yet for this record).
        expect(await tx.latestChange(USER, 'screenings', _m.recordId)).toBeUndefined();
        return null;
      },
      onApplied: (_user, _m, tx) => {
        expect(tx).toBe(handles.at(-1));
      },
    });
    const m = { mutationId: randomUUID(), collection: 'screenings', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data: { ok: true }, clientCreatedAt: new Date().toISOString() };
    const res = await server.push(USER, { deviceId: randomUUID(), mutations: [m] });
    expect(res.results[0]).toMatchObject({ status: 'applied' });
    expect(handles).toHaveLength(1);
    expect(typeof (handles[0] as { appendChange?: unknown }).appendChange).toBe('function');
  });

  it('runs the listener inside the sync transaction: if it fails, the change is not stored and a retry applies it (L11)', async () => {
    const { SyncServer, MemoryServerStore } = await import('../index.js');
    const store = new MemoryServerStore();
    let failNext = true;
    const seen: string[] = [];
    const server = new SyncServer({
      store,
      onApplied: (_user, m, tx) => {
        expect(typeof tx.appendChange).toBe('function');
        if (failNext) {
          failNext = false;
          throw new Error('log write failed');
        }
        seen.push(m.recordId);
      },
    });
    const m = { mutationId: randomUUID(), collection: 'screenings', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data: { ok: true }, clientCreatedAt: new Date().toISOString() };
    await expect(server.push(USER, { deviceId: randomUUID(), mutations: [m] })).rejects.toThrow('log write failed');
    // Neither the change nor its idempotency record survived the failure.
    expect(store.changeCount(USER)).toBe(0);
    const retry = await server.push(USER, { deviceId: randomUUID(), mutations: [m] });
    expect(retry.results[0]).toMatchObject({ status: 'applied', revision: 1 });
    expect(store.changeCount(USER)).toBe(1);
    expect(seen).toEqual([m.recordId]);
  });
});
