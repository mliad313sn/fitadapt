# ADR-002 — Local-first data and sync

- Status: Accepted (M00)
- Date: 2026-09-23

## Context

Workout features must work in airplane mode (CLAUDE.md rule 6, decision C8). Users may train with two devices (Fair Pair, M09) or switch phones. Set logs are the most valuable data and must never be lost or overwritten. Each change must be pushed once, even when the network drops after the server has applied it.

## Decision

**Local-first.** The device database (expo-sqlite through Drizzle) is the source of truth for the UI. Every write goes, in **one local transaction**, to the record table and to an **outbox** (`sync_outbox`). Nothing waits for the network.

**Revision-based push/pull** (`packages/sync`, served by `apps/api` at `/v1/sync/push` and `/v1/sync/pull`):

- The server keeps an append-only **change log per user** with a **per-user revision** counter (1, 2, 3…). A per-user, transaction-scoped PostgreSQL advisory lock serialises pushes, so revisions are gap-free and committed in order. A pull can therefore never skip a change that commits later with a lower number (the classic problem with a global sequence).
- **Push** sends pending outbox items in creation order, at most one per record per round. A later edit of the same record waits until the earlier one is acknowledged, and is then rebased onto the new revision.
- **Idempotency.** Each mutation carries a client-generated `mutationId`. The server stores the outcome of every processed mutation (`sync_mutations`) in the same transaction as the change. A replay returns the original outcome (`duplicate`, same revision) and changes nothing. This covers the case where the response is lost after the server applied the change.
- **Pull** returns changes after the device's cursor, in revision order, in pages (`hasMore`). The cursor is stored locally (`sync_state`).
- **Reconnect.** The mobile app listens to NetInfo and calls `handleConnectivityChange(true)`, which pushes and then pulls. Concurrent sync calls share one run.

**Collection policies.**

| Collection | Policy | Conflict rule |
|---|---|---|
| `set_logs` | **Append-only**: only `insert` of a new client UUID; edits and deletes are rejected on the device and on the server. Corrections are new entries. | None possible: two devices always add distinct records, and both survive. |
| `preferences` (and future mutable collections) | Upsert/delete with `baseRevision` | If `baseRevision` does not match the server's current revision, the server answers `conflict` with its current state. **Server wins**: the device drops its pending edit, records it as `rejected` in the outbox, and applies the server copy. A remote change never overwrites an unsynced local edit during pull. |

Unknown collections are rejected. All payloads cross the boundary as zod-validated `@fitadapt/shared` schemas.

## Alternatives considered

- **CRDTs (Automerge, Yjs)**: strong merge semantics, but heavy for our data (mostly append-only logs plus a few settings) and harder to audit (L11 needs a readable change history).
- **Last-writer-wins by timestamp**: simple, but device clocks drift and a silent overwrite of a user edit is worse than an explicit, recorded conflict.
- **Hosted sync engines (PowerSync, ElectricSQL, Replicache)**: less code, but add a vendor and a licence to review, and constrain the server schema. Our needs are small enough to own.
- **WatermelonDB sync protocol**: close to this design but ties us to WatermelonDB instead of Drizzle, which we already use on the server.
- **Global sequence for revisions**: needs extra care (commit-order gaps) that the per-user lock avoids.

## Consequences

- Set logs cannot conflict, by construction. Tests prove that concurrent logs from two devices both survive, including a property test over random interleavings of three devices.
- Mutable records resolve deterministically and visibly (rejected outbox items keep `lastError: 'conflict'`). A later module can surface this to the user if needed.
- The server keeps every change (useful for the L11 defensibility file). Compaction and retention are decided with M17 (privacy).
- Pushes for one user are serialised. That is fine for per-person data; a very active shared object (e.g., a Fair Pair session on two phones) goes over WebSocket in M09, not through this path.
- Payload `data` may contain health data. It is never logged (redaction list, route-only request logs), is stored per user, and encryption at rest is part of M17.
