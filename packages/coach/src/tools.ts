import { ENGINE_VERSION, createEngineContext, decideReflow, fixedClock, programDay, reflowRecord, type GenerateSessionInput } from '@fitadapt/engine';
import { generateSession, replacementsFor, seedLibrary } from '@fitadapt/exercise-library';
import { isMessageKey } from '@fitadapt/i18n';
import { classifyPainReport } from '@fitadapt/safety';
import {
  COACH_TOOL_NAMES,
  CoachToolInputSchemas,
  type CoachAction,
  type CoachContext,
  type CoachReplyPart,
  type CoachTemplateValueSchema,
  type CoachToolName,
  type ExecutionLog,
  type Joint,
  type PlannedSet,
  type SessionSafetyEventValue,
  type ToolCallStatus,
} from '@fitadapt/shared';
import { z } from 'zod';

/**
 * S6: the coach's tools. Each one calls the engine (M02 generateSession and
 * replacementsFor, M05 pain classification, M08 reflow) on the user's context,
 * and returns only what the engine decided. A tool can never set a load, a
 * set, a reserve or a protocol: its input schema has no such field, is strict
 * (an extra field is refused), and a name outside COACH_TOOL_NAMES is refused.
 * Whatever the engine refuses (S1–S5, S7 gates, "no replacement", "cannot be
 * moved") comes back as a refusal with the engine's reason code, which the
 * coach explains and never retries around.
 */

type TemplateValue = z.infer<typeof CoachTemplateValueSchema>;
const part = (key: string, values: Record<string, TemplateValue> = {}): CoachReplyPart => ({ kind: 'template', key, values });

/** English descriptions for the model (not shown to users; linted by the claims test with the prompts). */
export const TOOL_DESCRIPTIONS: Readonly<Record<CoachToolName, string>> = Object.freeze({
  swapExercise:
    'Ask the training engine for a replacement of one exercise of today\'s plan (by its position, starting at 0). Give the reason: "user" (preference), "pain" or "equipment". If the user named an exercise they want instead, pass its id as preferredExerciseId; the engine uses it only if it is a valid replacement. You never choose loads, sets or reps.',
  adjustSessionTime: 'Ask the training engine to rebuild today\'s session (before it starts) for the minutes the user has. The engine decides what to keep.',
  requestDeload: 'Ask the training engine for a lighter version of today\'s session (before it starts), for example when the user feels tired. The engine decides how much lighter.',
  explainPrescription: 'Get the reasons the training engine gave for today\'s plan, or for one exercise of it (by its position, starting at 0). Use it to explain a load, a number of sets or a choice of exercise.',
  logPain: 'Record pain the user reports in a joint, with the score from 0 to 10 the user gave. Never guess a score: ask the user if they did not give one. The engine keeps a painful joint out of heavy work.',
  reschedule: 'Tell the training engine the user cannot do a session of their program (today\'s by default). The engine moves it within the week, merges it, or leaves it out.',
  reportRedFlag:
    'Call this at once if the user reports chest pain or pressure, fainting, unusual breathlessness, palpitations, or sudden numbness or weakness. It ends the session and pauses training until a medical review is confirmed.',
});

export interface ToolSpec {
  readonly name: CoachToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** The tool list sent to the model: deterministic order and content (prompt caching). */
export const TOOL_SPECS: readonly ToolSpec[] = Object.freeze(
  COACH_TOOL_NAMES.map((name) => {
    const schema = z.toJSONSchema(CoachToolInputSchemas[name]) as Record<string, unknown>;
    delete schema.$schema;
    return Object.freeze({ name, description: TOOL_DESCRIPTIONS[name], inputSchema: schema });
  }),
);

export interface ToolEnv {
  /** The request time (the engine's injected clock). */
  readonly nowMs: number;
  /** The engine seed for plans generated in this turn. */
  readonly seed: number;
  /** New record ids (execution logs carry their own id, ADR-023). */
  readonly newId: () => string;
}

export interface ToolExecution {
  readonly tool: string;
  readonly status: ToolCallStatus;
  readonly reasonCode: string;
  readonly reasonCodes: readonly string[];
  /** What the engine decided (proposals for the device, records to store through the sync validators). */
  readonly actions: readonly CoachAction[];
  /** What the client shows for this tool (templates). */
  readonly parts: readonly CoachReplyPart[];
  /** What the model receives as the tool result (codes and engine facts, no app wording). */
  readonly result: Record<string, unknown>;
  /** Safety events the engine returned with a plan (for the defensibility log with the stored session). */
  readonly safetyEvents: readonly SessionSafetyEventValue[];
}

const reasonPart = (code: string, params: Record<string, number> = {}): CoachReplyPart | null => (isMessageKey(`engine.reason.${code}`) ? part(`engine.reason.${code}`, params) : null);

function refused(tool: string, reasonCode: string, extra: CoachReplyPart[] = []): ToolExecution {
  const reason = reasonPart(reasonCode);
  return {
    tool,
    status: 'refused',
    reasonCode,
    reasonCodes: [reasonCode],
    actions: [],
    parts: reason ? [part('coach.reply.tool.refused'), reason, ...extra] : [part('coach.reply.tool.refusedGeneric'), ...extra],
    result: { status: 'refused', reasonCode, instruction: 'The engine refused. Explain this to the user in plain words. Do not try another tool to get around it.' },
    safetyEvents: [],
  };
}

function invalid(tool: string, reasonCode: 'coach.tool.unknown' | 'coach.tool.invalid_input'): ToolExecution {
  return { ...refused(tool, reasonCode), status: 'invalid' };
}

const ctxAt = (env: ToolEnv) => createEngineContext({ clock: fixedClock(env.nowMs), seed: env.seed });

function uniq(codes: readonly string[]): string[] {
  return [...new Set(codes)];
}

/** Regenerates today's session with a change the user asked for; the engine applies every gate again. */
function regenerate(tool: string, context: CoachContext, change: 'time' | 'deload' | 'pain', patch: Partial<GenerateSessionInput>, env: ToolEnv, done: CoachReplyPart[], code: string): ToolExecution {
  const today = context.today!;
  const input = { ...today.input, ...patch } as GenerateSessionInput;
  const result = generateSession(input, ctxAt(env));
  if (result.status !== 'ok') return refused(tool, result.reasonCodes[0] ?? 'coach.tool.no_plan');
  const plan = result.plan;
  return {
    tool,
    status: 'proposed',
    reasonCode: code,
    reasonCodes: uniq(plan.reasonCodes),
    actions: [{ type: 'session_proposal', change, input: input as never, plan, reasonCodes: uniq(plan.reasonCodes).slice(0, 50) }],
    parts: done,
    result: { status: 'proposed', change, planId: plan.planId, estimatedMinutes: plan.estimatedMinutes, exercises: plan.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.length })), reasonCodes: uniq(plan.reasonCodes) },
    safetyEvents: result.safetyEvents.map((e) => ({ ...e })),
  };
}

function loadsRedJoint(exerciseId: string, context: CoachContext): Joint | null {
  const ex = seedLibrary().graph.exercises.get(exerciseId);
  const flags = context.today?.input.jointFlags ?? {};
  if (!ex) return null;
  for (const [joint, level] of Object.entries(ex.jointLoad) as [Joint, string][]) {
    if (flags[joint] === 'red' && (level === 'medium' || level === 'high')) return joint;
  }
  return null;
}

function setParams(sets: readonly PlannedSet[], code: string): Record<string, number> {
  return sets.find((s) => s.reasonCodes.includes(code))?.reasonParams ?? {};
}

/** Runs one tool call the model made. Never throws on model input: an invalid call is audited as invalid. */
export function executeTool(name: string, rawInput: unknown, context: CoachContext, env: ToolEnv): ToolExecution {
  if (!(COACH_TOOL_NAMES as readonly string[]).includes(name)) return invalid(name, 'coach.tool.unknown');
  const tool = name as CoachToolName;
  const parsed = CoachToolInputSchemas[tool].safeParse(rawInput);
  if (!parsed.success) return invalid(tool, 'coach.tool.invalid_input');
  const today = context.today;
  const plan = today?.plan ?? null;

  switch (tool) {
    case 'swapExercise': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['swapExercise']>;
      if (!today || !plan) return refused(tool, 'coach.tool.no_plan');
      const current = plan.exercises[input.exerciseIndex];
      if (!current) return refused(tool, 'coach.tool.no_exercise');
      const options = replacementsFor(today.input as GenerateSessionInput, plan, input.exerciseIndex, env.nowMs, input.reason, 5);
      if (options.length === 0) return refused(tool, 'coach.swap.no_replacement');
      let pick = options[0]!;
      if (input.preferredExerciseId) {
        const wanted = options.find((o) => o.exerciseId === input.preferredExerciseId);
        if (!wanted) {
          // S2: an exercise loading a red joint is never offered; say so rather than "not offered".
          return refused(tool, loadsRedJoint(input.preferredExerciseId, context) ? 'coach.swap.joint_red' : 'coach.swap.not_offered');
        }
        pick = wanted;
      }
      return {
        tool,
        status: 'proposed',
        reasonCode: 'coach.swap.proposed',
        reasonCodes: uniq([...pick.reasonCodes, ...pick.sets.flatMap((s) => s.reasonCodes)]),
        actions: [{ type: 'swap_proposal', planId: plan.planId, exerciseIndex: input.exerciseIndex, fromExerciseId: current.exerciseId, replacement: pick }],
        parts: [part('coach.reply.swap.proposed', { from: { key: `exercise.${current.exerciseId}.name` }, to: { key: `exercise.${pick.exerciseId}.name` } })],
        result: { status: 'proposed', from: current.exerciseId, to: pick.exerciseId, sets: pick.sets.map((s) => ({ target: s.target, loadKg: s.loadKg, targetRir: s.targetRir })), reasonCodes: pick.reasonCodes },
        safetyEvents: [],
      };
    }
    case 'adjustSessionTime': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['adjustSessionTime']>;
      if (!today) return refused(tool, 'coach.tool.no_plan');
      if (today.started) return refused(tool, 'coach.tool.session_started');
      return regenerate(tool, context, 'time', { minutesAvailable: input.minutes }, env, [part('coach.reply.time.proposed', { minutes: input.minutes })], 'coach.time.proposed');
    }
    case 'requestDeload': {
      if (!today) return refused(tool, 'coach.tool.no_plan');
      if (today.started) return refused(tool, 'coach.tool.session_started');
      // A lighter day is the engine's reduced-readiness rule (fewer sets, more reps in reserve, no extras); a triggered deload already in the input stays.
      const triggered = today.input.deload != null;
      return regenerate(tool, context, 'deload', { readiness: 'reduced' }, env, [part(triggered ? 'coach.reply.deload.triggered' : 'coach.reply.deload.proposed')], triggered ? 'coach.deload.triggered' : 'coach.deload.lighter_day');
    }
    case 'explainPrescription': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['explainPrescription']>;
      if (!plan) return refused(tool, 'coach.tool.no_plan');
      const exercises = input.exerciseIndex === undefined ? plan.exercises : plan.exercises.slice(input.exerciseIndex, input.exerciseIndex + 1);
      if (exercises.length === 0) return refused(tool, 'coach.tool.no_exercise');
      const codes = uniq([...(input.exerciseIndex === undefined ? plan.reasonCodes : []), ...exercises.flatMap((e) => [...e.reasonCodes, ...e.sets.flatMap((s) => s.reasonCodes)])]);
      const lines = codes
        .map((c) => reasonPart(c, setParams(exercises.flatMap((e) => e.sets), c)))
        .filter((p): p is CoachReplyPart => p !== null)
        .slice(0, 12);
      return {
        tool,
        status: 'applied',
        reasonCode: 'coach.explain.done',
        reasonCodes: codes.slice(0, 80),
        actions: [{ type: 'explanation', planId: plan.planId, exerciseIndex: input.exerciseIndex ?? null, reasonCodes: codes.slice(0, 80) }],
        parts: [part('coach.reply.explain.intro'), ...lines],
        result: { status: 'applied', reasonCodes: codes, exercises: exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.map((s) => ({ target: s.target, loadKg: s.loadKg, targetRir: s.targetRir, reasonCodes: s.reasonCodes })) })) },
        safetyEvents: [],
      };
    }
    case 'logPain': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['logPain']>;
      const started = today?.started === true && plan !== null;
      const phase = input.phase ?? (started ? 'during' : 'after_session');
      const log: ExecutionLog = { kind: 'pain', planId: started ? plan!.planId : null, joint: input.joint, score: input.score, at: new Date(env.nowMs).toISOString(), phase, eventId: env.newId() };
      const light = classifyPainReport({ score: input.score, phase });
      const record: CoachAction = { type: 'record', collection: 'execution_logs', recordId: env.newId(), data: log as unknown as Record<string, unknown> };
      const values = { joint: { key: `library.joint.${input.joint}` }, score: input.score };
      const logged: ToolExecution = {
        tool,
        status: 'applied',
        reasonCode: 'coach.pain.logged',
        reasonCodes: ['coach.pain.logged', `safety.s2.${light}`],
        actions: [record],
        parts: [part(light === 'red' ? 'coach.reply.pain.loggedRed' : 'coach.reply.pain.logged', values)],
        result: { status: 'applied', joint: input.joint, score: input.score, light },
        safetyEvents: [],
      };
      // M05 S2 "change today": a red joint before the session starts → the engine rebuilds today's plan with it (substitutions, S2 events).
      if (light !== 'red' || !today || today.started) return logged;
      const rebuilt = regenerate(tool, context, 'pain', { jointFlags: { ...(today.input.jointFlags ?? {}), [input.joint]: 'red' } }, env, [], 'coach.pain.logged');
      if (rebuilt.status !== 'proposed') return logged;
      return { ...logged, actions: [record, ...rebuilt.actions], reasonCodes: uniq([...logged.reasonCodes, ...rebuilt.reasonCodes]), result: { ...logged.result, todayRebuilt: rebuilt.result }, safetyEvents: rebuilt.safetyEvents };
    }
    case 'reschedule': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['reschedule']>;
      const program = context.program;
      if (!program) return refused(tool, 'coach.tool.no_program');
      const sessionId = input.sessionId ?? programDay(program.record.program, program.reflows, program.today)?.sessions[0]?.id;
      if (!sessionId) return refused(tool, 'coach.reschedule.no_session_today');
      const record = reflowRecord(program.record.program, program.reflows, sessionId, program.today, ctxAt(env));
      if (!record) {
        const decision = decideReflow(program.record.program, program.reflows, sessionId, program.today);
        return refused(tool, decision.status === 'ok' ? 'coach.reschedule.not_applicable' : decision.reasonCode);
      }
      return {
        tool,
        status: 'applied',
        reasonCode: `program.reflow.${record.outcome.kind}`,
        reasonCodes: [...record.reasonCodes],
        actions: [{ type: 'record', collection: 'program_reflows', recordId: env.newId(), data: record as unknown as Record<string, unknown> }],
        parts: [part('coach.reply.reschedule.done'), ...record.reasonCodes.map((c) => reasonPart(c)).filter((p): p is CoachReplyPart => p !== null)],
        result: { status: 'applied', sessionId, outcome: record.outcome, reasonCodes: record.reasonCodes },
        safetyEvents: [],
      };
    }
    case 'reportRedFlag': {
      const input = parsed.data as z.infer<(typeof CoachToolInputSchemas)['reportRedFlag']>;
      return redFlagStop(input.symptom, context, env);
    }
  }
}

/** S3 (M05 stop flow): the session ends, seek-care guidance is shown, intensity locks until a medical review is attested. */
export function redFlagStop(symptom: z.infer<(typeof CoachToolInputSchemas)['reportRedFlag']>['symptom'], context: CoachContext, env: ToolEnv): ToolExecution {
  const started = context.today?.started === true && context.today.plan !== null;
  const log: ExecutionLog = { kind: 'red_flag', planId: started ? context.today!.plan!.planId : null, symptom, at: new Date(env.nowMs).toISOString(), eventId: env.newId() };
  return {
    tool: 'reportRedFlag',
    status: 'applied',
    reasonCode: 'coach.red_flag.stop',
    reasonCodes: ['coach.red_flag.stop', `safety.s3.${symptom}`],
    actions: [{ type: 'red_flag_stop', symptom, log }],
    parts: [part('coach.reply.redFlag')],
    result: { status: 'applied', symptom, sessionEnded: true, intensityLocked: true },
    safetyEvents: [
      { invariant: 'S3', reasonCode: `safety.s3.${symptom}`, action: 'session_ended', engineVersion: ENGINE_VERSION },
      { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: ENGINE_VERSION },
    ],
  };
}
