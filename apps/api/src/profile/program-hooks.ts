import { isDeepStrictEqual } from 'node:util';
import { ENGINE_VERSION, PROGRAM_RULES_VERSION, createEngineContext, decideReflow, fixedClock } from '@fitadapt/engine';
import { generateProgram } from '@fitadapt/exercise-library';
import { EquipmentProfileSchema, PROFILE_COLLECTIONS, PROGRAM_COLLECTIONS, ProgramRecordSchema, ReflowRecordSchema, orderChain, type ProgramRecord, type ReflowRecord, type SafetyProfile } from '@fitadapt/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { syncChanges } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import type { PgServerTx } from '../sync/pg-store.js';

/**
 * M08 on the server (ADR-015): a synced program must be exactly what the
 * engine derives from the inputs it names (same engine and rules version),
 * for the user's latest stored SafetyProfile (re-derived from the screening
 * answers by packages/safety, never re-implemented) and the equipment
 * profiles the user actually stored; a reflow must be what the engine decides
 * for that program after the reflows already stored. The defensibility events
 * are written in the sync transaction (ADR-009).
 */

async function latestRows(db: Database, userId: string, collection: string) {
  return db
    .select({ recordId: syncChanges.recordId, op: syncChanges.op, data: syncChanges.data, revision: syncChanges.revision })
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection)))
    .orderBy(asc(syncChanges.revision));
}

/** The latest stored state of an equipment profile (null if never stored or deleted). */
async function storedEquipmentProfile(db: Database, userId: string, recordId: string) {
  const [row] = await db
    .select({ op: syncChanges.op, data: syncChanges.data })
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, PROFILE_COLLECTIONS.equipmentProfiles), eq(syncChanges.recordId, recordId)))
    .orderBy(desc(syncChanges.revision))
    .limit(1);
  if (!row || row.op === 'delete') return null;
  const parsed = EquipmentProfileSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

export async function validateProgram(db: Database, userId: string, data: unknown, latestProfile: SafetyProfile): Promise<string | null> {
  const parsed = ProgramRecordSchema.safeParse(data);
  if (!parsed.success) return 'program.invalid';
  const { input, program } = parsed.data;
  if (program.engineVersion !== ENGINE_VERSION || program.rulesVersion !== PROGRAM_RULES_VERSION) return 'program.engine_version_unsupported';
  // S1/S7: the program must be built on the SafetyProfile the server derives from the latest stored screening.
  if (!isDeepStrictEqual(input.safetyProfile, latestProfile)) return 'program.safety_profile_mismatch';
  // M01: every place must be one of the user's stored equipment profiles, with the same equipment.
  for (const place of input.locations) {
    const stored = await storedEquipmentProfile(db, userId, place.equipmentProfileId);
    if (!stored || stored.location !== place.location || !sameSet(stored.equipment, place.equipment)) return 'program.equipment_mismatch';
  }
  let expected;
  try {
    expected = generateProgram(input, createEngineContext({ clock: fixedClock(Date.parse(program.generatedAt)), seed: program.seed }));
  } catch {
    return 'program.invalid';
  }
  if (expected.status !== 'ok') return 'program.not_allowed';
  if (!isDeepStrictEqual(expected.program, program)) return 'program.mismatch';
  return null;
}

async function storedProgram(db: Database, userId: string, programId: string): Promise<ProgramRecord | null> {
  for (const row of await latestRows(db, userId, PROGRAM_COLLECTIONS.programs)) {
    const parsed = ProgramRecordSchema.safeParse(row.data);
    if (parsed.success && parsed.data.program.programId === programId) return parsed.data;
  }
  return null;
}

/**
 * The reflows of a program in the order the device replays them (ADR-023):
 * the `supersedes` chain, then `decidedAt` for reflows stored before it —
 * never the push order, which differs when a device was offline.
 */
export function orderedReflows(rows: readonly { recordId: string; op: string; data: unknown }[], programId: string): ReflowRecord[] {
  const list = rows.flatMap((row) => {
    if (row.op === 'delete') return [];
    const parsed = ReflowRecordSchema.safeParse(row.data);
    return parsed.success && parsed.data.programId === programId ? [{ id: row.recordId, data: parsed.data }] : [];
  });
  return orderChain(list, (r) => ({ id: r.id, supersedes: r.data.supersedes, at: r.data.decidedAt })).ordered.map((r) => r.data);
}

async function storedReflows(db: Database, userId: string, programId: string): Promise<ReflowRecord[]> {
  return orderedReflows(await latestRows(db, userId, PROGRAM_COLLECTIONS.reflows), programId);
}

export async function validateReflow(db: Database, userId: string, data: unknown): Promise<string | null> {
  const parsed = ReflowRecordSchema.safeParse(data);
  if (!parsed.success) return 'program.reflow_invalid';
  const record = parsed.data;
  if (record.engineVersion !== ENGINE_VERSION) return 'program.engine_version_unsupported';
  const stored = await storedProgram(db, userId, record.programId);
  if (!stored) return 'program.reflow_unknown_program';
  const decision = decideReflow(stored.program, await storedReflows(db, userId, record.programId), record.sessionId, record.reportedOn);
  if (decision.status !== 'ok') return 'program.reflow_not_applicable';
  if (!isDeepStrictEqual(decision.outcome, record.outcome) || !isDeepStrictEqual([...decision.reasonCodes], record.reasonCodes)) return 'program.reflow_mismatch';
  return null;
}

/** S1 gates the program switched on, from its reason codes (the engine emits them with the matching safety events). */
function programSafetyEvents(record: ProgramRecord) {
  const events: { invariant: 'S1'; reasonCode: string; action: 'capped' }[] = [];
  if (record.program.reasonCodes.includes('program.conditioning.intervals_not_allowed')) events.push({ invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed', action: 'capped' });
  if (record.program.reasonCodes.includes('program.rpe.s1_capped')) events.push({ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped' });
  return events;
}

/** In the sync transaction: the program's (or reflow's) defensibility events commit with the record, or neither does. */
export async function onProgramApplied(legal: LegalService, userId: string, collection: string, data: unknown, tx: PgServerTx): Promise<void> {
  if (collection === PROGRAM_COLLECTIONS.programs) {
    const record = ProgramRecordSchema.parse(data);
    const { program } = record;
    await legal.recordProgramGenerated(userId, { programId: program.programId, engineVersion: program.engineVersion, rulesVersion: program.rulesVersion, templateId: program.templateId, reasonCodes: program.reasonCodes }, tx.db);
    for (const event of programSafetyEvents(record)) await legal.recordSafetyEvent(userId, { ...event, engineVersion: program.engineVersion }, tx.db);
  } else if (collection === PROGRAM_COLLECTIONS.reflows) {
    const record = ReflowRecordSchema.parse(data);
    await legal.recordProgramReflowed(userId, { programId: record.programId, sessionId: record.sessionId, outcome: record.outcome.kind, engineVersion: record.engineVersion }, tx.db);
  }
}
