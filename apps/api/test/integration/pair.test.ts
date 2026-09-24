import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PAIR_RULES_VERSION } from '@fitadapt/engine';
import { PairServerMessageSchema, type PairEvent, type PairServerMessage, type SetLog } from '@fitadapt/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { pairEvents, pairParticipants, pairSessions, syncChanges } from '../../src/db/schema.js';
import { bearer, createHarness, device, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/**
 * M09 goal condition 5: two clients (two accounts, two devices) join one
 * multi-device pair session over the WebSocket, stay in sync through a
 * disconnect and reconnect, and end with correct per-user logs. Also: each
 * participant's own L2 gate and partner_sharing consent, projection by the
 * sender's scopes (body weight and performance only when shared), the
 * challenge off by default, defensibility events for both in the same
 * transaction as the relay data (ADR-009), erasure on withdrawal, no timer
 * or pair state in Redis, and no token or health value in the logs.
 * P1 (Ibrahima) and P2 (Awa) are fictional.
 */
let h: Harness;
let wsUrl: string;
beforeAll(async () => {
  h = await createHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = `ws://127.0.0.1:${(h.app.server.address() as AddressInfo).port}/v1/pair/ws`;
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

async function user() {
  const dev = device();
  const auth = await signIn(h, uniqueEmail(), dev);
  return { token: auth.tokens.accessToken, userId: auth.user.id, deviceId: dev.id };
}
type User = Awaited<ReturnType<typeof user>>;
const consent = (u: User, dataType: string, decision: 'granted' | 'withdrawn' = 'granted') =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(u.token), payload: { dataType, decision, version: 1, locale: 'en', jurisdiction: 'GB', source: 'mobile' } });
async function acceptL2(u: User) {
  for (const documentId of ['terms', 'privacy', 'exercise_risk']) {
    const d = (await h.app.inject({ method: 'GET', url: `/v1/legal/documents/${documentId}?locale=en&jurisdiction=GB` })).json() as { version: number; contentHash: string };
    expect((await h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(u.token), payload: { documentId, version: d.version, locale: 'en', jurisdiction: 'GB', source: 'mobile', contentHash: d.contentHash } })).statusCode).toBe(201);
  }
}
/** A participant who accepted their own texts and gave their own health and partner-sharing consents. */
async function ready() {
  const u = await user();
  expect((await consent(u, 'health')).statusCode).toBe(201);
  await acceptL2(u);
  expect((await consent(u, 'partner_sharing')).statusCode).toBe(201);
  return u;
}
const create = (u: User, scopes: string[] = [], displayName = 'Ibrahima') => h.app.inject({ method: 'POST', url: '/v1/pair/sessions', headers: bearer(u.token), payload: { displayName, scopes, jurisdiction: 'GB' } });
const join = (u: User, joinCode: string, scopes: string[] = [], displayName = 'Awa') => h.app.inject({ method: 'POST', url: '/v1/pair/sessions/join', headers: bearer(u.token), payload: { joinCode, displayName, scopes, jurisdiction: 'GB' } });
const chain = async (u: User) => h.app.services.legal.log.chain(h.app.services.legal.subjectRef(u.userId));

/** A device's socket: messages in arrival order, and the highest contiguous seq it has seen (what it asks for on reconnect). */
class Client {
  readonly messages: PairServerMessage[] = [];
  private ws!: WebSocket;
  private waiters: (() => void)[] = [];
  closeCode: number | null = null;
  constructor(
    readonly u: User,
    readonly pairSessionId: string,
  ) {}
  lastSeq = 0;
  async open(): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    this.closeCode = null;
    this.ws.on('message', (data) => {
      const m = PairServerMessageSchema.parse(JSON.parse(String(data)));
      this.messages.push(m);
      if (m.type === 'welcome') this.lastSeq = Math.max(this.lastSeq, Math.min(this.lastSeq, m.seq));
      if (m.type === 'event' && m.seq === this.lastSeq + 1) this.lastSeq = m.seq;
      for (const w of this.waiters.splice(0)) w();
    });
    this.ws.on('close', (code) => {
      this.closeCode = code;
      for (const w of this.waiters.splice(0)) w();
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }
  hello(token = this.u.token) {
    this.ws.send(JSON.stringify({ type: 'hello', token, pairSessionId: this.pairSessionId, lastSeq: this.lastSeq }));
  }
  send(event: PairEvent, clientEventId: string = randomUUID()) {
    this.ws.send(JSON.stringify({ type: 'event', clientEventId, event }));
    return clientEventId;
  }
  raw(text: string) {
    this.ws.send(text);
  }
  async until<T extends PairServerMessage>(pred: (m: PairServerMessage) => m is T, from = 0, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).find(pred);
      if (found) return found;
      if (this.closeCode !== null) throw new Error(`socket closed (${this.closeCode})`);
      if (Date.now() > deadline) throw new Error(`timeout waiting; got ${JSON.stringify(this.messages.slice(from))}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
  async closed(): Promise<number> {
    const deadline = Date.now() + 5000;
    while (this.closeCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    return this.closeCode ?? -1;
  }
  close() {
    this.ws.close();
  }
  events(from: 'a' | 'b') {
    return this.messages.filter((m): m is Extract<PairServerMessage, { type: 'event' }> => m.type === 'event' && m.from === from);
  }
}
const isWelcome = (m: PairServerMessage): m is Extract<PairServerMessage, { type: 'welcome' }> => m.type === 'welcome';
const isError = (m: PairServerMessage): m is Extract<PairServerMessage, { type: 'error' }> => m.type === 'error';
const isEvent =
  (clientEventId: string) =>
  (m: PairServerMessage): m is Extract<PairServerMessage, { type: 'event' }> =>
    m.type === 'event' && m.clientEventId === clientEventId;
const isPresence =
  (connected: boolean) =>
  (m: PairServerMessage): m is Extract<PairServerMessage, { type: 'presence' }> =>
    m.type === 'presence' && m.connected === connected;

const PLAN_A = randomUUID();
const PLAN_B = randomUUID();
const outline = (planId: string, exerciseId: string, loadKg: number | null): PairEvent => ({
  type: 'plan',
  outline: { planId, exercises: [{ slot: 'squat', exerciseId, sets: [0, 1, 2].map(() => ({ workSeconds: 30, restSeconds: 90, loadKg })) }] },
});
const turn = (setIndex: number, exerciseId: string, reps: number, loadKg: number | null): PairEvent => ({ type: 'turn', exerciseIndex: 0, setIndex, status: 'done', performance: { exerciseId, reps, seconds: null, loadKg, rir: 2 } });

/** Each device logs its own sets through its own account's sync (append-only set_logs). */
async function pushSets(u: User, planId: string, exerciseId: string, sets: { reps: number; loadKg: number | null }[]) {
  const mutations = sets.map((s, i) => {
    const data: SetLog = { schemaVersion: 1, planId, exerciseIndex: 0, exerciseId, set: { index: i + 1, status: 'done', reps: s.reps, seconds: null, loadKg: s.loadKg, rir: 2 }, loggedAt: h.clock.now().toISOString(), correctionOf: null };
    return { mutationId: randomUUID(), collection: 'set_logs', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data, clientCreatedAt: h.clock.now().toISOString() };
  });
  const res = await h.app.inject({ method: 'POST', url: '/v1/sync/push', headers: bearer(u.token), payload: { deviceId: u.deviceId, mutations } });
  expect(res.statusCode).toBe(200);
}

describe('each participant accepts their own texts and gives their own consent (goal condition 7, server)', () => {
  it('create and join need the caller’s OWN L2 acceptances, health consent and partner_sharing consent', async () => {
    const bare = await user();
    expect((await create(bare)).json()).toEqual({ error: { code: 'legal.acceptance_required' } });
    await consent(bare, 'health');
    await acceptL2(bare);
    // L2 done, but nothing may be shared without the partner_sharing consent.
    expect((await create(bare)).json()).toEqual({ error: { code: 'pair.consent_required' } });
    const a = await ready();
    const { joinCode } = (await create(a)).json() as { joinCode: string };
    // The partner's acceptances are never the host's: an account without its own gets nothing.
    const b = await user();
    await consent(b, 'partner_sharing');
    expect((await join(b, joinCode)).json()).toEqual({ error: { code: 'legal.acceptance_required' } });
    expect(await h.database.db.select().from(pairParticipants)).toHaveLength(1);
    // Own session, unknown code, full session.
    expect((await join(a, joinCode)).json()).toEqual({ error: { code: 'pair.own_session' } });
    expect((await join(await ready(), 'ZZZZZZ')).json()).toEqual({ error: { code: 'pair.not_found' } });
    expect((await join(await ready(), joinCode)).statusCode).toBe(200);
    expect((await join(await ready(), joinCode)).json()).toEqual({ error: { code: 'pair.full' } });
    // A code expires after the join window.
    const { joinCode: late } = (await create(a)).json() as { joinCode: string };
    h.clock.advance(1801);
    expect((await join(await ready(), late)).json()).toEqual({ error: { code: 'pair.join_expired' } });
  });

  it('the Fair Challenge is off by default and on only when both chose it — then logged in both chains with the participation', async () => {
    const a = await ready();
    const b = await ready();
    const off = (await create(a, ['challenge'])).json() as { joinCode: string };
    expect((await join(b, off.joinCode, [])).json()).toMatchObject({ challenge: false });
    const on = (await create(a, ['challenge'])).json() as { pairSessionId: string; joinCode: string };
    expect((await join(b, on.joinCode, ['challenge'])).json()).toEqual({ pairSessionId: on.pairSessionId, slot: 'b', challenge: true });
    for (const u of [a, b]) {
      const started = (await chain(u)).filter((e) => e.type === 'pair.challenge_started');
      expect(started.map((e) => e.payload)).toEqual([{ pairSessionId: on.pairSessionId, rulesVersion: PAIR_RULES_VERSION }]);
    }
  });
});

describe('two devices, one pair session over the WebSocket (goal condition 5)', () => {
  it('join, stay in sync through a disconnect and reconnect, and end with correct per-user logs', async () => {
    const a = await ready();
    const b = await ready();
    // Ibrahima shares his performance; Awa shares nothing beyond taking part (no performance, no body weight).
    const created = (await create(a, ['performance'])).json() as { pairSessionId: string; joinCode: string };
    expect(created.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    expect((await join(b, created.joinCode, [])).json()).toEqual({ pairSessionId: created.pairSessionId, slot: 'b', challenge: false });
    const ca = new Client(a, created.pairSessionId);
    const cb = new Client(b, created.pairSessionId);
    await ca.open();
    ca.hello();
    expect(await ca.until(isWelcome)).toEqual({ type: 'welcome', slot: 'a', seq: 0, challenge: false, participants: [{ slot: 'a', displayName: 'Ibrahima', connected: true }, { slot: 'b', displayName: 'Awa', connected: false }] });
    await cb.open();
    cb.hello();
    expect(await cb.until(isWelcome)).toMatchObject({ slot: 'b', seq: 0, participants: [{ slot: 'a', connected: true }, { slot: 'b', connected: true }] });
    await ca.until(isPresence(true));

    // Plans: each device builds the same timeline from both outlines. Awa's reaches Ibrahima without exercises or loads.
    const pa = ca.send(outline(PLAN_A, 'goblet_squat', 10));
    const pb = cb.send(outline(PLAN_B, 'air_squat', null));
    expect((await cb.until(isEvent(pa))).event).toEqual(outline(PLAN_A, 'goblet_squat', 10));
    expect((await ca.until(isEvent(pb))).event).toEqual({ type: 'plan', outline: { planId: PLAN_B, exercises: [{ slot: 'squat', exerciseId: null, sets: [0, 1, 2].map(() => ({ workSeconds: 30, restSeconds: 90, loadKg: null })) }] } });

    // Turns: I go / you go. Awa's reps are not shared with Ibrahima; his are shared with her.
    const t1 = ca.send(turn(0, 'goblet_squat', 10, 10));
    expect((await cb.until(isEvent(t1))).event).toEqual(turn(0, 'goblet_squat', 10, 10));
    const t2 = cb.send(turn(0, 'air_squat', 12, null));
    expect((await ca.until(isEvent(t2))).event).toEqual({ type: 'turn', exerciseIndex: 0, setIndex: 0, status: 'done', performance: null });
    // Refused by scope: Awa did not opt in to share her body weight; nobody chose the challenge.
    const before = ca.messages.length;
    cb.send({ type: 'bodyweight', kg: 60 });
    expect((await cb.until(isError)).code).toBe('pair.scope_required');
    ca.send({ type: 'score', points: 50, status: 'scoring' });
    expect((await ca.until(isError)).code).toBe('pair.challenge_off');

    // Awa's phone drops off (tunnel, battery saver): Ibrahima is told, and goes on.
    cb.close();
    await ca.until(isPresence(false));
    const seenByB = cb.lastSeq;
    const t3 = ca.send(turn(1, 'goblet_squat', 9, 10));
    await ca.until(isEvent(t3));
    const t4 = ca.send(turn(2, 'goblet_squat', 8, 10));
    await ca.until(isEvent(t4));
    expect(ca.messages.slice(before).filter((m) => m.type === 'event' && m.from === 'b')).toEqual([]);

    // She reconnects with the last seq she saw: exactly the missed events, in order, then she resends her unacknowledged turn.
    const cb2 = new Client(b, created.pairSessionId);
    cb2.lastSeq = seenByB;
    await cb2.open();
    cb2.hello();
    const welcome = await cb2.until(isWelcome);
    expect(welcome.seq).toBe(seenByB + 2);
    await cb2.until(isEvent(t4));
    expect(cb2.messages.filter((m) => m.type === 'event').map((m) => (m as { clientEventId: string }).clientEventId)).toEqual([t3, t4]);
    await ca.until(isPresence(true), before);
    const resend = cb2.send(turn(1, 'air_squat', 12, null), t2); // same device id as the earlier t2: already stored
    const ack = await cb2.until(isEvent(resend));
    expect(ack.seq).toBe(ca.events('b').find((m) => m.clientEventId === t2)!.seq);
    const t5 = cb2.send(turn(1, 'air_squat', 11, null));
    await ca.until(isEvent(t5));
    // No duplicate: Ibrahima saw t2 once.
    expect(ca.events('b').filter((m) => m.clientEventId === t2)).toHaveLength(1);

    // Awa finishes and leaves. Her chain says she stopped; his only says his partner left (never why).
    const left = cb2.send({ type: 'left' });
    expect((await ca.until(isEvent(left))).event).toEqual({ type: 'left' });
    const bChain = await chain(b);
    const aChain = await chain(a);
    expect(bChain.filter((e) => e.type.startsWith('pair.')).map((e) => [e.type, e.payload])).toEqual([
      ['pair.joined', { pairSessionId: created.pairSessionId, role: 'partner', mode: 'multi_device', scopes: [], consentVersion: 1 }],
      ['pair.left', { pairSessionId: created.pairSessionId, reason: 'stopped' }],
    ]);
    expect(aChain.filter((e) => e.type.startsWith('pair.')).map((e) => [e.type, e.payload])).toEqual([
      ['pair.joined', { pairSessionId: created.pairSessionId, role: 'host', mode: 'multi_device', scopes: ['performance'], consentVersion: 1 }],
      ['pair.partner_left', { pairSessionId: created.pairSessionId }],
    ]);

    // The relay is in order with no gap, each event stored once, under the account that sent it.
    const relay = await h.database.db.select().from(pairEvents).where(eq(pairEvents.pairSessionId, created.pairSessionId)).orderBy(pairEvents.seq);
    expect(relay.map((r) => r.seq)).toEqual(relay.map((_, i) => i + 1));
    expect(relay.filter((r) => r.fromUserId === a.userId).map((r) => r.clientEventId)).toEqual([pa, t1, t3, t4]);
    expect(relay.filter((r) => r.fromUserId === b.userId).map((r) => r.clientEventId)).toEqual([pb, t2, t5, left]);

    // Per-user logs: each device logs its own sets through its own account; they never mix.
    await pushSets(a, PLAN_A, 'goblet_squat', [{ reps: 10, loadKg: 10 }, { reps: 9, loadKg: 10 }, { reps: 8, loadKg: 10 }]);
    await pushSets(b, PLAN_B, 'air_squat', [{ reps: 12, loadKg: null }, { reps: 11, loadKg: null }]);
    const logsOf = async (u: User) => (await h.database.db.select().from(syncChanges).where(and(eq(syncChanges.userId, u.userId), eq(syncChanges.collection, 'set_logs'))).orderBy(syncChanges.revision)).map((r) => r.data as SetLog);
    const la = await logsOf(a);
    const lb = await logsOf(b);
    expect(la.map((s) => [s.planId, s.exerciseId, s.set.reps])).toEqual([[PLAN_A, 'goblet_squat', 10], [PLAN_A, 'goblet_squat', 9], [PLAN_A, 'goblet_squat', 8]]);
    expect(lb.map((s) => [s.planId, s.exerciseId, s.set.reps])).toEqual([[PLAN_B, 'air_squat', 12], [PLAN_B, 'air_squat', 11]]);

    // No token in any URL or log line; no pair or timer state in Redis; no health value in the logs.
    const logs = h.logs.join('\n');
    expect(logs).not.toContain(a.token);
    expect(logs).not.toContain(b.token);
    expect(logs).not.toMatch(/goblet_squat|air_squat|"reps"|"kg"/);
    const keys = await h.redis.keys(`${h.redisPrefix}*`);
    expect(keys.filter((k) => /pair|timer|rest/i.test(k))).toEqual([]);

    // Each person's export has their own participation and only the events they sent.
    const exported = (await h.app.inject({ method: 'GET', url: '/v1/privacy/export', headers: bearer(b.token) })).json() as { pair: { participations: { displayName: string }[]; events: { clientEventId: string }[] } };
    expect(exported.pair.participations.map((p) => p.displayName)).toEqual(['Awa']);
    expect(exported.pair.events.map((e) => e.clientEventId)).toEqual([pb, t2, t5, left]);

    ca.close();
    cb2.close();
  }, 30_000);

  it('the hello carries the token; a bad token, a stranger or a withdrawn consent is refused and nothing is shared', async () => {
    const a = await ready();
    const b = await ready();
    const { pairSessionId, joinCode } = (await create(a, ['performance', 'bodyweight'])).json() as { pairSessionId: string; joinCode: string };
    await join(b, joinCode, []);
    const bad = new Client(a, pairSessionId);
    await bad.open();
    bad.hello('not-a-token');
    expect((await bad.until(isError)).code).toMatch(/^auth\./);
    expect(await bad.closed()).toBe(4401);
    const stranger = new Client(await ready(), pairSessionId);
    await stranger.open();
    stranger.hello();
    expect((await stranger.until(isError)).code).toBe('pair.not_participant');
    expect(await stranger.closed()).toBe(4403);
    const junk = new Client(a, pairSessionId);
    await junk.open();
    junk.raw('{not json');
    expect(await junk.closed()).toBe(4400);

    // Ibrahima opted in to share his body weight: Awa receives it.
    const ca = new Client(a, pairSessionId);
    const cb = new Client(b, pairSessionId);
    await ca.open();
    ca.hello();
    await ca.until(isWelcome);
    await cb.open();
    cb.hello();
    await cb.until(isWelcome);
    const bw = ca.send({ type: 'bodyweight', kg: 120 });
    expect((await cb.until(isEvent(bw))).event).toEqual({ type: 'bodyweight', kg: 120 });

    // Awa withdraws her partner_sharing consent: the relay erases what it holds from her, and refuses her next event.
    const t = cb.send(turn(0, 'air_squat', 10, null));
    await cb.until(isEvent(t));
    expect((await consent(b, 'partner_sharing', 'withdrawn')).statusCode).toBe(201);
    expect(await h.database.db.select().from(pairEvents).where(eq(pairEvents.fromUserId, b.userId))).toEqual([]);
    expect(await h.database.db.select().from(pairParticipants).where(eq(pairParticipants.userId, b.userId))).toEqual([]);
    cb.send(turn(1, 'air_squat', 10, null));
    expect(await cb.closed()).toBe(4403);
    // Ibrahima's withdrawal erases the sessions he hosts with their relay.
    expect((await consent(a, 'partner_sharing', 'withdrawn')).statusCode).toBe(201);
    expect(await h.database.db.select().from(pairSessions)).toEqual([]);
    ca.close();
  }, 30_000);

  it('a leave and its defensibility events commit together or not at all (ADR-009): a failed log write stores neither, and the resend then stores both', async () => {
    const a = await ready();
    const b = await ready();
    const { pairSessionId, joinCode } = (await create(a)).json() as { pairSessionId: string; joinCode: string };
    await join(b, joinCode);
    const cb = new Client(b, pairSessionId);
    await cb.open();
    cb.hello();
    await cb.until(isWelcome);
    await h.database.db.execute(sql`CREATE OR REPLACE FUNCTION test_fail_pair_left() RETURNS trigger AS $$ BEGIN IF NEW.type = 'pair.partner_left' THEN RAISE EXCEPTION 'injected log failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.database.db.execute(sql`CREATE TRIGGER test_fail_pair_left BEFORE INSERT ON defensibility_events FOR EACH ROW EXECUTE FUNCTION test_fail_pair_left()`);
    const id = randomUUID();
    try {
      cb.send({ type: 'left' }, id);
      expect((await cb.until(isError)).code).toBe('pair.unavailable');
      expect(await h.database.db.select().from(pairEvents)).toEqual([]);
      expect((await chain(b)).map((e) => e.type)).not.toContain('pair.left');
    } finally {
      await h.database.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_pair_left ON defensibility_events`);
      await h.database.db.execute(sql`DROP FUNCTION IF EXISTS test_fail_pair_left()`);
    }
    cb.send({ type: 'left' }, id);
    await cb.until(isEvent(id));
    expect(await h.database.db.select().from(pairEvents)).toHaveLength(1);
    expect((await chain(b)).map((e) => e.type)).toContain('pair.left');
    expect((await chain(a)).map((e) => e.type)).toContain('pair.partner_left');
    cb.close();
  }, 30_000);
});
