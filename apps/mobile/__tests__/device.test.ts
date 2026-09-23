import { drizzle } from 'drizzle-orm/sql-js';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { createDeviceSyncClient } from '../src/sync/device';
import { installErrorReporter, reportError } from '../src/observability';

describe('createDeviceSyncClient', () => {
  it('persists the device id in the local database', async () => {
    const SQL = await initSqlJs();
    const db = drizzle(new SQL.Database());
    const a = createDeviceSyncClient({ openDatabase: () => db, randomUUID });
    const b = createDeviceSyncClient({ openDatabase: () => db, randomUUID });
    expect(a.deviceId).toBe(b.deviceId);
  });

  it('keeps writes in the outbox while not signed in', async () => {
    const SQL = await initSqlJs();
    const client = createDeviceSyncClient({ openDatabase: () => drizzle(new SQL.Database()), randomUUID });
    client.insert('set_logs', { demo: true });
    const result = await client.sync();
    expect(result.push.offline).toBe(true);
    expect(client.pendingCount()).toBe(1);
  });
});

describe('observability', () => {
  it('is a no-op until a reporter is installed', () => {
    expect(() => reportError(new Error('x'), { area: 'ui' })).not.toThrow();
    const reporter = jest.fn();
    installErrorReporter(reporter);
    reportError('boom', { area: 'sync' });
    expect(reporter).toHaveBeenCalledWith('boom', { area: 'sync' });
    installErrorReporter(null);
  });
});
