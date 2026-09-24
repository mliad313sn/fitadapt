import {
  addDays,
  buildSessionHistory,
  createEngineContext,
  fixedClock,
  programDay,
  programSessionContext,
  type GenerateSessionInput,
  type StoredSetLog,
} from '@fitadapt/engine';
import { MilestoneForecastSchema, type ExecutionLog, type WorkoutSessionRecord } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { PERSONA_INPUTS } from './__fixtures__/personas.js';
import { PERSONA_SESSIONS } from './__fixtures__/session-personas.js';
import { buildCapacityModel, generateProgram, generateSession, ladderLookup, MILESTONES, MILESTONE_IDS, milestonesFor } from './index.js';

/**
 * M04 on the real M06 seed: P2 (Awa, "tell me roughly when I'll get my first
 * pull-up") trains her M08 program through the M02 generator for twenty weeks;
 * she reaches a little more of each set's target every week (fictional
 * performance). The dashboard's milestone reads that history and forecasts
 * the first strict pull-up as a date range with a confidence. Progression
 * stays the engine's: M04 only reads the history.
 */
const PROGRAM_NOW = Date.parse('2026-09-24T08:00:00.000Z');
const dateOf = (iso: string) => iso.slice(0, 10);

function simulateP2(days: number) {
  const input = PERSONA_INPUTS.P2;
  const p = PERSONA_SESSIONS.P2;
  const result = generateProgram(input, createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed: 2 }));
  if (result.status !== 'ok') throw new Error(result.reasonCodes.join());
  const program = result.program;
  const capacity = buildCapacityModel(p.assessment);
  const records: WorkoutSessionRecord[] = [];
  const setLogs: StoredSetLog[] = [];
  const events: ExecutionLog[] = [];
  let logId = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays(program.startDate, d);
    const clockMs = Date.parse(`${date}T07:00:00.000Z`);
    const day = programDay(program, [], date);
    for (const session of day?.sessions ?? []) {
      const place = input.locations.find((l) => l.equipmentProfileId === session.equipmentProfileId)!;
      const genInput: GenerateSessionInput = {
        safetyProfile: input.safetyProfile,
        equipment: place.equipment,
        equipmentLoads: p.loads[place.equipmentProfileId]!,
        equipmentProfileId: place.equipmentProfileId,
        minutesAvailable: input.minutesPerSession,
        jointFlags: p.jointFlags,
        capacity,
        programSession: programSessionContext(day!, session),
        history: buildSessionHistory(records, setLogs, events),
        bodyweightKg: p.bodyweightKg,
        heightCm: p.heightCm,
        birthDate: p.birthDate,
        experience: p.experience,
        intensityLock: { locked: false, since: null },
      };
      const r = generateSession(genInput, createEngineContext({ clock: fixedClock(clockMs), seed: 2000 + d }));
      if (r.status !== 'ok') throw new Error(`${date}: ${r.reasonCodes.join()}`);
      records.push({ schemaVersion: 1, input: genInput as WorkoutSessionRecord['input'], plan: r.plan, safetyEvents: [...r.safetyEvents], startedAt: new Date(clockMs + 60_000).toISOString(), jurisdiction: 'GB', firstWorkout: records.length === 0 });
      const week = Math.floor(d / 7);
      r.plan.exercises.forEach((e, i) =>
        e.sets.forEach((s) => {
          // A little more of the target each week: the bottom of the range in week 1, the top from week 4.
          const reps = s.target.kind === 'reps' ? Math.min(s.target.max, s.target.min + week) : null;
          setLogs.push({
            id: `00000000-0000-4000-8000-${String(++logId).padStart(12, '0')}`,
            data: { schemaVersion: 1, planId: r.plan.planId, exerciseIndex: i, exerciseId: e.exerciseId, set: { index: s.index, status: 'done', reps, seconds: s.target.kind === 'hold' ? s.target.seconds : null, loadKg: s.loadKg ?? (e.sets[0]!.reasonCodes.includes('session.load.self_select_light') ? p.chosenKg : null), rir: s.targetRir }, loggedAt: new Date(clockMs + 120_000).toISOString(), correctionOf: null },
          });
        }),
      );
      events.push({ kind: 'ended', planId: r.plan.planId, reason: 'completed', at: new Date(clockMs + 3_600_000).toISOString() });
    }
  }
  return { history: buildSessionHistory(records, setLogs, events), startDate: program.startDate };
}

describe('M04 milestones on the M06 seed', () => {
  it('every milestone path is a seed ladder toward a target on it; the rung lookup follows the seed', () => {
    for (const id of MILESTONE_IDS) {
      const m = MILESTONES[id];
      expect(m.steps.some((s) => s.includes(m.targetExerciseId)), id).toBe(true);
      expect(m.steps.at(-1)).toContain(m.targetExerciseId);
    }
    expect(ladderLookup('pull_up')).toEqual({ ladderId: 'pull', rung: 6 });
    expect(ladderLookup('band_assisted_pull_up')).toEqual({ ladderId: 'pull', rung: 4 });
    expect(ladderLookup('not_an_exercise')).toBeNull();
    expect(MILESTONES.first_pull_up.steps[4]).toEqual(['band_assisted_pull_up', 'assisted_pull_up_machine']);
  });

  it('P2 (Awa): after twenty weeks of her program, the first strict pull-up is forecast as a date range with a confidence — or shown as reached', () => {
    const { history, startDate } = simulateP2(140);
    const today = addDays(startDate, 139);
    const views = milestonesFor(history, dateOf, today);
    const pullUp = views.find((v) => v.id === 'first_pull_up');
    expect(pullUp, JSON.stringify(views.map((v) => v.id))).toBeDefined();
    const f = pullUp!.forecast;
    expect(MilestoneForecastSchema.parse(f)).toEqual(f);
    expect(f.estimate).toBe(true);
    expect(['forecast', 'achieved']).toContain(f.status);
    if (f.status === 'forecast') {
      expect(f.earliest! > today).toBe(true);
      expect(f.latest! >= f.earliest!).toBe(true);
      expect(f.confidence).not.toBeNull();
    }
    // Only paths she trained on are shown: no muscle-up or pistol for a beginner.
    expect(views.map((v) => v.id)).not.toContain('first_bar_muscle_up');
    expect(f.status).toBe('forecast');
  });

  it('P2 after eight weeks (still on dead hangs): no date is promised — the pull-up is more than the forecast horizon away on the current trend', () => {
    const { history, startDate } = simulateP2(56);
    const today = addDays(startDate, 55);
    const f = milestonesFor(history, dateOf, today).find((v) => v.id === 'first_pull_up')!.forecast;
    expect(f).toMatchObject({ status: 'beyond_horizon', estimate: true, earliest: null, latest: null });
  });

  it('with no history, nothing is shown', () => {
    expect(milestonesFor([], dateOf, '2026-09-24')).toEqual([]);
  });
});
