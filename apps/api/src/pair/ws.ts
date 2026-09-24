import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { PairClientMessageSchema, type PairServerMessage, type ParticipantSlot } from '@fitadapt/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { ApiError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import { pairValue } from '../config/pair.config.js';
import type { Participation, PairService, RelayedEvent } from './service.js';

export const PAIR_WS_PATH = '/v1/pair/ws';

/**
 * The multi-device Fair Pair relay over WebSocket (ADR-001: WebSocket only
 * for multi-device Fair Pair; ADR-021). The access token travels in the first
 * message (`hello`), never in the URL, so no token or query reaches a log.
 * Messages are never logged. The server keeps only who is connected; it
 * holds no timer (rests and turns are timed on the devices) and nothing in
 * Redis. Every event is stored before it is relayed, so a device that
 * reconnects with its last seq receives exactly what it missed.
 *
 * Close codes: 4400 invalid message, 4401 no or bad hello, 4403 not allowed
 * (not a participant, or the partner_sharing consent was withdrawn).
 */
export function attachPairSockets(app: FastifyInstance, auth: AuthService, pair: PairService): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: pairValue('maxMessageBytes') });
  /** pair session → slot → open sockets of that participant (one person may reconnect before the old socket closes). */
  const rooms = new Map<string, Map<ParticipantSlot, Set<WebSocket>>>();

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
    wss.handleUpgrade(request, socket, head, (ws) => handle(ws));
  };
  app.server.on('upgrade', onUpgrade);
  app.addHook('onClose', async () => {
    app.server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  function handle(ws: WebSocket) {
    let joined: { sessionId: string; me: Participation } | null = null;
    // A connection that does not say hello in time is closed (a connection limit, not training timing).
    const helloTimer = setTimeout(() => ws.close(4401, 'hello'), pairValue('helloTimeoutMs'));
    // Messages are handled one after the other, in the order they arrive.
    let queue = Promise.resolve();

    ws.on('message', (data) => {
      queue = queue.then(() => onMessage(String(data))).catch(() => undefined);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!joined) return;
      const room = rooms.get(joined.sessionId);
      room?.get(joined.me.slot)?.delete(ws);
      if (room && socketsOf(joined.sessionId, joined.me.slot).size === 0) {
        for (const peer of socketsOf(joined.sessionId, other(joined.me.slot))) send(peer, { type: 'presence', slot: joined.me.slot, connected: false });
      }
    });

    const fail = (error: unknown, close?: number) => {
      // null: a message that is not valid; an unexpected failure (e.g. the database) says only that it did not go through.
      const code = error === null ? 'pair.invalid_message' : error instanceof ApiError ? error.code : 'pair.unavailable';
      send(ws, { type: 'error', code: /^[a-z0-9_.]{1,80}$/.test(code) ? code : 'pair.error' });
      if (close) ws.close(close, 'error');
    };

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
        let userId: string;
        try {
          userId = (await auth.authenticate(message.data.token)).userId;
        } catch (error) {
          return fail(error, 4401);
        }
        try {
          const { me, all, challenge } = await pair.connect(userId, message.data.pairSessionId);
          joined = { sessionId: message.data.pairSessionId, me };
          clearTimeout(helloTimer);
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
