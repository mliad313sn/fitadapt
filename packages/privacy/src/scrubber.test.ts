import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  countBucket,
  findPersonalData,
  findPersonalDataInLogLines,
  REDACTED,
  RETENTION_UNVALIDATED,
  backupRotationMeetsDeletionDeadline,
  retentionConfig,
  retentionDays,
  scrubLogRecord,
  scrubText,
  validateAnalyticsEvent,
  valueCategories,
} from './index.js';

/**
 * Canary fixtures, one per category the M17 goal names (emails, names,
 * weights, pain reports, free text). All fictional (L12).
 */
export const CANARIES = {
  email: 'jeanne.testeur@example.test',
  name: 'Jeanne Testeur',
  weight: '82.5 kg',
  pain: 'left knee pain 7/10',
  freeText: 'I felt dizzy after the long run yesterday',
} as const;

const categoriesOf = (value: unknown) => [...new Set(findPersonalData(value).map((f) => f.category))].sort();

describe('personal-data detector', () => {
  it('flags each canary by value', () => {
    expect(valueCategories(CANARIES.email)).toContain('email');
    expect(valueCategories(CANARIES.name)).toEqual(['name']);
    expect(valueCategories(CANARIES.weight)).toEqual(['weight']);
    expect(valueCategories('176 lbs')).toEqual(['weight']);
    expect(valueCategories('81,4 kilos')).toEqual(['weight']);
    expect(valueCategories(CANARIES.pain)).toContain('pain');
    expect(valueCategories('douleur au genou')).toContain('pain');
    expect(valueCategories('6 / 10')).toEqual(['pain']);
    expect(valueCategories(CANARIES.freeText)).toEqual(['free_text']);
    expect(valueCategories('Bearer abcdefghijklmnop')).toContain('secret');
    // Fabricated JWT (not a credential), assembled at runtime so secret scanners do not flag the source.
    const fakeJwt = [{ alg: 'HS256' }, { sub: '12345' }].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).concat('c2lnbmF0dXJlLXZhbHVl').join('.');
    expect(valueCategories(fakeJwt)).toContain('secret');
    expect(valueCategories('+221 77 123 45 67')).toEqual(['phone']);
    expect(valueCategories('10.0.0.12')).toEqual(['ip']);
  });

  it('flags personal data by key, whatever the value', () => {
    expect(categoriesOf({ email: 'x' })).toEqual(['email']);
    expect(categoriesOf({ firstName: 'x', surname: 'y', displayName: 'z' })).toEqual(['name']);
    expect(categoriesOf({ weightKg: 82.5 })).toEqual(['weight']);
    expect(categoriesOf({ bodyMass: 70, poids: 70 })).toEqual(['weight']);
    expect(categoriesOf({ painScore: 7 })).toEqual(['pain']);
    expect(categoriesOf({ note: 'ok' })).toEqual(['free_text']);
    expect(categoriesOf({ refreshToken: 'r', code: '123456' })).toEqual(['secret']);
    expect(categoriesOf({ phone: '0' })).toEqual(['phone']);
    expect(categoriesOf({ ip: '::1' })).toEqual(['ip']);
  });

  it('finds data deep inside objects and arrays, with a path', () => {
    const findings = findPersonalData({ events: [{ props: { comment: 'hello' } }], nested: { a: { b: CANARIES.email } } });
    expect(findings).toEqual([
      { category: 'free_text', path: 'events[0].props.comment', by: 'key' },
      { category: 'email', path: 'nested.a.b', by: 'value' },
    ]);
  });

  it('leaves operational values alone', () => {
    const clean = {
      level: 30,
      time: 1_790_000_000_000,
      pid: 42,
      hostname: 'api-1',
      reqId: 'req-1',
      req: { method: 'POST', route: '/v1/privacy/consents' },
      res: { statusCode: 201 },
      responseTime: 3.2,
      at: '2026-09-23T10:00:00.000Z',
      userRef: '0b9c4c1e-3f7e-4f59-9a43-2d1c3a1e8f10',
      err: { type: 'TypeError', errorCode: '23505' },
      enabled: true,
      nothing: null,
      redacted: REDACTED,
      email: REDACTED,
    };
    expect(findPersonalData(clean)).toEqual([]);
  });

  it('treats the pino msg as a developer message but still checks it for data', () => {
    expect(findPersonalDataInLogLines('{"level":30,"msg":"request completed"}')).toEqual([]);
    expect(findPersonalDataInLogLines(`{"msg":"sent to ${CANARIES.email}"}`)).toEqual([{ category: 'email', path: 'line 1: msg', by: 'value' }]);
    expect(findPersonalDataInLogLines(['not json at all', `{"data":{"msg":"${CANARIES.freeText}"}}`]).map((f) => f.category)).toEqual(['free_text']);
  });

  it('ignores circular references', () => {
    const a: Record<string, unknown> = { ok: 1 };
    a.self = a;
    expect(findPersonalData(a)).toEqual([]);
  });
});

describe('resistance to hostile input (ReDoS)', () => {
  it('scans long adversarial strings in linear time', () => {
    const hostile = [
      'a'.repeat(50_000) + '@',
      'a.'.repeat(25_000) + '@x',
      '1'.repeat(50_000) + ' kg!',
      '+1' + ' 1'.repeat(25_000) + 'x',
      'Aa '.repeat(20_000) + '1',
      'ab, '.repeat(20_000),
      '1.'.repeat(25_000),
    ];
    const started = performance.now();
    for (const value of hostile) {
      valueCategories(value);
      scrubText(value);
      findPersonalData({ value });
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('log scrubber', () => {
  it('removes every canary category from a log record', () => {
    const record = {
      user: { email: CANARIES.email, firstName: 'Jeanne', displayName: CANARIES.name },
      who: CANARIES.name,
      measurement: { weightKg: 82.5, text: CANARIES.weight },
      checkin: { joint: 'knee', painScore: 7 },
      reason: CANARIES.pain,
      said: CANARIES.freeText,
      list: [CANARIES.email, 'ok'],
      err: Object.assign(new Error(`duplicate key ${CANARIES.email}`), { code: '23505' }),
      plain: new Error('x'),
      badCode: Object.assign(new Error('x'), { code: CANARIES.email }),
      when: new Date('2026-09-23T10:00:00.000Z'),
      buffer: new Map([['a', 1]]),
      route: '/v1/sync/push',
    };
    const scrubbed = scrubLogRecord(record);
    expect(findPersonalData(scrubbed)).toEqual([]);
    const out = JSON.stringify(scrubbed);
    for (const canary of [...Object.values(CANARIES), 'Jeanne', '82.5', 'painScore":7']) expect(out).not.toContain(canary);
    expect(scrubbed).toMatchObject({
      err: { type: 'Error', errorCode: '23505' },
      plain: { type: 'Error' },
      badCode: { type: 'Error' },
      when: '2026-09-23T10:00:00.000Z',
      buffer: '[Map]',
      route: '/v1/sync/push',
      list: [REDACTED, 'ok'],
    });
  });

  it('passes serializer-owned keys through and survives cycles and depth', () => {
    const req = { method: 'GET' };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { deep };
    const out = scrubLogRecord({ req, cyclic, deep, email: CANARIES.email }, { passThroughKeys: ['req'] });
    expect(out.req).toBe(req);
    expect(out.cyclic).toEqual({ self: '[circular]' });
    expect(out.email).toBe(REDACTED);
    expect(JSON.stringify(out.deep)).toContain(REDACTED);
  });

  it('redacts interpolated data in developer messages', () => {
    expect(scrubText(`code sent to ${CANARIES.email}`)).toBe(`code sent to ${REDACTED}`);
    expect(scrubText('weighed 82.5 kg today')).toBe(`weighed ${REDACTED} today`);
    expect(scrubText('Server listening at http://127.0.0.1:3000')).toBe(`Server listening at http://${REDACTED}:3000`);
    expect(scrubText('Authorization: Bearer abcdefghijklmnop')).toBe(`Authorization: ${REDACTED}`);
    expect(scrubText('call +221 77 123 45 67')).toBe(`call ${REDACTED}`);
    expect(scrubText(`user reported ${CANARIES.pain}`)).toBe(REDACTED);
    expect(scrubText('request completed')).toBe('request completed');
  });
});

/**
 * PKG-04 corpus: every false negative of the packages/tooling review, and
 * operational values that must stay untouched. All names and addresses are
 * fictional (L12).
 */
describe('PKG-04 corpus: personal data the scrubber and the detector must catch', () => {
  const byKey: Record<string, unknown>[] = [
    { partnerName: 'Jeanne' },
    { ownerName: 'Jeanne' },
    { coachName: 'Jeanne Testeur' },
    { guest_nom: 'Testeur' },
    { deviceName: 'Jeanne’s phone' },
    { userName: 'jtesteur' },
  ];
  it.each(byKey)('by key: %j', (record) => {
    const [key] = Object.keys(record);
    expect(findPersonalData(record)).toEqual([{ category: 'name', path: key, by: 'key' }]);
    expect(scrubLogRecord(record)[key!]).toBe(REDACTED);
  });

  const byValue: readonly (readonly [string, string])[] = [
    ['Marie-Claire Dupont', 'name'],
    ["Siobhan O'Brien", 'name'],
    ['Siobhan O’Brien', 'name'],
    ['JEANNE TESTEUR', 'name'],
    ['Jeanne TESTEUR', 'name'],
    ['Jeanne Testeur,', 'name'],
    ['Jeanne Testeur (host)', 'name'],
    ['Paul McDonald', 'name'],
    ['/v1/pair/invite?to=jeanne%40exemple.fr', 'email'],
    ['jeanne@exämple.fr', 'email'],
    ['jéanne@example.test', 'email'],
    ['jeanne＠exemple.fr', 'email'],
    ['0612345678', 'phone'],
    ['06 12 34 56 78', 'phone'],
    ['06.12.34.56.78', 'phone'],
    ['2001:db8::1', 'ip'],
    ['fe80::1ff:fe23:4567:890a', 'ip'],
    ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'ip'],
    ['sk-ant-abcdefghijklmnopqrstuvwx', 'secret'],
    [['gh', 'p_', 'a'.repeat(36)].join(''), 'secret'],
    ['82  kg', 'weight'],
    ['82kg.', 'weight'],
  ];
  it.each(byValue)('by value: %j is %s, and scrubbed', (value, category) => {
    expect(valueCategories(value)).toContain(category);
    expect(scrubLogRecord({ v: value }).v).toBe(REDACTED);
    expect(findPersonalData({ v: value }).map((f) => f.category)).toContain(category);
  });

  const messages: readonly (readonly [string, string])[] = [
    ['invite sent to Jeanne Testeur', `invite sent to ${REDACTED}`],
    ['partner Marie-Claire Dupont left', `partner ${REDACTED} left`],
    ["pair with Siobhan O'Brien, host", `pair with ${REDACTED} host`],
    ['user jeanne%40exemple.fr joined', `user ${REDACTED} joined`],
    ['call 06 12 34 56 78 now', `call ${REDACTED} now`],
    ['from 2001:db8::1 at 12:30:45', `from ${REDACTED} at 12:30:45`],
    ['key sk-ant-abcdefghijklmnopqrstuvwx refused', `key ${REDACTED} refused`],
  ];
  it.each(messages)('in the pino msg: %j', (msg, scrubbed) => {
    expect(scrubText(msg)).toBe(scrubbed);
    expect(findPersonalDataInLogLines(JSON.stringify({ level: 30, msg })).length).toBeGreaterThan(0);
  });

  it('leaves operational log values and messages alone', () => {
    const clean = {
      msg: 'incoming request',
      eventName: 'workout_completed',
      routeName: 'Home',
      hostname: 'api-1',
      fileName: 'hold.json',
      exerciseName: 'back_squat',
      at: '2026-09-23T10:00:00.000Z',
      clock: '12:30:45',
      method: 'GET',
      proto: 'HTTP GET',
      errorCode: '23505',
      ms: 1234567890,
      count: '0612',
      version: '0.12.3',
      userRef: '0b9c4c1e-3f7e-4f59-9a43-2d1c3a1e8f10',
      ratio: '3:2',
      s3: 'S3 BLOCK',
    };
    expect(findPersonalData(clean, { messageKeys: ['msg'] })).toEqual([]);
    for (const msg of ['request completed', 'Server listening', 'route not found', 'sync push accepted', 'S3 lock set', 'Fair pair session started']) {
      expect(findPersonalDataInLogLines(JSON.stringify({ level: 30, msg })), msg).toEqual([]);
      expect(scrubText(msg)).toBe(msg);
    }
  });

  it('stays linear on hostile name-like and address-like input', () => {
    const hostile = ['Aa-'.repeat(20_000), "O'".repeat(20_000), 'A '.repeat(30_000), '%40'.repeat(20_000), ':'.repeat(60_000), 'ab:'.repeat(20_000), '0 1'.repeat(20_000)];
    const started = performance.now();
    for (const value of hostile) {
      valueCategories(value);
      scrubText(value);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('analytics allowlist', () => {
  it('accepts allowlisted events with enum properties', () => {
    expect(validateAnalyticsEvent({ event: 'app_opened' })).toEqual({ ok: true, event: { event: 'app_opened', props: {} } });
    expect(validateAnalyticsEvent({ event: 'consent_changed', props: { dataType: 'analytics', decision: 'granted' } }).ok).toBe(true);
    expect(validateAnalyticsEvent({ event: 'sync_completed', props: { pushed: countBucket(3), pulled: countBucket(0) } }).ok).toBe(true);
  });

  it('M04: dashboard, export and photo-backup events carry only enums and yes/no — body values, dates and photo data are refused', () => {
    expect(validateAnalyticsEvent({ event: 'screen_viewed', props: { screen: 'progress' } }).ok).toBe(true);
    expect(validateAnalyticsEvent({ event: 'screen_viewed', props: { screen: 'photos' } }).ok).toBe(true);
    expect(validateAnalyticsEvent({ event: 'progress_export_requested', props: { format: 'csv', withPhotos: false } }).ok).toBe(true);
    expect(validateAnalyticsEvent({ event: 'photo_backup_toggled', props: { enabled: true } }).ok).toBe(true);
    expect(validateAnalyticsEvent({ event: 'progress_export_requested', props: { format: 'csv', withPhotos: false, weightKg: 60.4 } })).toMatchObject({ ok: false, reason: 'personal_data' });
    expect(validateAnalyticsEvent({ event: 'progress_export_requested', props: { format: 'xlsx', withPhotos: false } })).toEqual({ ok: false, reason: 'invalid_props' });
    expect(validateAnalyticsEvent({ event: 'photo_backup_toggled', props: { enabled: true, photos: 3 } })).toEqual({ ok: false, reason: 'invalid_props' });
    expect(validateAnalyticsEvent({ event: 'bodyweight_logged', props: {} })).toEqual({ ok: false, reason: 'unknown_event' });
  });

  it('rejects unknown events and properties', () => {
    expect(validateAnalyticsEvent({ event: 'weight_logged', props: {} })).toEqual({ ok: false, reason: 'unknown_event' });
    expect(validateAnalyticsEvent({ event: 'app_opened', props: { extra: 1 } })).toEqual({ ok: false, reason: 'invalid_props' });
    expect(validateAnalyticsEvent({ event: 'screen_viewed', props: { screen: 'settings/profile' } })).toEqual({ ok: false, reason: 'invalid_props' });
  });

  it('rejects every canary category in event properties', () => {
    const attempts: Record<string, unknown>[] = [
      { screen: CANARIES.email },
      { email: 'x' },
      { name: CANARIES.name },
      { screen: CANARIES.name },
      { weightKg: 82.5 },
      { screen: CANARIES.weight },
      { painScore: 7 },
      { screen: CANARIES.pain },
      { note: CANARIES.freeText },
      { screen: CANARIES.freeText },
    ];
    for (const props of attempts) {
      const result = validateAnalyticsEvent({ event: 'screen_viewed', props });
      expect({ props, ok: result.ok, reason: result.ok ? null : result.reason }).toEqual({ props, ok: false, reason: 'personal_data' });
    }
  });

  it('no allowlisted event schema accepts a free string', () => {
    for (const [name, schema] of Object.entries(ANALYTICS_EVENTS)) {
      const shape = schema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
      for (const [prop, propSchema] of Object.entries(shape)) {
        expect({ name, prop, accepts: propSchema.safeParse('any free text here').success }).toEqual({ name, prop, accepts: false });
      }
    }
  });

  it('buckets counts', () => {
    expect([0, 1, 2, 5, 6, 20, 21, 500].map(countBucket)).toEqual(['0', '1', '2-5', '2-5', '6-20', '6-20', '21+', '21+']);
  });
});

describe('retention schedule config', () => {
  it('every period carries a source and awaits validation', () => {
    for (const value of Object.values(retentionConfig)) {
      expect(value.source.length).toBeGreaterThan(0);
      expect(value.validated).toBe(false);
    }
    expect(RETENTION_UNVALIDATED).toHaveLength(Object.keys(retentionConfig).length);
  });

  it('deletion completes within 30 days, backups included', () => {
    expect(retentionDays('deletionCompletionMaxDays')).toBeLessThanOrEqual(30);
    expect(backupRotationMeetsDeletionDeadline()).toBe(true);
    expect(
      backupRotationMeetsDeletionDeadline({ ...retentionConfig, backupRetentionDays: { ...retentionConfig.backupRetentionDays, value: 35 } }),
    ).toBe(false);
  });
});
