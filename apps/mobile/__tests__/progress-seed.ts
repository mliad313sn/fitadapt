import { addDays, createEngineContext, ENGINE_VERSION, SESSION_RULES_VERSION } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, generateProgram, UNRESTRICTED_SAFETY_PROFILE } from '@fitadapt/exercise-library';
import { SCREENING_QUESTION_IDS, type ExecutionLog, type IsoDate, type MovementPattern, type PlannedExercise, type SetLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { DrizzleLocalStore, InMemoryTransport, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLegalStore } from '../src/legal/legal-store';
import { createGuardrailInbox } from '../src/nutrition/guardrail-port';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore } from '../src/profile/profile-store';
import { selectSafetyProfile } from '../src/profile/selectors';
import { programInputFrom } from '../src/program/program-input';
import { createProgressStore } from '../src/progress/progress-store';
import { SqliteKeyValueStore } from '../src/storage/app-state';
import { MemoryDeviceKeyStore } from '../src/storage/device-keys';
import { ENCRYPTED_DATABASE_NAME, openEncryptedDatabase } from '../src/storage/encrypted-db';
import { expoSqliteDouble } from './sqlcipher-double';

/**
 * Test-only: a fictional reference user (P2-like: Awa, 32, beginner, home and
 * gym, three sessions a week, working toward a first strict pull-up) with up
 * to two years of logged data on one device: sessions (the executed
 * prescription), every set, the end of each session, daily weigh-ins and
 * monthly measurements. Records are schema-valid and inserted through the
 * sync client, as the app writes them. Not shipped.
 *
 * The device's database is the app's encrypted one: `openEncryptedDatabase`
 * over the SQLCipher-4-compatible stand-in (sqlcipher-double.ts), writing a
 * real file, with Drizzle and the sync store on top as in the app — so the
 * dashboard tests read their two years of data from an encrypted file, and
 * `databasePath` lets a test inspect its bytes. Call `closeReferenceDevices()`
 * after each test.
 */
export const REFERENCE_PROFILE = { name: 'P2 (Awa, fictional)', sessionsPerWeek: 3, weeks: 104, startWeightKg: 60 } as const;

const open: { close(): void }[] = [];

/** Closes every reference device's database and deletes its directory. */
export function closeReferenceDevices() {
  for (const d of open.splice(0)) d.close();
}

export function referenceDevice() {
  const directory = mkdtempSync(join(tmpdir(), 'm04-ref-'));
  const driver = expoSqliteDouble(directory);
  const keys = new MemoryDeviceKeyStore();
  const { db: raw } = openEncryptedDatabase({ driver, keys, randomBytes: (n) => new Uint8Array(randomBytes(n)) });
  // Test speed only (thousands of seeded records): no fsync per commit. The pages are encrypted all the same.
  raw.execSync('PRAGMA synchronous = OFF;');
  const db = drizzle(raw as unknown as SQLiteDatabase);
  const local = new DrizzleLocalStore(db);
  local.migrate();
  open.push({
    close: () => {
      driver.closeAll();
      rmSync(directory, { recursive: true, force: true });
    },
  });
  const client = new SyncClient({ deviceId: randomUUID(), store: local, transport: new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), 'user-1'), newId: randomUUID });
  const kv = new SqliteKeyValueStore(db);
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB' });
  const profile = createProfileStore({ sync: client, kv, now: () => new Date() });
  const legal = createLegalStore({ kv, newId: randomUUID, now: () => new Date(), jurisdiction: 'GB' });
  const nutrition = createGuardrailInbox(kv);
  const progress = createProgressStore({ sync: client, kv, now: () => new Date(), nutrition });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('gym', [...EQUIPMENT_PRESETS.full_gym]);
  profile.getState().updateDraft({
    primaryGoal: 'calisthenics_skills',
    experience: 'beginner',
    schedule: { daysPerWeek: 3, minutesPerSession: 45, preferredTimes: [], remindersEnabled: false },
    birthDate: { year: 1994, month: 3, day: 14 },
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])),
  });
  profile.getState().saveProfileFromDraft();
  profile.getState().saveScreening('onboarding', { year: 2024, month: 9, day: 23 });
  profile.getState().completeOnboarding();
  for (const doc of ['terms', 'privacy', 'exercise_risk'] as const) legal.getState().accept(doc, 'en');
  return { client, kv, consents, profile, legal, nutrition, progress, db, keys, databasePath: join(directory, ENCRYPTED_DATABASE_NAME) };
}

export type ReferenceDevice = ReturnType<typeof referenceDevice>;

const PULL_PATH: readonly { exerciseId: string; hold: boolean }[] = [
  { exerciseId: 'dead_hang', hold: true },
  { exerciseId: 'scapular_pull_up', hold: false },
  { exerciseId: 'inverted_row_incline', hold: false },
  { exerciseId: 'inverted_row', hold: false },
  { exerciseId: 'band_assisted_pull_up', hold: false },
  { exerciseId: 'negative_pull_up', hold: false },
  { exerciseId: 'pull_up', hold: false },
];

function planned(slot: MovementPattern, exerciseId: string, ladderId: string | null, target: PlannedExercise['sets'][number]['target'], loadKg: number | null): PlannedExercise {
  const sets = [1, 2, 3].map((index) => ({ index, target, loadKg, targetRir: 2, restSeconds: 90, tempo: null, reasonCodes: ['session.program.from_program'], reasonParams: {} }));
  return { slot, role: 'primary', exerciseId, ladderId, supersetGroup: null, sets, reasonCodes: ['session.exercise.continued'] };
}

export interface SeedOptions {
  /** The last day of data (the dashboard's "today"). */
  readonly endDate: IsoDate;
  readonly weeks?: number;
  /** The week the first strict pull-up is done (default: never within the data). */
  readonly pullUpWeek?: number;
  /** Weekly weight change in % for the last `lossWeeks` weeks (default: stable weight). */
  readonly lossPercentPerWeek?: number;
  readonly lossWeeks?: number;
  readonly withProgram?: boolean;
}

/** Inserts the dataset into the device's sync store and reloads the stores. Returns the record counts. */
export function seedReferenceData(d: ReferenceDevice, { endDate, weeks = REFERENCE_PROFILE.weeks, pullUpWeek = Infinity, lossPercentPerWeek = 0, lossWeeks = 0, withProgram = true }: SeedOptions) {
  const start = addDays(endDate, -7 * weeks + 1);
  const monday = addDays(start, (8 - new Date(`${start}T00:00:00Z`).getUTCDay()) % 7);
  let sessions = 0;
  let sets = 0;
  for (let w = 0; w < weeks; w += 1) {
    for (const offset of [0, 2, 4]) {
      const date = addDays(monday, w * 7 + offset);
      if (date > endDate) continue;
      const at = `${date}T07:00:00.000Z`;
      const planId = randomUUID();
      const rungIndex = w >= pullUpWeek ? 6 : Math.min(5, Math.floor((w / Math.max(1, Math.min(pullUpWeek, weeks))) * 6));
      const rung = PULL_PATH[rungIndex]!;
      const progressInRung = (w % 12) / 12;
      const exercises: PlannedExercise[] = [
        planned('vertical_pull', rung.exerciseId, 'pull', rung.hold ? { kind: 'hold', seconds: 20 + Math.round(progressInRung * 30) } : { kind: 'reps', min: 3, max: 8 }, null),
        planned('squat', 'goblet_squat', 'squat', { kind: 'reps', min: 8, max: 12 }, 8 + Math.floor(w / 6) * 2),
        planned('horizontal_push', 'push_up', 'push', { kind: 'reps', min: 6, max: 12 }, null),
        planned('core', 'front_plank', 'plank', { kind: 'hold', seconds: Math.min(60, 20 + Math.floor(w / 3)) }, null),
      ];
      const plan = {
        planId,
        kind: 'program_session' as const,
        engineVersion: ENGINE_VERSION,
        rulesVersion: SESSION_RULES_VERSION,
        generatedAt: at,
        seed: w,
        capacityAssessedAt: null,
        program: null,
        equipmentProfileId: null,
        targetRir: 2,
        minutesAvailable: 45,
        estimatedMinutes: 40,
        warmUp: { minutes: 8, minimumMinutes: 5 },
        conditioning: null,
        exercises,
        reasonCodes: ['session.program.from_program'],
      };
      const record: WorkoutSessionRecord = { schemaVersion: 1, input: { safetyProfile: UNRESTRICTED_SAFETY_PROFILE, equipment: [...EQUIPMENT_PRESETS.full_gym], minutesAvailable: 45 }, plan, safetyEvents: [], startedAt: at, jurisdiction: 'GB', firstWorkout: sessions === 0 };
      d.client.insert('workout_sessions', record);
      exercises.forEach((ex, exerciseIndex) =>
        ex.sets.forEach((s) => {
          const reps = s.target.kind === 'reps' ? Math.min(s.target.max, s.target.min + Math.round(progressInRung * 5)) : null;
          const log: SetLog = { schemaVersion: 1, planId, exerciseIndex, exerciseId: ex.exerciseId, set: { index: s.index, status: 'done', reps, seconds: s.target.kind === 'hold' ? s.target.seconds : null, loadKg: s.loadKg, rir: 2 }, loggedAt: at, correctionOf: null };
          d.client.insert('set_logs', log);
          sets += 1;
        }),
      );
      const ended: ExecutionLog = { kind: 'ended', planId, reason: 'completed', at: `${date}T08:00:00.000Z` };
      d.client.insert('execution_logs', ended);
      sessions += 1;
    }
  }
  // Daily weigh-ins (small day-to-day noise), then an optional steady loss for the last weeks.
  let weighIns = 0;
  const lossFrom = addDays(endDate, -7 * lossWeeks);
  for (let day = start; day <= endDate; day = addDays(day, 1)) {
    const noise = ((weighIns * 7919) % 11) / 20 - 0.25;
    const weeksLosing = day > lossFrom ? (new Date(`${day}T00:00:00Z`).getTime() - new Date(`${lossFrom}T00:00:00Z`).getTime()) / (7 * 86_400_000) : 0;
    const kg = REFERENCE_PROFILE.startWeightKg * (1 + lossPercentPerWeek / 100) ** weeksLosing + (lossPercentPerWeek === 0 ? noise : 0);
    d.client.insert('body_metrics', { schemaVersion: 1, kind: 'weight', value: Math.round(kg * 10) / 10, measuredOn: day, at: `${day}T06:30:00.000Z`, correctionOf: null });
    weighIns += 1;
  }
  let measurements = 0;
  for (let m = 0; m * 28 < weeks * 7; m += 1) {
    const day = addDays(start, m * 28);
    d.client.insert('measurements', { schemaVersion: 1, site: 'waist', valueCm: 76 - m * 0.05, measuredOn: day, at: `${day}T06:35:00.000Z`, correctionOf: null });
    measurements += 1;
  }
  if (withProgram) {
    const state = d.profile.getState();
    const safety = selectSafetyProfile(state.screenings, d.consents.getState().records);
    const programStart = addDays(endDate, -27);
    const input = programInputFrom(state.profile!, safety, state.equipment, programStart, null);
    const result = generateProgram(input, createEngineContext({ clock: { now: () => Date.parse(`${programStart}T06:00:00.000Z`) }, seed: 7 }));
    if (result.status !== 'ok') throw new Error(result.reasonCodes.join());
    state.saveProgram({ reason: 'first', input, program: result.program });
  }
  d.profile.getState().reload();
  d.progress.getState().reload();
  return { sessions, sets, weighIns, measurements };
}
