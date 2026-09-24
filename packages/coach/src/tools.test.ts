import { createEngineContext, fixedClock, s5Violations, type GenerateSessionInput } from '@fitadapt/engine';
import { generateSession, seedLibrary } from '@fitadapt/exercise-library';
import { catalogues } from '@fitadapt/i18n';
import { lintClaims } from '@fitadapt/legal';
import { CoachActionSchema, COACH_TOOL_NAMES, type CoachAction } from '@fitadapt/shared';
import { safetyProfileFromScreenings } from '@fitadapt/safety';
import { describe, expect, it } from 'vitest';
import { NOW, gymContext, testEnv } from './__fixtures__/context.js';
import { TOOL_DESCRIPTIONS, TOOL_SPECS, executeTool } from './tools.js';

const proposal = (actions: readonly CoachAction[]) => actions.find((a): a is Extract<CoachAction, { type: 'session_proposal' }> => a.type === 'session_proposal');

describe('the coach tools call the engine (S6, goal condition 2)', () => {
  it('lists exactly the tools of the spec (plus the S3 safety tool), each with a strict JSON schema and a description', () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([...COACH_TOOL_NAMES]);
    expect(COACH_TOOL_NAMES).toEqual(['swapExercise', 'adjustSessionTime', 'requestDeload', 'explainPrescription', 'logPain', 'reschedule', 'reportRedFlag']);
    for (const t of TOOL_SPECS) {
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      // No tool input can carry a prescription: no load, set, rep, reserve, effort or protocol field.
      expect(Object.keys((t.inputSchema.properties ?? {}) as object).join(' ')).not.toMatch(/load|kg|weight|set|rep|rir|rpe|intensity|protocol|plan/i);
    }
  });

  it('the tool descriptions pass the L1 claims linter', () => {
    expect(lintClaims(Object.entries(TOOL_DESCRIPTIONS).map(([k, text]) => ({ source: 'tools', key: k, locale: 'any' as const, text })))).toEqual([]);
  });

  it('a tool outside the list is refused and audited as invalid: a plan change outside the tools is impossible', () => {
    for (const name of ['setLoad', 'writePlan', 'updateSession', 'generateProgram', '__proto__', '']) {
      const r = executeTool(name, { loadKg: 200 }, gymContext(), testEnv());
      expect(r).toMatchObject({ status: 'invalid', reasonCode: 'coach.tool.unknown', actions: [] });
    }
  });

  it('an input with a prescription field (load, reserve, sets) is invalid: the schemas are strict', () => {
    const ctx = gymContext();
    expect(executeTool('adjustSessionTime', { minutes: 30, loadKg: 200 }, ctx, testEnv())).toMatchObject({ status: 'invalid', reasonCode: 'coach.tool.invalid_input' });
    expect(executeTool('swapExercise', { exerciseIndex: 0, reason: 'user', targetRir: 0 }, ctx, testEnv())).toMatchObject({ status: 'invalid' });
    expect(executeTool('requestDeload', { sets: 10 }, ctx, testEnv())).toMatchObject({ status: 'invalid' });
    expect(executeTool('logPain', { joint: 'knee', score: 11 }, ctx, testEnv())).toMatchObject({ status: 'invalid' });
    expect(executeTool('adjustSessionTime', { minutes: 5000 }, ctx, testEnv())).toMatchObject({ status: 'invalid' });
    expect(executeTool('adjustSessionTime', 'thirty', ctx, testEnv())).toMatchObject({ status: 'invalid' });
  });

  it('adjustSessionTime: the engine rebuilds today for the minutes, exactly as generateSession does', () => {
    const ctx = gymContext();
    const r = executeTool('adjustSessionTime', { minutes: 30 }, ctx, testEnv());
    expect(r.status).toBe('proposed');
    const p = proposal(r.actions)!;
    expect(CoachActionSchema.parse(p)).toBeTruthy();
    const again = generateSession({ ...(ctx.today!.input as GenerateSessionInput), minutesAvailable: 30 }, createEngineContext({ clock: fixedClock(NOW), seed: 11 }));
    expect(again.status === 'ok' && again.plan).toEqual(p.plan);
    expect(p.plan.estimatedMinutes).toBeLessThanOrEqual(30);
    expect(r.parts).toEqual([{ kind: 'template', key: 'coach.reply.time.proposed', values: { minutes: 30 } }]);
  });

  it('adjustSessionTime and requestDeload do not change a session already started (only swaps do)', () => {
    const ctx = gymContext({ started: true });
    expect(executeTool('adjustSessionTime', { minutes: 30 }, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.session_started' });
    expect(executeTool('requestDeload', {}, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.session_started' });
    expect(executeTool('swapExercise', { exerciseIndex: 1, reason: 'equipment' }, ctx, testEnv()).status).toBe('proposed');
  });

  it('requestDeload: a lighter day from the engine (fewer sets, more reserve, never a heavier load)', () => {
    const ctx = gymContext();
    const r = executeTool('requestDeload', {}, ctx, testEnv());
    const p = proposal(r.actions)!;
    const before = ctx.today!.plan!;
    const sets = (plan: typeof before) => plan.exercises.reduce((n, e) => n + e.sets.length, 0);
    expect(sets(p.plan)).toBeLessThan(sets(before));
    expect(p.plan.targetRir).toBeGreaterThanOrEqual(before.targetRir);
    for (const e of p.plan.exercises) {
      const old = before.exercises.find((x) => x.exerciseId === e.exerciseId);
      if (old) for (const s of e.sets) expect(s.loadKg ?? 0).toBeLessThanOrEqual(Math.max(...old.sets.map((o) => o.loadKg ?? 0)));
    }
  });

  it('S3: with intensity locked after warning signs, the engine refuses every rebuilt session', () => {
    const ctx = gymContext({ over: { intensityLock: { locked: true, since: '2026-09-27T10:00:00.000Z' } } });
    expect(ctx.today!.plan).toBeNull();
    for (const [tool, input] of [['adjustSessionTime', { minutes: 60 }], ['requestDeload', {}]] as const) {
      const r = executeTool(tool, input, ctx, testEnv());
      expect(r).toMatchObject({ status: 'refused', actions: [] });
      expect(r.reasonCode).toMatch(/s3/);
      expect(r.parts[0]).toEqual({ kind: 'template', key: 'coach.reply.tool.refused', values: {} });
      expect(r.parts[1]!.kind === 'template' && catalogues.en[r.parts[1]!.key as keyof typeof catalogues.en]).toBeTruthy();
    }
  });

  it('integration FIX-A/FIX-B: the coach proposes nothing when the engine refuses — CS-1 training hold, a server-rejected screening, missing safety facts', () => {
    const rebuilds = [['adjustSessionTime', { minutes: 60 }], ['requestDeload', {}]] as const;
    // CS-1: a symptom flag without clearance holds all training.
    const held = gymContext({ yes: ['chest_discomfort'] });
    expect(held.today!.plan).toBeNull();
    for (const [tool, input] of rebuilds) expect(executeTool(tool, input, held, testEnv())).toMatchObject({ status: 'refused', actions: [] });
    // screeningRejected: the SafetyProfile is at least as strict as "not screened".
    const cleared = gymContext();
    const rejected = safetyProfileFromScreenings([], { screeningRejected: true });
    const ctx = { ...cleared, today: { ...cleared.today!, input: { ...cleared.today!.input, safetyProfile: rejected } } };
    for (const [tool, input] of rebuilds) {
      const r = executeTool(tool, input, ctx, testEnv());
      expect(r).toMatchObject({ status: 'refused', actions: [] });
      expect(r.reasonCode).toMatch(/not_screened/);
    }
    // SAF-3: an input without its required safety facts is never rebuilt (and never throws).
    const { jointFlags: _drop, ...partial } = cleared.today!.input;
    const incomplete = { ...cleared, today: { ...cleared.today!, input: partial as unknown as NonNullable<typeof cleared.today>['input'] } };
    for (const [tool, input] of rebuilds) expect(executeTool(tool, input, incomplete, testEnv())).toMatchObject({ status: 'invalid', actions: [] });
  });

  it('S7: a pregnancy answer routes to professional guidance; no tool can build a session', () => {
    const ctx = gymContext({ yes: ['pregnancy_or_recent_birth'] });
    const r = executeTool('adjustSessionTime', { minutes: 30 }, ctx, testEnv());
    expect(r).toMatchObject({ status: 'refused' });
    expect(r.reasonCode).toMatch(/professional_guidance|not_screened|blocked/);
  });

  it('S2: a swap to an exercise that loads a red joint is refused by the engine; its own choice never loads it', () => {
    const ctx = gymContext({ over: { jointFlags: { knee: 'red' } } });
    const plan = ctx.today!.plan!;
    const library = seedLibrary();
    const r = executeTool('swapExercise', { exerciseIndex: 0, reason: 'user', preferredExerciseId: 'barbell_back_squat' }, ctx, testEnv());
    expect(r).toMatchObject({ status: 'refused', reasonCode: 'coach.swap.joint_red', actions: [] });
    const own = executeTool('swapExercise', { exerciseIndex: 0, reason: 'user' }, ctx, testEnv());
    const swap = own.actions[0];
    if (own.status === 'proposed' && swap?.type === 'swap_proposal') {
      const load = library.graph.exercises.get(swap.replacement.exerciseId)!.jointLoad.knee;
      expect(['none', 'low']).toContain(load);
    } else expect(own.reasonCode).toBe('coach.swap.no_replacement');
    expect(plan.exercises.every((e) => ['none', 'low'].includes(library.graph.exercises.get(e.exerciseId)!.jointLoad.knee))).toBe(true);
  });

  it('a preferred exercise the engine does not offer is refused (not offered), and the engine keeps its own choice otherwise', () => {
    const ctx = gymContext();
    expect(executeTool('swapExercise', { exerciseIndex: 1, reason: 'user', preferredExerciseId: 'ring_muscle_up' }, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.swap.not_offered' });
    expect(executeTool('swapExercise', { exerciseIndex: 15, reason: 'user' }, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.no_exercise' });
    expect(executeTool('swapExercise', { exerciseIndex: 0, reason: 'user' }, gymContext({ withPlan: false }), testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.no_plan' });
  });

  it('S5: no load proposed by any tool exceeds the load ceiling', () => {
    const ctx = gymContext();
    for (const [tool, input] of [['adjustSessionTime', { minutes: 90 }], ['adjustSessionTime', { minutes: 20 }], ['requestDeload', {}], ['logPain', { joint: 'shoulder', score: 8 }]] as const) {
      const r = executeTool(tool, input, ctx, testEnv());
      const p = proposal(r.actions);
      if (p) expect(s5Violations(p.plan, ctx.today!.input.history ?? [], ctx.today!.input.recentLoads ?? [])).toEqual([]);
    }
  });

  it('explainPrescription: the plan explained from its own reason codes, each an FR/EN sentence', () => {
    const ctx = gymContext();
    const r = executeTool('explainPrescription', { exerciseIndex: 0 }, ctx, testEnv());
    expect(r.status).toBe('applied');
    expect(r.parts[0]).toMatchObject({ key: 'coach.reply.explain.intro' });
    for (const p of r.parts.slice(1)) {
      expect(p.kind).toBe('template');
      if (p.kind === 'template') {
        expect(catalogues.en[p.key as keyof typeof catalogues.en]).toBeTruthy();
        expect(catalogues.fr[p.key as keyof typeof catalogues.fr]).toBeTruthy();
      }
    }
    expect(executeTool('explainPrescription', {}, gymContext({ withPlan: false }), testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.no_plan' });
    expect(executeTool('explainPrescription', { exerciseIndex: 19 }, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.no_exercise' });
    expect(executeTool('explainPrescription', {}, ctx, testEnv()).reasonCodes).toEqual(expect.arrayContaining(ctx.today!.plan!.reasonCodes));
  });

  it('logPain (M05): a pain report the sync validators store; a red joint before the session rebuilds today with S2 substitutions', () => {
    const ctx = gymContext();
    const amber = executeTool('logPain', { joint: 'knee', score: 4 }, ctx, testEnv());
    expect(amber.actions).toHaveLength(1);
    expect(amber.actions[0]).toMatchObject({ type: 'record', collection: 'execution_logs', data: { kind: 'pain', joint: 'knee', score: 4, planId: null, phase: 'after_session' } });
    const red = executeTool('logPain', { joint: 'knee', score: 7 }, ctx, testEnv());
    expect(red.parts[0]).toMatchObject({ key: 'coach.reply.pain.loggedRed' });
    const p = proposal(red.actions)!;
    expect(p.change).toBe('pain');
    expect(p.input.jointFlags?.knee).toBe('red');
    const library = seedLibrary();
    expect(p.plan.exercises.every((e) => ['none', 'low'].includes(library.graph.exercises.get(e.exerciseId)!.jointLoad.knee))).toBe(true);
    expect(red.safetyEvents.some((e) => e.invariant === 'S2')).toBe(true);
    // During a session the report belongs to it, and the session itself is not rebuilt (M02 in-session pain flow).
    const during = executeTool('logPain', { joint: 'knee', score: 7 }, gymContext({ started: true }), testEnv());
    expect(during.actions).toHaveLength(1);
    expect(during.actions[0]).toMatchObject({ data: { phase: 'during' } });
  });

  it('reschedule (M08): the engine reflows the session; without a program it is refused', () => {
    const ctx = gymContext();
    const r = executeTool('reschedule', {}, ctx, testEnv());
    expect(r.status).toBe('applied');
    expect(r.actions[0]).toMatchObject({ type: 'record', collection: 'program_reflows' });
    expect(executeTool('reschedule', {}, gymContext({ withProgram: false }), testEnv())).toMatchObject({ status: 'refused', reasonCode: 'coach.tool.no_program' });
    const record = (r.actions[0] as Extract<CoachAction, { type: 'record' }>).data;
    const handled = { ...ctx, program: { ...ctx.program!, reflows: [record as never] } };
    expect(executeTool('reschedule', {}, handled, testEnv()).status).toBe('refused');
    expect(executeTool('reschedule', { sessionId: 'w99.s1' }, ctx, testEnv())).toMatchObject({ status: 'refused', reasonCode: 'program.reflow.unknown_session' });
  });

  it('reportRedFlag (S3): the M05 stop flow — session ended, intensity locked, events for the log', () => {
    const r = executeTool('reportRedFlag', { symptom: 'palpitations' }, gymContext({ started: true }), testEnv());
    expect(r.actions[0]).toMatchObject({ type: 'red_flag_stop', symptom: 'palpitations', log: { kind: 'red_flag', symptom: 'palpitations' } });
    expect(r.safetyEvents.map((e) => e.action)).toEqual(['session_ended', 'intensity_locked']);
  });
});
