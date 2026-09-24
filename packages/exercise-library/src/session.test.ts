import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  M02_REASON_CODES,
  SESSION_REASON_CODES,
  addDays,
  buildSessionHistory,
  createEngineContext,
  fixedClock,
  planSeconds,
  programDay,
  programSessionContext,
  reasonParamsFor,
  reflowRecord,
  s5Violations,
  weekdayOf,
  type GenerateSessionInput,
  type StoredSetLog,
} from '@fitadapt/engine';
import { createTranslator, en, fr } from '@fitadapt/i18n';
import { SessionPlanSchema, type ExecutionLog, type ReflowRecord, type SessionPlan, type WorkoutSessionRecord } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { PERSONA_INPUTS } from './__fixtures__/personas.js';
import { SAFE_FACTS, PERSONA_SESSIONS } from './__fixtures__/session-personas.js';
import { buildCapacityModel, generateProgram, generateSession, seedLibrary } from './index.js';

/**
 * M02 on the real M06 seed (goal condition 2): the first two weeks of
 * sessions for each committee persona, generated day by day from their M08
 * program, their (fictional) starting-point check and what they log, with
 * the English explanation of the first set of every exercise. The golden
 * files (src/__golden__/P*.sessions.json) are committed and reviewed; any
 * engine change that alters a persona's sessions fails here until the
 * golden file is deliberately updated (vitest -u) and the diff reviewed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PROGRAM_NOW = Date.parse('2026-09-24T08:00:00.000Z');
const seeds = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6 } as const;
type Persona = keyof typeof seeds;
const t = createTranslator('en').t;

interface Simulated {
  readonly plans: { readonly date: string; readonly state: string; readonly input: GenerateSessionInput; readonly plan: SessionPlan; readonly safetyEvents: readonly unknown[] }[];
  readonly reflows: ReflowRecord[];
}

/** Two weeks, day by day, as the device would run them (history rebuilt from the append-only records each time). */
function simulate(persona: Persona): Simulated {
  const input = PERSONA_INPUTS[persona];
  const p = PERSONA_SESSIONS[persona];
  const programResult = generateProgram(input, createEngineContext({ clock: fixedClock(PROGRAM_NOW), seed: seeds[persona] }));
  if (programResult.status !== 'ok') throw new Error(programResult.reasonCodes.join());
  const program = programResult.program;
  const capacity = buildCapacityModel(p.assessment);
  const records: WorkoutSessionRecord[] = [];
  const setLogs: StoredSetLog[] = [];
  const events: ExecutionLog[] = [];
  const reflows: ReflowRecord[] = [];
  const plans: Simulated['plans'][number][] = [];
  let logId = 0;
  for (let d = 0; d < 14; d++) {
    const date = addDays(program.startDate, d);
    const clockMs = Date.parse(`${date}T07:00:00.000Z`);
    const day = programDay(program, reflows, date);
    for (const session of day?.sessions ?? []) {
      if (p.misses.includes(weekdayOf(date)) && session.state === 'planned') {
        const reflow = reflowRecord(program, reflows, session.id, date, createEngineContext({ clock: fixedClock(clockMs), seed: d }));
        if (reflow) reflows.push(reflow);
        continue;
      }
      const place = input.locations.find((l) => l.equipmentProfileId === session.equipmentProfileId)!;
      const genInput: GenerateSessionInput = {
        ...SAFE_FACTS,
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
      const r = generateSession(genInput, createEngineContext({ clock: fixedClock(clockMs), seed: seeds[persona] * 1000 + d }));
      if (r.status !== 'ok') throw new Error(`${persona} ${date}: ${r.reasonCodes.join()}`);
      plans.push({ date, state: session.state, input: genInput, plan: r.plan, safetyEvents: r.safetyEvents });
      records.push({ schemaVersion: 1, input: genInput as WorkoutSessionRecord['input'], plan: r.plan, safetyEvents: [...r.safetyEvents], startedAt: new Date(clockMs + 60_000).toISOString(), jurisdiction: 'GB', firstWorkout: records.length === 0 });
      // The person does every set at the top of its target, at the planned reserve (choosing their own load when asked).
      r.plan.exercises.forEach((e, i) =>
        e.sets.forEach((s) =>
          setLogs.push({
            id: `00000000-0000-4000-8000-${String(++logId).padStart(12, '0')}`,
            data: { schemaVersion: 1, planId: r.plan.planId, exerciseIndex: i, exerciseId: e.exerciseId, set: { index: s.index, status: 'done', reps: s.target.kind === 'reps' ? s.target.max : null, seconds: s.target.kind === 'hold' ? s.target.seconds : null, loadKg: s.loadKg ?? (e.sets[0]!.reasonCodes.includes('session.load.self_select_light') ? p.chosenKg : null), rir: s.targetRir }, loggedAt: new Date(clockMs + 120_000).toISOString(), correctionOf: null },
          }),
        ),
      );
      events.push({ kind: 'ended', planId: r.plan.planId, reason: 'completed', at: new Date(clockMs + 3_600_000).toISOString() });
    }
  }
  return { plans, reflows };
}

const target = (s: SessionPlan['exercises'][number]['sets'][number]) => (s.target.kind === 'reps' ? `${s.target.min}–${s.target.max} reps` : `${s.target.seconds} s`);

/** M05: the warm-up (general, ramp-up, mobility drills with the patterns they prepare) and the cool-down, readable. */
function warmUpLines(plan: SessionPlan): string[] {
  const w = plan.warmUp.content!;
  const lines = [`general: ${w.general.exerciseId ?? 'any easy movement'} ${w.general.seconds} s`];
  if (w.rampUp) lines.push(`ramp-up before ${w.rampUp.exerciseId} @ ${w.rampUp.workingLoadKg} kg: ${w.rampUp.sets.map((s) => `${s.percent} % → ${s.loadKg} kg × ${s.reps}`).join(', ')} (${w.rampUp.seconds} s)`);
  for (const d of w.mobility) lines.push(`mobility: ${d.exerciseId} ${d.seconds} s for ${d.forPatterns.join(', ')}`);
  if (plan.coolDown) lines.push(`cool-down ${plan.coolDown.minutes} min: ${plan.coolDown.drills.map((d) => d.exerciseId).join(', ')}`);
  return lines;
}

/** M03: the conditioning block as the device runs it (protocol, movements, zones and each step), readable. */
function cardioLines(plan: SessionPlan): string[] {
  const c = plan.cardio!;
  const lines = [`${c.protocol} ${c.placement}${c.hiit ? ' (HIIT)' : ''}, impact ≤ ${c.impactCeiling}, zones by ${c.zones.method}, ${c.planned.moderateSeconds} s moderate + ${c.planned.vigorousSeconds} s vigorous`];
  lines.push(`movements: ${c.movements.map((m) => m.exerciseId).join(', ') || 'any easy movement'}`);
  for (const s of c.timeline) lines.push(`${s.startSeconds} s ${s.kind} ${s.durationSeconds} s ${s.intensity}${s.exerciseId ? ` ${s.exerciseId}` : ''}${s.round !== null ? ` round ${s.round}/${s.rounds}` : ''}`);
  lines.push(`reasons: ${c.reasonCodes.join(', ')}`);
  return lines;
}

/** A readable projection of a persona's sessions, for review. */
function golden({ plans, reflows }: Simulated) {
  return {
    reflows: reflows.map((r) => `${r.sessionId} reported ${r.reportedOn}: ${r.outcome.kind}${r.outcome.kind === 'shifted' ? ` to ${r.outcome.toDate}` : ''}`),
    sessions: plans.map(({ date, state, plan, safetyEvents }) => ({
      date: `${date} ${plan.program!.sessionId} (${state}, week ${plan.program!.week} ${plan.program!.microcycleKind}, ${plan.program!.mesocycleIntent})`,
      budget: `${plan.estimatedMinutes} of ${plan.minutesAvailable} min, warm-up ${plan.warmUp.minutes} min${plan.conditioning ? `, ${plan.conditioning.kind} ${plan.conditioning.placement} ${plan.conditioning.minutes} min` : ''}, reserve RIR ${plan.targetRir}`,
      // M05: what the warm-up and the cool-down are.
      warmUp: warmUpLines(plan),
      ...(plan.cardio ? { cardio: cardioLines(plan) } : {}),
      reasonCodes: plan.reasonCodes,
      exercises: plan.exercises.map((e) => {
        const s = e.sets[0]!;
        const load = s.loadKg !== null ? `${s.loadKg} kg` : 'no set load';
        return {
          what: `${e.slot}/${e.role}: ${e.exerciseId} ${e.sets.length} × ${target(s)} @ ${load}, rest ${s.restSeconds} s${s.tempo ? `, eccentric ${s.tempo.eccentricSeconds} s` : ''}${e.supersetGroup ? `, superset ${e.supersetGroup}` : ''}`,
          reasons: s.reasonCodes,
          why: s.reasonCodes.map((c) => t(`engine.reason.${c}` as keyof typeof en, s.reasonParams)),
        };
      }),
      safetyEvents,
    })),
  };
}

describe('persona sessions on the M06 seed (golden, goal condition 2)', () => {
  for (const persona of Object.keys(seeds) as Persona[]) {
    it(`${persona}: two weeks of sessions match the reviewed golden file`, async () => {
      const sim = simulate(persona);
      expect(sim.plans.length).toBeGreaterThanOrEqual(6);
      for (const { plan } of sim.plans) SessionPlanSchema.parse(plan);
      // A missing golden file is a failure, never silently written.
      const file = `./__golden__/${persona}.sessions.json`;
      expect(existsSync(join(here, file)), `${file} must be committed`).toBe(true);
      await expect(JSON.stringify(golden(sim), null, 2) + '\n').toMatchFileSnapshot(file);
    });
  }

  it('every persona session keeps the safety caps, fits the minutes, uses only the place’s equipment and explains every set', () => {
    const lib = seedLibrary();
    for (const persona of Object.keys(seeds) as Persona[]) {
      for (const { input, plan } of simulate(persona).plans) {
        expect(planSeconds(plan)).toBeLessThanOrEqual(plan.minutesAvailable * 60);
        expect(s5Violations(plan, input.history ?? [])).toEqual([]);
        for (const e of plan.exercises) {
          const ex = lib.byId.get(e.exerciseId)!;
          expect(ex.equipment.every((g) => g.anyOf.some((id) => input.equipment.includes(id))), `${persona} ${e.exerciseId}`).toBe(true);
          expect(ex.contraindications.filter((c) => input.safetyProfile.avoidTags.includes(c))).toEqual([]);
          for (const s of e.sets) {
            expect(s.reasonCodes.length).toBeGreaterThan(0);
            expect(10 - s.targetRir).toBeLessThanOrEqual(input.safetyProfile.maxRPE);
          }
        }
      }
    }
  });

  it('persona-specific expectations', () => {
    const lib = seedLibrary();
    // P1: home with one pair of 10 kg dumbbells: every load is 10 kg or none; ≤ 40 minutes.
    const p1 = simulate('P1').plans;
    expect(p1.flatMap(({ plan }) => plan.exercises.flatMap((e) => e.sets.map((s) => s.loadKg))).every((l) => l === null || l === 10)).toBe(true);
    expect(p1.every(({ plan }) => plan.estimatedMinutes <= 40)).toBe(true);
    // P2: Wednesday at P1's home, the other days at the gym — each day fits its own place.
    const p2 = simulate('P2').plans;
    expect(p2.find(({ date }) => weekdayOf(date) === 'wed')!.plan.equipmentProfileId).toBe(PERSONA_INPUTS.P2.locationByWeekday.wed);
    // P3: Friday is reflowed to Saturday and the Saturday session says so.
    const p3 = simulate('P3');
    expect(p3.reflows[0]).toMatchObject({ outcome: { kind: 'shifted' } });
    const saturday = p3.plans.find(({ state }) => state === 'shifted')!;
    expect(weekdayOf(saturday.date)).toBe('sat');
    expect(saturday.plan.reasonCodes).toContain('session.program.shifted');
    // P3 week 2: the loads of week 1 went up by the smallest step (all sets at the top at the target reserve).
    const bench = p3.plans.flatMap(({ plan }) => plan.exercises.filter((e) => e.exerciseId === 'barbell_bench_press').map((e) => e.sets[0]!));
    expect(bench.some((s) => s.reasonCodes.includes('session.progression.load_increased'))).toBe(true);
    // P4: no exercise with a tag her profile avoids, a balance exercise in every session, ≤ 30 minutes.
    for (const { plan, input } of simulate('P4').plans) {
      expect(plan.exercises.some((e) => e.slot === 'balance')).toBe(true);
      expect(plan.estimatedMinutes).toBeLessThanOrEqual(30);
      for (const e of plan.exercises) expect(lib.byId.get(e.exerciseId)!.contraindications.some((c) => input.safetyProfile.avoidTags.includes(c))).toBe(false);
    }
    // P5: microplates → barbell loads on 0.5 kg steps.
    const p5 = simulate('P5').plans.flatMap(({ plan }) => plan.exercises.filter((e) => e.exerciseId.startsWith('barbell_')).flatMap((e) => e.sets.map((s) => s.loadKg).filter((l): l is number => l !== null)));
    expect(p5.length).toBeGreaterThan(20);
    expect(p5.every((l) => Math.round(l * 100) % 50 === 0)).toBe(true);
    expect(p5.some((l) => Math.round(l * 100) % 250 !== 0)).toBe(true); // steps a 2.5 kg plate set could not make
    // P6: skill sessions at the park use calisthenics skills, bodyweight only.
    const p6 = simulate('P6').plans.filter(({ plan }) => plan.exercises.some((e) => e.sets[0]!.reasonCodes.includes('session.rep_range.skill')));
    expect(p6.length).toBeGreaterThan(0);
    expect(p6.every(({ plan }) => plan.exercises.every((e) => e.sets.every((s) => s.loadKg === null)))).toBe(true);
  });
});

describe('every session reason code has an FR and EN explanation (goal condition 5)', () => {
  it('renders all M07 and M02 session reason codes in both languages with their parameters, no missing key', () => {
    const codes = [...new Set([...SESSION_REASON_CODES, ...M02_REASON_CODES])];
    expect(codes.length).toBeGreaterThan(100);
    for (const locale of ['en', 'fr'] as const) {
      const tr = createTranslator(locale);
      const catalogue = locale === 'en' ? en : fr;
      for (const code of codes) {
        const key = `engine.reason.${code}` as keyof typeof en;
        expect(catalogue[key], `${locale} ${code}`).toBeTruthy();
        const params = Object.fromEntries(reasonParamsFor(code).map((p) => [p, 3]));
        const text = tr.t(key, params);
        expect(text.length, `${locale} ${code}`).toBeGreaterThan(5);
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });

  it('every set of every persona session renders in FR and EN with the parameters it carries', () => {
    for (const persona of Object.keys(seeds) as Persona[]) {
      for (const { plan } of simulate(persona).plans) {
        for (const e of plan.exercises) {
          for (const s of e.sets) {
            for (const locale of ['en', 'fr'] as const) {
              for (const code of s.reasonCodes) expect(() => createTranslator(locale).t(`engine.reason.${code}` as keyof typeof en, s.reasonParams), `${persona} ${locale} ${code}`).not.toThrow();
            }
          }
          for (const code of e.reasonCodes) expect(en[`engine.reason.${code}` as keyof typeof en], code).toBeTruthy();
        }
        for (const code of plan.reasonCodes) expect(fr[`engine.reason.${code}` as keyof typeof fr], code).toBeTruthy();
      }
    }
  });
});
