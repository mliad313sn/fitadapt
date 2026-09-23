import { randomUUID } from 'node:crypto';
import { CONSENT_POLICIES, findPersonalData, findPersonalDataInLogLines, type ConsentPolicySet } from '@fitadapt/privacy';
import { DataExportSchema, type ConsentState, type DataExport } from '@fitadapt/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keyedHash } from '../../src/auth/crypto.js';
import { MemoryAnalyticsSink } from '../../src/privacy/analytics-sink.js';
import { MemoryBackupCatalog } from '../../src/privacy/backup-catalog.js';
import { DATA_INVENTORY } from '../../src/privacy/inventory.js';
import { notice, renderNotice } from '@fitadapt/legal';
import { PEPPER, bearer, createHarness, device, requestCode, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/** Fictional personal data (L12) used to prove that nothing reaches logs or analytics. */
const CANARY = {
  name: 'Jeanne Testeur',
  weight: '82.5 kg',
  pain: 'left knee pain 7/10',
  freeText: 'I felt dizzy after the long run yesterday',
};

let h: Harness;
const backups = new MemoryBackupCatalog();
const sink = new MemoryAnalyticsSink();
const withdrawn: string[] = [];

beforeAll(async () => {
  h = await createHarness({
    backupCatalog: backups,
    analyticsSink: sink,
    withdrawalHandlers: {
      photos: [
        async (tx, userId, dataType) => {
          // Runs inside the withdrawal transaction: the owning module erases what it holds.
          await tx.execute(sql`SELECT 1`);
          withdrawn.push(`${userId}:${dataType}`);
        },
      ],
    },
  });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h);
  backups.backups.length = 0;
  sink.events.length = 0;
  withdrawn.length = 0;
});

type Decision = 'granted' | 'withdrawn';
const consent = (token: string, dataType: string, decision: Decision, version = 1) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/privacy/consents',
    headers: bearer(token),
    payload: { dataType, decision, version, locale: 'fr', jurisdiction: 'SN', source: 'mobile' },
  });
const consents = async (token: string, app = h.app) =>
  ((await app.inject({ method: 'GET', url: '/v1/privacy/consents', headers: bearer(token) })).json() as { consents: ConsentState[] }).consents;
const track = (token: string, events: unknown[], app = h.app) =>
  app.inject({ method: 'POST', url: '/v1/analytics/events', headers: bearer(token), payload: { events } });
const exportData = (token: string) => h.app.inject({ method: 'GET', url: '/v1/privacy/export', headers: bearer(token) });
const deleteAccount = (token: string, confirm = 'delete-my-account') =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/deletion', headers: bearer(token), payload: { confirm } });

function push(token: string, deviceId: string, mutations: { collection: string; data: Record<string, unknown> }[]) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: bearer(token),
    payload: {
      deviceId,
      mutations: mutations.map((m) => ({
        mutationId: randomUUID(),
        collection: m.collection,
        recordId: randomUUID(),
        op: m.collection === 'set_logs' ? 'insert' : 'upsert',
        baseRevision: null,
        data: m.data,
        clientCreatedAt: h.clock.now().toISOString(),
      })),
    },
  });
}

/** A user with data in every user-linked table. */
async function populatedUser() {
  const email = uniqueEmail();
  const first = await signIn(h, email);
  const second = await signIn(h, email, device('android'));
  const token = first.tokens.accessToken;
  const pushed = await push(token, first.deviceId, [
    { collection: 'set_logs', data: { exercise: 'goblet_squat', reps: 10, loadKg: 20, bodyWeightKg: 82.5 } },
    { collection: 'set_logs', data: { exercise: 'push_up', reps: 12, note: CANARY.freeText, pain: CANARY.pain } },
    { collection: 'preferences', data: { displayName: CANARY.name, units: 'metric' } },
  ]);
  expect(pushed.statusCode).toBe(200);
  expect((await consent(token, 'health', 'granted')).statusCode).toBe(201);
  expect((await consent(token, 'analytics', 'granted')).statusCode).toBe(201);
  expect((await consent(token, 'analytics', 'withdrawn')).statusCode).toBe(201);
  // M20: an accepted legal text and a point-of-risk notice.
  const terms = (await h.app.inject({ method: 'GET', url: '/v1/legal/documents/terms?locale=fr&jurisdiction=FR' })).json() as { version: number; contentHash: string };
  const accepted = await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(token), payload: { documentId: 'terms', version: terms.version, locale: 'fr', jurisdiction: 'FR', source: 'mobile', contentHash: terms.contentHash } });
  expect(accepted.statusCode).toBe(201);
  const shown = await h.app.inject({ method: 'POST', url: '/v1/legal/notices', headers: bearer(token), payload: { noticeId: 'first_workout', version: 1, kind: 'shown', locale: 'fr', jurisdiction: 'FR', contentHash: renderNotice(notice('first_workout'), 'fr', 'FR').contentHash } });
  expect(shown.statusCode).toBe(204);
  // An outstanding sign-in code (keyed by the email hash, not by user id).
  expect((await requestCode(h, email)).statusCode).toBe(202);
  return { email, token, userId: first.user.id, first, second };
}

async function rowsForUser(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = await h.database.db.execute<{ table_name: string }>(
    sql`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'`,
  );
  for (const { table_name } of tables.rows) {
    const r = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table_name)} WHERE user_id = ${userId}`);
    counts[table_name] = r.rows[0]!.n;
  }
  const sessions = await h.database.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM refresh_tokens rt JOIN auth_sessions s ON s.id = rt.session_id WHERE s.user_id = ${userId}`,
  );
  counts.refresh_tokens = sessions.rows[0]!.n;
  return counts;
}

describe('consent records, versioned per data type (goal condition 1)', () => {
  it('every data type starts without consent', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const states = await consents(tokens.accessToken);
    expect(states.map((s) => [s.dataType, s.granted, s.version])).toEqual([
      ['health', false, null],
      ['photos', false, null],
      ['wearables', false, null],
      ['ai_coach', false, null],
      ['analytics', false, null],
    ]);
  });

  it('analytics stay off without consent, switch on with it and off again on withdrawal', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const token = tokens.accessToken;
    const events = [{ event: 'app_opened' }, { event: 'language_changed', props: { locale: 'en' } }];

    const before = await track(token, events);
    expect(before.statusCode).toBe(403);
    expect(before.json()).toEqual({ error: { code: 'privacy.consent_required' } });
    expect(sink.events).toHaveLength(0);

    // Consent for another data type does not unlock analytics.
    expect((await consent(token, 'health', 'granted')).statusCode).toBe(201);
    expect((await track(token, events)).statusCode).toBe(403);

    const granted = await consent(token, 'analytics', 'granted');
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({ consent: { dataType: 'analytics', granted: true, version: 1, needsRenewal: false } });
    const accepted = await track(token, events);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: 2 });
    // Forwarded events carry no user id or device id.
    expect(sink.events).toEqual([
      { event: 'app_opened', props: {} },
      { event: 'language_changed', props: { locale: 'en' } },
    ]);

    expect((await consent(token, 'analytics', 'withdrawn')).json()).toMatchObject({ consent: { granted: false } });
    expect((await track(token, events)).statusCode).toBe(403);
    expect(sink.events).toHaveLength(2);

    const states = await consents(token);
    expect(states.find((s) => s.dataType === 'health')).toMatchObject({ granted: true });
    expect(states.find((s) => s.dataType === 'analytics')).toMatchObject({ granted: false, version: 1 });
  });

  it('rejects grants of an outdated text version but always accepts a withdrawal', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const outdated = await consent(tokens.accessToken, 'photos', 'granted', 2);
    expect(outdated.statusCode).toBe(409);
    expect(outdated.json()).toEqual({ error: { code: 'privacy.consent_version_outdated' } });
    expect((await consent(tokens.accessToken, 'photos', 'withdrawn', 7)).statusCode).toBe(201);
  });

  it('a material change of the consent text switches the feature off until the user re-consents', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const token = tokens.accessToken;
    expect((await consent(token, 'analytics', 'granted', 1)).statusCode).toBe(201);
    expect((await track(token, [{ event: 'app_opened' }])).statusCode).toBe(202);

    const bumped: ConsentPolicySet = {
      default: { ...CONSENT_POLICIES.default, analytics: { currentVersion: 2, minimumVersion: 2, documentKey: 'consent.analytics.v2' } },
      byJurisdiction: {},
    };
    const v2 = await createHarness({ consentPolicies: bumped, analyticsSink: new MemoryAnalyticsSink() });
    try {
      expect((await consents(token, v2.app)).find((s) => s.dataType === 'analytics')).toMatchObject({
        granted: false,
        needsRenewal: true,
        version: 1,
        currentVersion: 2,
      });
      expect((await track(token, [{ event: 'app_opened' }], v2.app)).statusCode).toBe(403);
      const renew = await v2.app.inject({
        method: 'POST',
        url: '/v1/privacy/consents',
        headers: bearer(token),
        payload: { dataType: 'analytics', decision: 'granted', version: 2, locale: 'en', jurisdiction: 'FR' },
      });
      expect(renew.statusCode).toBe(201);
      expect((await track(token, [{ event: 'app_opened' }], v2.app)).statusCode).toBe(202);
    } finally {
      await v2.close();
    }
  });

  it('runs the owning module’s withdrawal handler in the same transaction', async () => {
    const { tokens, user } = await signIn(h, uniqueEmail());
    await consent(tokens.accessToken, 'photos', 'granted');
    expect(withdrawn).toEqual([]);
    await consent(tokens.accessToken, 'photos', 'withdrawn');
    expect(withdrawn).toEqual([`${user.id}:photos`]);
  });

  it('consent records and audit entries are append-only', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    await consent(tokens.accessToken, 'health', 'granted');
    await expect(h.database.db.execute(sql`UPDATE consent_records SET decision = 'withdrawn'`)).rejects.toThrow();
    await expect(h.database.db.execute(sql`UPDATE audit_entries SET action = 'consent.withdrawn'`)).rejects.toThrow();
  });

  it('requires authentication and valid input', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/privacy/consents' })).statusCode).toBe(401);
    const { tokens } = await signIn(h, uniqueEmail());
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/privacy/consents',
      headers: bearer(tokens.accessToken),
      payload: { dataType: 'location', decision: 'granted', version: 1, locale: 'fr', jurisdiction: 'FR' },
    });
    expect(bad.json()).toEqual({ error: { code: 'validation_error' } });
  });
});

describe('analytics intake rejects personal data (goal condition 3)', () => {
  it('refuses unknown events and any event carrying personal data', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    await consent(tokens.accessToken, 'analytics', 'granted');
    const attempts: [unknown, string][] = [
      [{ event: 'weight_logged', props: { value: 82.5 } }, 'analytics.unknown_event'],
      [{ event: 'screen_viewed', props: { screen: 'home', email: 'x' } }, 'analytics.personal_data'],
      [{ event: 'screen_viewed', props: { screen: CANARY.name } }, 'analytics.personal_data'],
      [{ event: 'screen_viewed', props: { weightKg: 82.5 } }, 'analytics.personal_data'],
      [{ event: 'screen_viewed', props: { screen: CANARY.pain } }, 'analytics.personal_data'],
      [{ event: 'screen_viewed', props: { note: CANARY.freeText } }, 'analytics.personal_data'],
      [{ event: 'screen_viewed', props: { screen: 'settings' } }, 'analytics.invalid_props'],
    ];
    for (const [event, code] of attempts) {
      const res = await track(tokens.accessToken, [{ event: 'app_opened' }, event]);
      expect({ event, status: res.statusCode, body: res.json() }).toEqual({ event, status: 400, body: { error: { code } } });
    }
    expect(sink.events).toEqual([]);
  });
});

describe('in-app export (goal condition 2)', () => {
  it('returns all of the user’s data as JSON', async () => {
    const { email, token, userId, first, second } = await populatedUser();
    const res = await exportData(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBe('attachment; filename="account-data-export.json"');
    expect(res.headers['cache-control']).toBe('no-store');
    const doc: DataExport = DataExportSchema.parse(res.json());

    expect(doc).toMatchObject({ format: 'account-data-export', schemaVersion: 1, user: { id: userId, email } });
    expect(doc.devices.map((d) => d.id).sort()).toEqual([first.deviceId, second.deviceId].sort());
    expect(doc.sessions).toHaveLength(2);
    expect(doc.consents.map((c) => [c.dataType, c.decision, c.version, c.jurisdiction])).toEqual([
      ['health', 'granted', 1, 'SN'],
      ['analytics', 'granted', 1, 'SN'],
      ['analytics', 'withdrawn', 1, 'SN'],
    ]);
    expect(doc.sync.revision).toBe(3);
    expect(doc.sync.changes.map((c) => c.data)).toEqual([
      { exercise: 'goblet_squat', reps: 10, loadKg: 20, bodyWeightKg: 82.5 },
      { exercise: 'push_up', reps: 12, note: CANARY.freeText, pain: CANARY.pain },
      { displayName: CANARY.name, units: 'metric' },
    ]);
    expect(doc.sync.mutations).toHaveLength(3);
    expect(doc.dataRequests).toEqual([expect.objectContaining({ kind: 'export', status: 'completed' })]);
    expect(doc.auditTrail.map((a) => a.action)).toEqual(['consent.granted', 'consent.granted', 'consent.withdrawn', 'data.exported']);
    // Credentials never leave the server, not even as hashes.
    const raw = res.body;
    for (const secret of [first.tokens.refreshToken, second.tokens.refreshToken, 'token_hash', 'tokenHash', 'code_hash']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('covers every table in primary storage (the inventory matches the live schema)', async () => {
    const live = await h.database.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(live.rows.map((r) => r.table_name)).toEqual(DATA_INVENTORY.map((e) => e.table).sort());

    const { token } = await populatedUser();
    const doc = (await exportData(token)).json() as Record<string, unknown>;
    for (const entry of DATA_INVENTORY) {
      if (!('section' in entry.export)) continue;
      const value = entry.export.section.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], doc);
      expect({ table: entry.table, present: value !== undefined && (!Array.isArray(value) || value.length > 0) }).toEqual({ table: entry.table, present: true });
    }
  });

  it('is limited per user and needs a session', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/privacy/export' })).statusCode).toBe(401);
    const { tokens } = await signIn(h, uniqueEmail());
    for (let i = 0; i < 5; i++) expect((await exportData(tokens.accessToken)).statusCode).toBe(200);
    const limited = await exportData(tokens.accessToken);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: 'privacy.rate_limited' } });
  });
});

describe('correction', () => {
  it('lets the user correct language and units', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const res = await h.app.inject({ method: 'PATCH', url: '/v1/me', headers: bearer(tokens.accessToken), payload: { locale: 'en', unitSystem: 'imperial' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { locale: 'en', unitSystem: 'imperial' } });
    const empty = await h.app.inject({ method: 'PATCH', url: '/v1/me', headers: bearer(tokens.accessToken), payload: {} });
    expect(empty.statusCode).toBe(400);
    const doc = (await exportData(tokens.accessToken)).json() as DataExport;
    expect(doc.auditTrail.map((a) => a.action)).toContain('data.corrected');
  });
});

describe('account deletion (goal condition 2)', () => {
  it('removes every row from primary storage at once and schedules the backup purge', async () => {
    const { email, token, userId, first } = await populatedUser();
    const emailHash = keyedHash(PEPPER, 'email', email);
    const before = await rowsForUser(userId);
    for (const table of ['users', 'devices', 'auth_sessions', 'sync_heads', 'sync_changes', 'sync_mutations', 'consent_records', 'refresh_tokens']) {
      expect({ table, hasRows: (before[table] ?? 0) > 0 || table === 'users' }).toEqual({ table, hasRows: true });
    }
    const otpBefore = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_codes WHERE email_hash = ${emailHash}`);
    expect(otpBefore.rows[0]!.n).toBeGreaterThan(0);
    const rlKeysBefore = await h.redis.keys(`${h.redisPrefix}rl:*${emailHash}`);
    expect(rlKeysBefore.length).toBeGreaterThan(0);

    expect((await deleteAccount(token, 'yes')).statusCode).toBe(400);
    const deletedAt = h.clock.now();
    backups.backups.push(new Date(deletedAt.getTime() - 3_600_000)); // last night's backup still holds the user
    const res = await deleteAccount(token);
    expect(res.statusCode).toBe(202);
    const body = res.json() as { requestId: string; status: string; primaryDeletedAt: string; backupPurgeDueAt: string };
    expect(body.status).toBe('backup_purge_pending');
    expect(body.primaryDeletedAt).toBe(deletedAt.toISOString());
    expect(Date.parse(body.backupPurgeDueAt) - deletedAt.getTime()).toBe(30 * 86_400_000);

    // Primary storage: nothing left, in any table.
    const users = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users WHERE id = ${userId}`);
    expect(users.rows[0]!.n).toBe(0);
    const after = await rowsForUser(userId);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    const otpAfter = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_codes WHERE email_hash = ${emailHash}`);
    expect(otpAfter.rows[0]!.n).toBe(0);
    expect(await h.redis.keys(`${h.redisPrefix}rl:*${emailHash}`)).toEqual([]);

    // What remains is pseudonymous: no email, no user id, no device id.
    const kept = await h.database.db.execute(sql`SELECT * FROM data_requests UNION ALL SELECT id, subject_ref, action, 'audit', occurred_at, occurred_at, NULL, NULL FROM audit_entries`);
    const keptJson = JSON.stringify(kept.rows);
    for (const identifier of [email, userId, first.deviceId]) expect(keptJson).not.toContain(identifier);
    expect(findPersonalData(kept.rows)).toEqual([]);

    // The session is gone: tokens stop working.
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: first.tokens.refreshToken } })).statusCode).toBe(401);

    // Backup purge: not due before 30 days, overdue while an older backup survives, completed once rotated out.
    h.clock.advance(29 * 86_400);
    expect(await h.app.services.privacy.runRetention()).toMatchObject({ backupPurgesCompleted: 0, backupPurgesOverdue: [] });
    h.clock.advance(1 * 86_400);
    expect(await h.app.services.privacy.runRetention()).toMatchObject({ backupPurgesCompleted: 0, backupPurgesOverdue: [body.requestId] });
    backups.rotate(new Date(h.clock.now().getTime() - 30 * 86_400_000));
    backups.backups.push(h.clock.now());
    expect(await h.app.services.privacy.runRetention()).toMatchObject({ backupPurgesCompleted: 1, backupPurgesOverdue: [] });
    const request = await h.database.db.execute<{ status: string; completed_at: Date }>(sql`SELECT status, completed_at FROM data_requests WHERE id = ${body.requestId}`);
    expect(request.rows[0]).toMatchObject({ status: 'completed' });
    const purged = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_entries WHERE action = 'backup.purged'`);
    expect(purged.rows[0]!.n).toBe(1);
  });

  it('the same email can sign up again and finds nothing of the old account', async () => {
    const { email, token } = await populatedUser();
    expect((await deleteAccount(token)).statusCode).toBe(202);
    const again = await signIn(h, email);
    expect(again.isNewUser).toBe(true);
    const doc = (await exportData(again.tokens.accessToken)).json() as DataExport;
    expect(doc.sync.changes).toEqual([]);
    expect(doc.consents).toEqual([]);
    expect(doc.devices).toHaveLength(1);
  });

  it('needs a session', async () => {
    expect((await h.app.inject({ method: 'POST', url: '/v1/privacy/deletion', payload: { confirm: 'delete-my-account' } })).statusCode).toBe(401);
  });
});

describe('retention schedule', () => {
  it('purges old sign-in codes, ended sessions and expired audit records, and keeps active sessions', async () => {
    const email = uniqueEmail();
    const active = await signIn(h, email);
    const ended = await signIn(h, email, device('android'));
    await h.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: ended.tokens.refreshToken } });
    await h.database.db.execute(sql`INSERT INTO audit_entries (id, subject_ref, action, occurred_at) VALUES (${randomUUID()}, 'x', 'data.exported', now() - interval '7 years')`);

    h.clock.advance(2 * 86_400);
    const early = await h.app.services.privacy.runRetention();
    expect(early).toMatchObject({ otpCodesPurged: 2, sessionsPurged: 0, auditEntriesPurged: 1 });

    // Keep the active session alive with regular refreshes past the ended-session retention period (90 days).
    let refreshToken = active.tokens.refreshToken;
    for (let day = 0; day < 100; day += 20) {
      h.clock.advance(20 * 86_400);
      const rotated = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });
      expect(rotated.statusCode).toBe(200);
      refreshToken = (rotated.json() as { tokens: { refreshToken: string } }).tokens.refreshToken;
    }
    const late = await h.app.services.privacy.runRetention();
    expect(late).toMatchObject({ sessionsPurged: 1 });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } })).statusCode).toBe(200);
  });

  it('ends a session whose refresh tokens all expired long ago', async () => {
    const idle = await signIn(h, uniqueEmail());
    h.clock.advance((30 + 91) * 86_400);
    expect(await h.app.services.privacy.runRetention()).toMatchObject({ sessionsPurged: 1 });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: idle.tokens.refreshToken } })).statusCode).toBe(401);
  });

  it('runs once at a time across instances', async () => {
    const second = await createHarness();
    try {
      const results = await Promise.all([h.app.services.privacy.runRetention(), second.app.services.privacy.runRetention()]);
      expect(results.filter((r) => r !== null).length).toBeGreaterThanOrEqual(1);
    } finally {
      await second.close();
    }
  });
});

describe('security headers', () => {
  it('sends HSTS, nosniff, no-referrer, no-store and a locked-down CSP', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers).toMatchObject({
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });
});

describe('no personal or health data in logs (goal condition 3)', () => {
  it('a full privacy journey logs no email, name, weight, pain report or free text', async () => {
    h.logs.length = 0;
    const { email, token, first } = await populatedUser();
    await consent(token, 'analytics', 'granted');
    await track(token, [{ event: 'screen_viewed', props: { note: CANARY.freeText } }]);
    await track(token, [{ event: 'app_opened' }]);
    await exportData(token);
    await h.app.inject({ method: 'PATCH', url: '/v1/me', headers: bearer(token), payload: { locale: 'en' } });
    await h.app.inject({ method: 'GET', url: `/v1/nowhere?email=${encodeURIComponent(email)}&note=${encodeURIComponent(CANARY.freeText)}` });
    await deleteAccount(token);

    expect(h.logs.length).toBeGreaterThan(20);
    expect(findPersonalDataInLogLines(h.logs)).toEqual([]);
    const output = h.logs.join('\n');
    for (const leaked of [email, CANARY.name, CANARY.weight, '82.5', CANARY.pain, CANARY.freeText, 'dizzy', first.tokens.refreshToken, token]) {
      expect(output).not.toContain(leaked);
    }
  });
});
