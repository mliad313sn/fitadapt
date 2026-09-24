import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { PairClientMessageSchema, type PairServerMessage, type ParticipantSlot } from '@fitadapt/shared';
import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { WebSocketServer, type WebSocket } from 'ws';
import { ApiError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import { pairValue } from '../config/pair.config.js';
import type { Participation, PairService, RelayedEvent } from './service.js';

export const PAIR_WS_PATH = '/v1/pair/ws';

/** Live counters of the relay, for tests and operations (no personal data). */
export interface PairSocketStats {
  /** Pair sessions with at least one open socket. */
  rooms(): number;
  /** Connections that have not said hello yet. */
  pending(): number;
}

declare module 'fastify' {
  interface FastifyInstance {
    pairSockets: PairSocketStats;
  }
}

/**
 * The client address of an upgrade request, with the same trust rule as
 * Fastify's `trustProxy` hop count (API-8): the address `hops` steps back
 * from the socket along X-Forwarded-For.
 */
export function clientAddress(request: IncomingMessage, hops: number): string {
  const socketAddress = request.socket.remoteAddress ?? 'unknown';
  if (hops <= 0) return socketAddress;
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((a) => a.trim()).filter(Boolean);
  const chain = [socketAddress, ...forwarded.reverse()];
  return chain[Math.min(hops, chain.length - 1)]!;
}

/**
 * The multi-device Fair Pair relay over WebSocket (ADR-001: WebSocket only
 * for multi-device Fair Pair; ADR-021). The access token travels in the first
 * message (`hello`), never in the URL, so no token or query reaches a log.
 * Messages are never logged. The server keeps only who is connected; it
 * holds no timer (rests and turns are timed on the devices) and nothing in
 * Redis. Every event is stored before it is relayed, so a device that
 * reconnects with its last seq receives exactly what it missed.
 *
 * API-6: the sign-in session is re-checked on every message, on a timer and
 * when the access token expires, and at once when this instance revokes it
 * (logout, refresh-token reuse): a revoked or expired session closes the
 * socket (4401). API-9: connections waiting for their hello are capped per
 * process and per address, each socket's queue and message rate are bounded
 * (4429), and a pair session's room is freed when its last socket closes.
 *
 * Close codes: 4400 invalid message, 4401 no or bad hello, or the sign-in
 * session ended, 4403 not allowed (not a participant, or the partner_sharing
 * consent was withdrawn), 4429 too many messages.
 */
export function attachPairSockets(app: FastifyInstance, auth: AuthService, pair: PairService, options: { trustProxyHops?: number; now?: () => Date } = {}): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: pairValue('maxMessageBytes') });
  const now = options.now ?? (() => new Date());
  /** pair session → slot → open sockets of that participant (one person may reconnect before the old socket closes). */
  const rooms = new Map<string, Map<ParticipantSlot, Set<WebSocket>>>();
  /** client address → connections waiting for their hello. */
  const pendingByAddress = new Map<string, number>();
  let pendingTotal = 0;
  /** sign-in session → its open, authenticated sockets (closed at once on revocation). */
  const bySession = new Map<string, Set<WebSocket>>();

  app.decorate('pairSockets', { rooms: () => rooms.size, pending: () => pendingTotal } satisfies PairSocketStats);
  const unsubscribe = auth.onSessionRevoked((sessionId) => {
    for (const ws of bySession.get(sessionId) ?? []) ws.close(4401, 'session');
  });

  const send = (ws: WebSocket, message: PairServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const socketsOf = (sessionId: string, slot: ParticipantSlot) => rooms.get(sessionId)?.get(slot) ?? new Set<WebSocket>();
  const other = (slot: ParticipantSlot): ParticipantSlot => (slot === 'a' ? 'b' : 'a');
  const relay = (ws: WebSocket, e: RelayedEvent) => send(ws, { type: 'event', seq: e.seq, from: e.from, clientEventId: e.clientEventId, event: e.event });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== PAIR_WS_PATH) {
      socket.destroy();
      return;
    }
    // API-9: unauthenticated connections are capped before any WebSocket state is built.
    const address = clientAddress(request, options.trustProxyHops ?? 0);
    if (pendingTotal >= pairValue('maxPendingHellos') || (pendingByAddress.get(address) ?? 0) >= pairValue('maxPendingHellosPerIp')) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => handle(ws, address));
  };
  app.server.on('upgrade', onUpgrade);
  app.addHook('onClose', async () => {
    unsubscribe();
    app.server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  function handle(ws: WebSocket, address: string) {
    let joined: { sessionId: string; me: Participation; token: string; authSessionId: string } | null = null;
    let pending = true;
    pendingTotal += 1;
    pendingByAddress.set(address, (pendingByAddress.get(address) ?? 0) + 1);
    const leavePending = () => {
      if (!pending) return;
      pending = false;
      pendingTotal -= 1;
      const n = (pendingByAddress.get(address) ?? 1) - 1;
      if (n <= 0) pendingByAddress.delete(address);
      else pendingByAddress.set(address, n);
    };
    // A connection that does not say hello in time is closed (a connection limit, not training timing).
    const helloTimer = setTimeout(() => ws.close(4401, 'hello'), pairValue('helloTimeoutMs'));
    let recheckTimer: NodeJS.Timeout | undefined;
    let expiryTimer: NodeJS.Timeout | undefined;
    // Messages are handled one after the other, in the order they arrive; the queue and the rate are bounded.
    let queue = Promise.resolve();
    let queued = 0;
    let windowStart = Date.now();
    let inWindow = 0;

    ws.on('message', (data) => {
      const t = Date.now();
      if (t - windowStart >= pairValue('socketRateWindowMs')) {
        windowStart = t;
        inWindow = 0;
      }
      inWindow += 1;
      if (queued >= pairValue('maxQueuedMessagesPerSocket') || inWindow > pairValue('messagesPerSocketPerWindow')) {
        ws.close(4429, 'rate');
        return;
      }
      queued += 1;
      queue = queue
        .then(() => (ws.readyState === ws.OPEN ? onMessage(String(data)) : undefined))
        .catch(() => undefined)
        .finally(() => {
          queued -= 1;
        });
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(recheckTimer);
      clearTimeout(expiryTimer);
      leavePending();
      if (!joined) return;
      const mineBySession = bySession.get(joined.authSessionId);
      mineBySession?.delete(ws);
      if (mineBySession?.size === 0) bySession.delete(joined.authSessionId);
      const room = rooms.get(joined.sessionId);
      const mine = room?.get(joined.me.slot);
      mine?.delete(ws);
      if (room && mine?.size === 0) {
        room.delete(joined.me.slot);
        for (const peer of socketsOf(joined.sessionId, other(joined.me.slot))) send(peer, { type: 'presence', slot: joined.me.slot, connected: false });
      }
      // API-9: a room with no socket left is freed.
      if (room && room.size === 0) rooms.delete(joined.sessionId);
    });

    const fail = (error: unknown, close?: number) => {
      // null: a message that is not valid; an unexpected failure (e.g. the database) says only that it did not go through.
      const code = error === null ? 'pair.invalid_message' : error instanceof ApiError ? error.code : 'pair.unavailable';
      send(ws, { type: 'error', code: /^[a-z0-9_.]{1,80}$/.test(code) ? code : 'pair.error' });
      if (close) ws.close(close, 'error');
    };

    /** API-6: the sign-in session behind this socket is still valid (not revoked, not expired); otherwise 4401. */
    async function sessionValid(): Promise<boolean> {
      if (!joined) return false;
      try {
        await auth.authenticate(joined.token);
        return true;
      } catch (error) {
        fail(error instanceof ApiError ? error : null, 4401);
        return false;
      }
    }

    async function onMessage(raw: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail(null, 4400);
      }
      const message = PairClientMessageSchema.safeParse(parsed);
      if (!message.success) return fail(null, joined ? undefined : 4400);
      if (message.data.type === 'hello') {
        if (joined) return fail(null);
        let claims: Awaited<ReturnType<AuthService['authenticate']>>;
        try {
          claims = await auth.authenticate(message.data.token);
        } catch (error) {
          return fail(error, 4401);
        }
        try {
          const { me, all, challenge } = await pair.connect(claims.userId, message.data.pairSessionId);
          joined = { sessionId: message.data.pairSessionId, me, token: message.data.token, authSessionId: claims.sessionId };
          clearTimeout(helloTimer);
          leavePending();
          const sockets = bySession.get(claims.sessionId) ?? new Set<WebSocket>();
          bySession.set(claims.sessionId, sockets);
          sockets.add(ws);
          // API-6: re-check the sign-in session on a timer, and close when the access token expires.
          recheckTimer = setInterval(() => void sessionValid(), pairValue('sessionRecheckIntervalMs'));
          const exp = decodeJwt(message.data.token).exp;
          if (typeof exp === 'number') expiryTimer = setTimeout(() => ws.close(4401, 'expired'), Math.max(0, exp * 1000 - now().getTime()));
          const room = rooms.get(joined.sessionId) ?? new Map<ParticipantSlot, Set<WebSocket>>();
          rooms.set(joined.sessionId, room);
          const mine = room.get(me.slot) ?? new Set<WebSocket>();
          room.set(me.slot, mine);
          mine.add(ws);
          const { events, head } = await pair.since(joined.sessionId, me, message.data.lastSeq, all);
          send(ws, { type: 'welcome', slot: me.slot, seq: head, challenge, participants: all.map((p) => ({ slot: p.slot, displayName: p.displayName, connected: socketsOf(joined!.sessionId, p.slot).size > 0 })) });
          for (const e of events) relay(ws, e);
          for (const peer of socketsOf(joined.sessionId, other(me.slot))) send(peer, { type: 'presence', slot: me.slot, connected: true });
        } catch (error) {
          return fail(error, 4403);
        }
        return;
      }
      if (!joined) return fail(null, 4401);
      // API-6: every event is sent under a sign-in session that is still valid.
      if (!(await sessionValid())) return;
      try {
        const { relayed, fresh } = await pair.append(joined.me.userId, joined.sessionId, message.data.clientEventId, message.data.event);
        // The sender gets its own event back with its seq (the acknowledgement); a resend is only acknowledged.
        relay(ws, relayed);
        if (!fresh) return;
        const all = await pair.participants(joined.sessionId);
        const partner = other(joined.me.slot);
        const projected = pair.project(relayed, partner, all);
        if (projected) for (const peer of socketsOf(joined.sessionId, partner)) relay(peer, projected);
        // The sender's other sockets (a reconnect in progress) see it too.
        for (const own of socketsOf(joined.sessionId, joined.me.slot)) if (own !== ws) relay(own, relayed);
      } catch (error) {
        // A withdrawn consent (which also erases the participation) ends the connection: nothing more is shared.
        fail(error, error instanceof ApiError && (error.code === 'pair.consent_required' || error.code === 'pair.not_participant') ? 4403 : undefined);
      }
    }
  }
}
