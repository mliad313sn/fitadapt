import { PROGRAM_REASON_CODES, addDays, createEngineContext, decideReflow, fixedClock, scheduledDeloads, type GenerateProgramResult } from '@fitadapt/engine';
import { en, fr } from '@fitadapt/i18n';
import { ProgramSchema, type Program } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { PERSONA_INPUTS } from './__fixtures__/personas.js';
import { generateProgram, programLibrary, seedLibrary } from './index.js';

/**
 * M08 on the real M06 seed (goal condition 1): a Program with split,
 * mesocycles and weekly hard-set targets for each committee persona. The
 * golden files (src/__golden__/*.program.json) are committed; a change in
 * the program rules shows up as a reviewed diff. Personas are fictional.
 */
const NOW = Date.parse('2026-09-24T08:00:00.000Z');
const ctx = (seed: number) => createEngineContext({ clock: fixedClock(NOW), seed });
const ok = (r: GenerateProgramResult): { program: Program; safetyEvents: readonly unknown[] } => {
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join(', '));
  return r;
};

/** A readable projection of a program: the whole calendar shape, week 1 in full. */
function golden(program: Program, safetyEvents: readonly unknown[]) {
  return {
    templateId: program.templateId,
    split: program.split,
    goal: program.goal,
    trainingAge: program.trainingAge,
    trainingDays: program.trainingDays,
    minutesPerSession: program.minutesPerSession,
    startDate: program.startDate,
    endDate: program.endDate,
    reasonCodes: program.reasonCodes,
    mesocycles: program.mesocycles.map((m) => `${m.index} ${m.intent} ${m.startDate}..${m.endDate} (${m.weeks} weeks, deload week ${m.deloadWeek})`),
    weeks: program.microcycles.map((w) => ({
      week: `${w.week} ${w.kind} (block ${w.mesocycle}, week ${w.weekInMesocycle}) ×${w.volumeFactor}`,
      sessions: w.sessions.map((s) => `${s.weekday} ${s.focus} @${s.location ?? 'none'} RPE ${s.targetRpe} ${s.estimatedMinutes} min: ${s.slots.map((x) => `${x.pattern}×${x.hardSets}`).join(' ')}${s.conditioning ? ` + ${s.conditioning.kind} ${s.conditioning.placement} ${s.conditioning.minutes} min` : ''}`),
      volume: Object.fromEntries(w.volume.map((v) => [v.muscle, `${v.planned} planned (${v.direct} direct) / target ${v.target}, range ${v.min}–${v.max}`])),
      aerobicMinutes: w.aerobicMinutes,
      reasonCodes: w.reasonCodes,
    })),
    firstWeek: program.microcycles[0]!.sessions,
    safetyEvents,
  };
}

describe('persona programs on the M06 seed (golden, goal condition 1)', () => {
  const seeds = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6 } as const;
  for (const [persona, input] of Object.entries(PERSONA_INPUTS) as [keyof typeof seeds, (typeof PERSONA_INPUTS)['P1']][]) {
    it(`${persona}: split, mesocycles and weekly hard-set targets match the reviewed golden file`, async () => {
      const { program, safetyEvents } = ok(generateProgram(input, ctx(seeds[persona])));
      ProgramSchema.parse(program);
      expect(program.mesocycles.length).toBeGreaterThanOrEqual(1);
      expect(scheduledDeloads(program).length).toBe(program.mesocycles.length);
      for (const w of program.microcycles) expect(w.volume.map((v) => v.muscle)).toEqual(['chest', 'back', 'shoulders', 'arms', 'quads', 'glutes_hamstrings', 'core']);
      await expect(JSON.stringify(golden(program, safetyEvents), null, 2) + '\n').toMatchFileSnapshot(`./__golden__/${persona}.program.json`);
    });
  }

  it('persona-specific expectations', () => {
    const p = Object.fromEntries(Object.entries(PERSONA_INPUTS).map(([k, input]) => [k, ok(generateProgram(input, ctx(1))).program])) as Record<keyof typeof PERSONA_INPUTS, Program>;
    // P1 fat loss: keeps strength work (3 full-body sessions) and adds aerobic volume; impact limited by the screening.
    expect(p.P1.microcycles[0]!.sessions.map((s) => s.focus)).toEqual(['full_body', 'full_body', 'full_body']);
    expect(p.P1.microcycles[0]!.aerobicMinutes).toBeGreaterThan(0);
    // P2: gym on Monday and Friday, home on Wednesday; skill days for the first pull-up.
    expect(p.P2.microcycles[0]!.sessions.map((s) => `${s.weekday}:${s.location}`)).toEqual(['mon:gym', 'wed:home', 'fri:gym']);
    expect(p.P2.microcycles[0]!.sessions.some((s) => s.focus === 'skill')).toBe(true);
    // P3: full body Monday, Wednesday, Friday; intermediate volume range.
    expect(p.P3.trainingDays).toEqual(['mon', 'wed', 'fri']);
    expect(p.P3.microcycles[0]!.volume[0]).toMatchObject({ min: 10, max: 16 });
    // P4: health goal, balance in every full-body session, 5 weeks + deload for a returning trainee, within 30 minutes.
    expect(p.P4.microcycles[0]!.sessions.every((s) => s.slots.some((x) => x.pattern === 'balance') && s.estimatedMinutes <= 30)).toBe(true);
    expect(p.P4.mesocycles[0]!.weeks).toBe(6);
    // P5: 4 days upper/lower, advanced range, 4-week blocks, strength blocks after a hypertrophy block.
    expect(p.P5.split).toBe('upper_lower');
    expect(p.P5.mesocycles.map((m) => m.intent)).toEqual(['hypertrophy', 'strength', 'strength']);
    expect(p.P5.mesocycles[0]!.weeks).toBe(4);
    // P6: 5 days with two skill days at the park.
    expect(p.P6.microcycles[0]!.sessions.filter((s) => s.focus === 'skill')).toHaveLength(2);
    expect(p.P6.microcycles[0]!.sessions.every((s) => s.location === 'park')).toBe(true);
  });

  it('P3 misses Friday: the session moves to Saturday (goal condition 3)', () => {
    const { program } = ok(generateProgram(PERSONA_INPUTS.P3, ctx(3)));
    for (const week of program.microcycles) {
      const friday = week.sessions.find((s) => s.weekday === 'fri')!;
      expect(decideReflow(program, [], friday.id, friday.date)).toMatchObject({ status: 'ok', outcome: { kind: 'shifted', toDate: addDays(friday.date, 1) } });
    }
  });
});

describe('every M08 reason code has an FR and EN explanation, and the engine emits no other', () => {
  it('renders all program reason codes in both languages', () => {
    for (const code of PROGRAM_REASON_CODES) {
      expect(en[`engine.reason.${code}` as keyof typeof en], code).toBeTruthy();
      expect(fr[`engine.reason.${code}` as keyof typeof fr], code).toBeTruthy();
    }
  });

  it('persona programs emit only listed codes; the seed library is the program library', () => {
    const known = new Set(PROGRAM_REASON_CODES);
    for (const input of Object.values(PERSONA_INPUTS)) {
      const { program } = ok(generateProgram(input, ctx(1)));
      for (const code of [...program.reasonCodes, ...program.microcycles.flatMap((w) => [...w.reasonCodes, ...w.sessions.flatMap((s) => s.reasonCodes)])]) expect(known.has(code), code).toBe(true);
    }
    expect(programLibrary().exercises.size).toBe(seedLibrary().graph.exercises.size);
  });
});
