import { GOAL_IDS, ProgramSchema, SafetyProfileSchema, WEEKDAYS, type Program, type ProgramInput } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { profileFrom } from '../__fixtures__/library.js';
import { GYM, GYM_EQUIPMENT, HOME, HOME_EQUIPMENT, PARK, PROGRAM_LIBRARY, programInput } from '../__fixtures__/program.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { ENGINE_VERSION } from '../version.js';
import { MESOCYCLE_MAX_WEEKS, MESOCYCLE_MIN_WEEKS, PROGRAM_CONFIG, programValue } from './config.js';
import { addDays, daysBetween, fromDayNumber, mondayOf, mondayOnOrAfter, toDayNumber, weekdayOf } from './dates.js';
import { cappedRpe, generateProgram, intervalsAllowed, trainingAgeOf, type GenerateProgramResult } from './generate.js';
import { deloadOn, mesocycleOn, microcycleOn, programDay, reassessmentDateFor, scheduledDeloads } from './queries.js';
import { PROGRAM_REASON_CODES } from './reason-codes.js';
import { layoutValid, layoutWeek } from './schedule.js';
import { DEFAULT_TRAINING_DAYS, SESSION_TEMPLATES, WEEK_TEMPLATES, weekTemplate } from './templates.js';
import { allocateSets, contributions, primaryGroup, weeklyTarget } from './volume.js';

const NOW = Date.parse('2026-09-24T08:00:00.000Z');
const ctx = (seed = 3) => createEngineContext({ clock: fixedClock(NOW), seed });
const ok = (r: GenerateProgramResult): Program => {
  if (r.status !== 'ok') throw new Error(`unavailable: ${r.reasonCodes.join(', ')}`);
  return r.program;
};
const gen = (input: ProgramInput, seed = 3) => generateProgram(input, PROGRAM_LIBRARY, ctx(seed));

describe('calendar dates', () => {
  it('does calendar arithmetic without a clock', () => {
    expect(weekdayOf('2026-09-28')).toBe('mon');
    expect(weekdayOf('2026-10-04')).toBe('sun');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
    expect(mondayOnOrAfter('2026-09-24')).toBe('2026-09-28');
    expect(mondayOnOrAfter('2026-09-28')).toBe('2026-09-28');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28');
    expect(fromDayNumber(toDayNumber('2028-02-29'))).toBe('2028-02-29');
  });
});

describe('split selection (goal condition 2): 1 to 7 days a week for every goal', () => {
  const expected: Record<number, string[]> = {
    1: ['full_body'],
    2: ['full_body', 'full_body_conditioning', 'calisthenics_skill'],
    3: ['full_body', 'full_body_conditioning', 'calisthenics_skill'],
    4: ['upper_lower', 'full_body_conditioning', 'calisthenics_skill'],
    5: ['hybrid', 'upper_lower', 'full_body_conditioning', 'calisthenics_skill'],
    6: ['push_pull_legs', 'upper_lower', 'full_body_conditioning', 'calisthenics_skill'],
  };
  for (const goal of GOAL_IDS) {
    for (const days of [1, 2, 3, 4, 5, 6, 7]) {
      it(`${goal}, ${days} day(s) a week`, () => {
        const program = ok(gen(programInput({ goal, days })));
        const used = Math.min(days, 6);
        expect(program.daysPerWeek).toBe(used);
        expect(program.templateId).toBe(`${goal}.${used}d`);
        expect(expected[used]).toContain(program.split);
        expect(program.trainingDays).toEqual(DEFAULT_TRAINING_DAYS[used as 1]);
        if (days === 7) expect(program.reasonCodes).toContain('program.schedule.rest_day_kept');
        for (const week of program.microcycles) {
          expect(week.sessions.length).toBe(used);
          expect(new Set(week.sessions.map((s) => s.date)).size).toBe(used);
        }
        // Spec split rules for the strength goals; the others keep strength work and add their own sessions.
        const focuses = program.microcycles[0]!.sessions.map((s) => s.focus);
        if (goal === 'strength' || goal === 'muscle_gain') {
          if (used <= 3) expect(new Set(focuses)).toEqual(new Set(['full_body']));
          if (used === 4) expect(focuses.filter((f) => f === 'upper').length).toBe(2);
          if (used === 4) expect(focuses.filter((f) => f === 'lower').length).toBe(2);
          if (used >= 5) expect(focuses).toEqual(expect.arrayContaining(['push', 'pull', 'legs']));
        }
        if (goal === 'calisthenics_skills' && used >= 2) expect(focuses).toContain('skill');
        if (goal === 'fat_loss') expect(focuses.some((f) => f !== 'conditioning')).toBe(true);
        if (goal === 'fat_loss' || goal === 'endurance') expect(program.microcycles[0]!.aerobicMinutes).toBeGreaterThan(0);
        if (goal === 'general_health') expect(program.microcycles[0]!.sessions.some((s) => s.slots.some((x) => x.pattern === 'balance'))).toBe(true);
      });
    }
  }

  it('every template can be laid out on its default days without two hard sessions for one pattern on consecutive days', () => {
    for (const goal of GOAL_IDS) {
      for (const days of [1, 2, 3, 4, 5, 6] as const) {
        const tpl = WEEK_TEMPLATES[goal][days];
        const layout = layoutWeek(tpl.sessions, DEFAULT_TRAINING_DAYS[days], null);
        expect(layout, `${goal} ${days}`).not.toBeNull();
        expect(layoutValid(layout!.sessions)).toBe(true);
        expect(weekTemplate(goal, days)).toBe(tpl);
      }
    }
    expect(weekTemplate('strength', 0)).toBe(WEEK_TEMPLATES.strength[1]);
    expect(weekTemplate('strength', 9)).toBe(WEEK_TEMPLATES.strength[6]);
  });

  it('keeps the days the user chose when the rules allow it, and spreads them otherwise', () => {
    const chosen = ok(gen(programInput({ days: 3, trainingDays: ['tue', 'thu', 'sat'] })));
    expect(chosen.trainingDays).toEqual(['tue', 'thu', 'sat']);
    expect(chosen.reasonCodes).toContain('program.schedule.days_as_chosen');
    // Three full-body days in a row would train the same patterns on consecutive days.
    const packed = ok(gen(programInput({ days: 3, trainingDays: ['mon', 'tue', 'wed'] })));
    expect(packed.trainingDays).toEqual(['mon', 'wed', 'fri']);
    expect(packed.reasonCodes).toEqual(expect.arrayContaining(['program.schedule.days_adjusted', 'program.schedule.days_spread']));
    const wrongCount = ok(gen(programInput({ days: 3, trainingDays: ['mon', 'thu'] })));
    expect(wrongCount.reasonCodes).toContain('program.schedule.days_adjusted');
  });
});

describe('mesocycles and deloads (goal condition 6)', () => {
  it('schedules a deload every 4–6 weeks, as the last week of each mesocycle, and exposes it to M05', () => {
    for (const experience of ['none', 'returning', 'beginner', 'intermediate', 'advanced'] as const) {
      for (const goal of GOAL_IDS) {
        const program = ok(gen(programInput({ goal, experience })));
        const deloads = scheduledDeloads(program);
        expect(deloads.length).toBe(program.mesocycles.length);
        let previous = 0;
        for (const d of deloads) {
          expect(d.week - previous).toBeGreaterThanOrEqual(MESOCYCLE_MIN_WEEKS);
          expect(d.week - previous).toBeLessThanOrEqual(MESOCYCLE_MAX_WEEKS);
          previous = d.week;
          expect(d.volumeFactor).toBe(programValue('deload.volumeFactor'));
          expect(deloadOn(program, d.startDate)).toEqual(d);
          expect(deloadOn(program, d.endDate)).toEqual(d);
        }
        for (const m of program.mesocycles) {
          expect(m.weeks).toBeGreaterThanOrEqual(MESOCYCLE_MIN_WEEKS);
          expect(m.weeks).toBeLessThanOrEqual(MESOCYCLE_MAX_WEEKS);
          const week = program.microcycles.find((w) => w.week === m.deloadWeek)!;
          expect(week.kind).toBe('deload');
          expect(week.endDate).toBe(m.endDate);
        }
        expect(deloadOn(program, program.microcycles[0]!.startDate)).toBeNull();
      }
    }
  });

  it('mesocycle length follows the training age; deload weeks have less volume, lower effort and no intervals', () => {
    expect(ok(gen(programInput({ experience: 'beginner' }))).mesocycles[0]!.weeks).toBe(programValue('mesocycle.weeks.beginner'));
    expect(ok(gen(programInput({ experience: 'advanced' }))).mesocycles[0]!.weeks).toBe(programValue('mesocycle.weeks.advanced'));
    const program = ok(gen(programInput({ goal: 'fat_loss', days: 4, minutes: 60 })));
    const [acc, deload] = [program.microcycles[0]!, program.microcycles.find((w) => w.kind === 'deload')!];
    const sets = (w: typeof acc) => w.sessions.reduce((n, s) => n + s.slots.reduce((m, x) => m + x.hardSets, 0), 0);
    expect(sets(deload)).toBeLessThan(sets(acc));
    expect(deload.volumeFactor).toBe(0.5);
    expect(deload.sessions.every((s) => s.targetRpe === programValue('rpe.deload'))).toBe(true);
    expect(deload.sessions.every((s) => s.conditioning?.kind !== 'intervals')).toBe(true);
    for (const v of deload.volume) expect(v.target).toBe(weeklyTarget('intermediate', 'fat_loss', 1, 0.5));
  });

  it('a goal change starts with a transition week (lighter, no intervals)', () => {
    const program = ok(gen(programInput({ goal: 'fat_loss', previousGoal: 'muscle_gain' })));
    expect(program.reasonCodes).toContain('program.transition.goal_change');
    const first = program.microcycles[0]!;
    expect(first.kind).toBe('transition');
    expect(first.volumeFactor).toBe(programValue('transition.volumeFactor'));
    expect(first.sessions.every((s) => s.targetRpe === programValue('rpe.transition') && s.conditioning?.kind !== 'intervals')).toBe(true);
    expect(program.microcycles.filter((w) => w.kind === 'transition')).toHaveLength(1);
    expect(ok(gen(programInput({ goal: 'fat_loss', previousGoal: 'fat_loss' }))).microcycles[0]!.kind).toBe('accumulation');
  });

  it('M07: the re-assessment falls due the day after the mesocycle ends', () => {
    const program = ok(gen(programInput()));
    const [m1, m2] = program.mesocycles;
    expect(reassessmentDateFor(program, '2026-09-24')).toBe(addDays(m1!.endDate, 1)); // before the program starts
    expect(reassessmentDateFor(program, m1!.startDate)).toBe(addDays(m1!.endDate, 1));
    const deload = program.microcycles.find((w) => w.week === m1!.deloadWeek)!;
    expect(reassessmentDateFor(program, deload.startDate)).toBe(addDays(m2!.endDate, 1)); // the end-of-block re-test itself
    const last = program.mesocycles[program.mesocycles.length - 1]!;
    expect(reassessmentDateFor(program, addDays(last.endDate, -1))).toBeNull(); // deload of the last block: no next block
    expect(reassessmentDateFor(program, addDays(program.endDate, 1))).toBeNull();
    expect(mesocycleOn(program, m2!.startDate)).toEqual(m2);
    expect(mesocycleOn(program, '2020-01-01')).toBeNull();
    expect(microcycleOn(program, program.startDate)!.week).toBe(1);
    expect(microcycleOn(program, '2020-01-01')).toBeNull();
  });
});

describe('weekly hard-set targets per muscle group (config, validated:false)', () => {
  it('starts from the spec ranges by training age and never plans above the range max', () => {
    for (const [experience, age] of [['beginner', 'beginner'], ['intermediate', 'intermediate'], ['advanced', 'advanced']] as const) {
      const program = ok(gen(programInput({ experience, days: 6, minutes: 90 })));
      for (const week of program.microcycles) {
        for (const v of week.volume) {
          expect(v.min).toBe(programValue(`volume.${age}.min`));
          expect(v.max).toBe(programValue(`volume.${age}.max`));
          expect(v.direct).toBeLessThanOrEqual(Math.ceil(v.max * week.volumeFactor));
          if (week.kind === 'accumulation') expect(v.target).toBeGreaterThanOrEqual(v.min);
        }
      }
    }
  });

  it('with enough time, an accumulation week reaches its target for every group', () => {
    const program = ok(gen(programInput({ experience: 'beginner', days: 6, minutes: 90 })));
    const week = program.microcycles[0]!;
    for (const v of week.volume) expect(v.planned, v.muscle).toBeGreaterThanOrEqual(v.target - 0.5);
    expect(week.reasonCodes).not.toContain('program.volume.time_limited');
  });

  it('ramps the target within a mesocycle and says when the session time limits it', () => {
    const program = ok(gen(programInput({ goal: 'muscle_gain', experience: 'intermediate', minutes: 30 })));
    const targets = program.microcycles.slice(0, 4).map((w) => w.volume[0]!.target);
    expect(targets).toEqual([13, 14, 15, 16]);
    expect(program.microcycles[0]!.reasonCodes).toContain('program.volume.time_limited');
    expect(weeklyTarget('advanced', 'muscle_gain', 20, 1)).toBe(programValue('volume.advanced.max'));
  });

  it('counts fractional sets per pattern and allocates within capacity, caps and the per-slot limit', () => {
    expect(primaryGroup('squat')).toBe('quads');
    expect(primaryGroup('balance')).toBeNull();
    expect(contributions('horizontal_push')).toEqual([['chest', 1], ['shoulders', 0.5], ['arms', 0.5]]);
    const zero = { chest: 0, back: 0, shoulders: 0, arms: 0, quads: 0, glutes_hamstrings: 0, core: 0 };
    const targets = { ...zero, chest: 20, quads: 3 };
    const caps = { ...zero, chest: 20, shoulders: 4, arms: 20, quads: 3, glutes_hamstrings: 20 };
    const out = allocateSets(
      [
        { capacity: 6, slots: [{ pattern: 'horizontal_push', role: 'primary', counted: true, fixedSets: 0 }, { pattern: 'squat', role: 'primary', counted: true, fixedSets: 0 }, { pattern: 'balance', role: 'secondary', counted: false, fixedSets: 2 }] },
        { capacity: 1, slots: [{ pattern: 'balance', role: 'secondary', counted: false, fixedSets: 2 }] },
      ],
      targets,
      caps,
    );
    // The session holds 6 sets: 2 fixed balance sets first, then the 4 hard sets by relative deficit (chest is far below 20, quads close to 3); the second session only has room for 1 fixed set.
    expect(out.sets).toEqual([[3, 1, 2], [1]]);
    expect(out.volume.find((v) => v.muscle === 'shoulders')).toMatchObject({ planned: 1.5, direct: 0 });
    expect(out.volume.find((v) => v.muscle === 'quads')).toMatchObject({ planned: 1, direct: 1 });
    // A group at its cap takes no more direct sets, even with a deficit left (quads target 3, cap 2).
    const capped = allocateSets([{ capacity: 10, slots: [{ pattern: 'squat', role: 'primary', counted: true, fixedSets: 0 }] }], { ...zero, quads: 3 }, { ...caps, quads: 2 });
    expect(capped.sets).toEqual([[2]]);
  });
});

describe('equipment profile of each scheduled location (M01) and the SafetyProfile (S1, S7)', () => {
  it('plans each session for its place and keeps only slots the place and profile allow', () => {
    const input = programInput({
      goal: 'strength',
      days: 3,
      locations: [
        { equipmentProfileId: HOME, location: 'home', equipment: [] },
        { equipmentProfileId: GYM, location: 'gym', equipment: GYM_EQUIPMENT },
      ],
      defaultEquipmentProfileId: GYM,
      locationByWeekday: { wed: HOME },
    });
    const program = ok(gen(input));
    const week = program.microcycles[0]!;
    const wed = week.sessions.find((s) => s.weekday === 'wed')!;
    expect(wed.equipmentProfileId).toBe(HOME);
    expect(wed.location).toBe('home');
    // No pull-up bar or pulldown at home: the vertical pull slot is not planned there.
    expect(wed.slots.map((s) => s.pattern)).not.toContain('vertical_pull');
    expect(wed.reasonCodes).toContain('program.slot.not_possible_here');
    const mon = week.sessions.find((s) => s.weekday === 'mon')!;
    expect(mon.equipmentProfileId).toBe(GYM);
    // An unknown default falls back to the first place; no place at all means bodyweight only.
    expect(ok(gen({ ...input, defaultEquipmentProfileId: PARK, locationByWeekday: {} })).microcycles[0]!.sessions[0]!.equipmentProfileId).toBe(HOME);
    const nowhere = ok(gen({ ...input, locations: [], defaultEquipmentProfileId: null, locationByWeekday: {} }));
    expect(nowhere.microcycles[0]!.sessions.every((s) => s.equipmentProfileId === null && s.location === null)).toBe(true);
  });

  it('property: every planned slot has at least one exercise the place and the SafetyProfile allow', () => {
    const places = [[], HOME_EQUIPMENT, GYM_EQUIPMENT, ['resistance_band'], ['dumbbell']] as const;
    const profiles = [profileFrom(), profileFrom(['bone_joint_back']), profileFrom(['chest_discomfort']), profileFrom(['heart_or_blood_pressure'], { clearanceAttested: true })];
    fc.assert(
      fc.property(fc.constantFrom(...GOAL_IDS), fc.integer({ min: 1, max: 7 }), fc.constantFrom(...places), fc.constantFrom(...profiles), fc.constantFrom(20, 30, 45, 60, 90), (goal, days, equipment, profile, minutes) => {
        const program = ok(gen(programInput({ goal, days, minutes, profile, locations: [{ equipmentProfileId: HOME, location: 'home', equipment: [...equipment] }] })));
        ProgramSchema.parse(program);
        for (const week of program.microcycles) {
          for (const s of week.sessions) {
            for (const slot of s.slots) {
              const options = [...PROGRAM_LIBRARY.exercises.values()].filter((e) => e.pattern === slot.pattern);
              expect(options.some((e) => e.equipment.every((g) => g.anyOf.some((id) => equipment.includes(id as never))) && !e.contraindications.some((t) => profile.avoidTags.includes(t)))).toBe(true);
            }
            expect(s.estimatedMinutes).toBeLessThanOrEqual(minutes);
            expect(s.targetRpe).toBeLessThanOrEqual(profile.unresolvedFlags.length > 0 ? 7 : profile.maxRPE);
          }
        }
      }),
      { numRuns: 120 },
    );
  });

  it('S1: an unresolved screening flag caps every week at RPE 7 and replaces intervals with steady work, with safety events', () => {
    const flagged = profileFrom(['chest_discomfort']);
    const r = gen(programInput({ goal: 'fat_loss', days: 4, minutes: 60, profile: flagged }));
    const program = ok(r);
    expect(program.reasonCodes).toEqual(expect.arrayContaining(['program.rpe.s1_capped', 'program.conditioning.intervals_not_allowed']));
    for (const week of program.microcycles) for (const s of week.sessions) {
      expect(s.targetRpe).toBeLessThanOrEqual(7);
      expect(s.conditioning?.kind).not.toBe('intervals');
    }
    expect(r.status === 'ok' && r.safetyEvents).toEqual([
      { invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed', action: 'capped', engineVersion: ENGINE_VERSION },
      { invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION },
    ]);
    expect(intervalsAllowed(flagged, 7)).toBe(false);
    expect(intervalsAllowed(profileFrom(), 8)).toBe(true);
    expect(cappedRpe(8, flagged)).toBe(7);
    expect(cappedRpe(4, profileFrom())).toBeNull();
  });

  it('S7 and fail-closed states: no automatic program', () => {
    const cases: [ReturnType<typeof profileFrom>, string][] = [
      [profileFrom(['pregnancy_or_recent_birth']), 'program.unavailable.professional_guidance'],
      [profileFrom([], { birthYear: 2015 }), 'program.unavailable.blocked'],
      [SafetyProfileSchema.parse({ ...profileFrom(), screeningOutcome: 'not_screened' }), 'program.unavailable.not_screened'],
      [SafetyProfileSchema.parse({ ...profileFrom(), maxRPE: 4 }), 'program.unavailable.effort_cap'],
    ];
    for (const [profile, code] of cases) expect(gen(programInput({ profile }))).toEqual({ status: 'unavailable', reasonCodes: [code] });
  });

  it('drops a session its place cannot hold at all', () => {
    const noHinge = { exercises: new Map([...PROGRAM_LIBRARY.exercises].filter(([, e]) => e.pattern === 'core')) };
    const program = ok(generateProgram(programInput({ goal: 'general_health', days: 4 }), noHinge, ctx()));
    const week = program.microcycles[0]!;
    // Only core work is possible: strength sessions keep a core slot, the mobility/balance day keeps core too; conditioning stays.
    expect(week.sessions.length).toBe(4);
    const bare = ok(generateProgram(programInput({ goal: 'strength', days: 3 }), { exercises: new Map() }, ctx()));
    expect(bare.microcycles[0]!.sessions).toHaveLength(0);
    expect(bare.microcycles[0]!.reasonCodes).toContain('program.session.none_possible_here');
  });
});

describe('determinism, stamping and reason codes', () => {
  it('the same input, clock and seed give the same program; it records the engine version and rules version', () => {
    const input = programInput({ goal: 'endurance', days: 5 });
    const a = ok(gen(input, 11));
    expect(ok(gen(input, 11))).toEqual(a);
    expect(ok(gen(input, 12)).programId).not.toBe(a.programId);
    expect(a.engineVersion).toBe(ENGINE_VERSION);
    expect(a.generatedAt).toBe('2026-09-24T08:00:00.000Z');
    expect(a.startDate).toBe('2026-09-28');
    expect(a.endDate).toBe(addDays(a.startDate, a.microcycles.length * 7 - 1));
    expect(trainingAgeOf('returning')).toBe('beginner');
  });

  it('every emitted code is in PROGRAM_REASON_CODES', () => {
    const known = new Set(PROGRAM_REASON_CODES);
    const seen = new Set<string>();
    for (const goal of GOAL_IDS) {
      for (const days of [1, 2, 3, 4, 5, 6, 7]) {
        for (const profile of [profileFrom(), profileFrom(['chest_discomfort'])]) {
          for (const previousGoal of [null, 'strength' as const]) {
            const program = ok(gen(programInput({ goal, days, profile, previousGoal, minutes: days % 2 ? 30 : 60, trainingDays: days === 3 ? ['mon', 'tue', 'wed'] : null })));
            program.reasonCodes.forEach((c) => seen.add(c));
            for (const w of program.microcycles) {
              w.reasonCodes.forEach((c) => seen.add(c));
              for (const s of w.sessions) s.reasonCodes.forEach((c) => seen.add(c));
            }
          }
        }
      }
    }
    for (const code of seen) expect(known.has(code), code).toBe(true);
  });

  it('every coefficient is a config value with a source and validated:false', () => {
    for (const [key, v] of Object.entries(PROGRAM_CONFIG)) {
      expect(v.validated, key).toBe(false);
      expect(v.source.length, key).toBeGreaterThan(10);
    }
    expect(Object.keys(SESSION_TEMPLATES).length).toBeGreaterThan(5);
    expect(WEEKDAYS).toHaveLength(7);
  });

  it('M02 reads the day: the sessions, the week and the mesocycle', () => {
    const program = ok(gen(programInput()));
    const first = program.microcycles[0]!.sessions[0]!;
    const day = programDay(program, [], first.date)!;
    expect(day.sessions.map((s) => s.id)).toEqual([first.id]);
    expect(day.microcycle.week).toBe(1);
    expect(day.mesocycle.index).toBe(1);
    expect(programDay(program, [], addDays(first.date, 1))!.sessions).toEqual([]);
    expect(programDay(program, [], '2020-01-01')).toBeNull();
  });
});
