import { ENGINE_VERSION } from '@fitadapt/engine';
import {
  COACH_TOOL_NAMES,
  PLAN_CHANGING_TOOLS,
  type CoachAction,
  type CoachContentId,
  type CoachContext,
  type CoachReply,
  type CoachReplyPart,
  type CoachSafetyCategory,
  type CoachToolName,
  type CoachTurnResult,
  type ToolCallAudit,
} from '@fitadapt/shared';
import { coachValue } from './config.js';
import { COACH_CONTENT, knowledgeEntry, retrieve, type Retrieved } from './content.js';
import { guardModelText, type GuardFailure } from './guard.js';
import { aboutTraining, parseIntents, type Intent } from './intents.js';
import { ModelUnavailableError, type CoachModel, type ModelMessage, type ModelTier } from './model.js';
import { groundedNumbers, turnPrompt } from './prompt.js';
import { screenMessage } from './screen.js';
import { TOOL_SPECS, executeTool, redFlagStop, type ToolEnv, type ToolExecution } from './tools.js';
import { fold } from './text.js';

/**
 * One coach turn (M11). The order is the safety argument:
 * 1. the deterministic pre-screen: red flags start the M05 stop flow at once
 *    (no model), and every other safety category gets its fixed reply;
 * 2. retrieval over the reviewed knowledge registry;
 * 3. the model (server-side only), which may only answer from the retrieved
 *    content (citing it) or call the tools; every tool call is validated and
 *    executed by the engine, audited, and a refused plan change is explained,
 *    never retried around (the other plan-changing tools are blocked for the
 *    rest of the turn);
 * 4. the output guard on every model text; a failure is never shown (fixed
 *    fallback reply, S6 safety event).
 * Without a model (offline, or the provider unavailable) the same steps run
 * with the deterministic intent parser in place of the model.
 */

export const OUT_OF_SCOPE_MARKER = '[[OUT_OF_SCOPE]]';

export interface HistoryMessage {
  readonly role: 'user' | 'coach';
  /** The user's text, or the coach's model text (template replies are passed as their key). */
  readonly text: string;
}

export interface ReplyCache {
  get(key: string): Promise<CoachReply | null>;
  set(key: string, reply: CoachReply): Promise<void>;
}

export interface CoachTurnInput {
  readonly text: string;
  readonly context: CoachContext;
  readonly history?: readonly HistoryMessage[];
  /** null: offline / deterministic mode. */
  readonly model: CoachModel | null;
  /** The stable system prompt (the M20 legal preamble first, then the coach rules). */
  readonly systemStable?: string;
  readonly env: ToolEnv;
  /** Answers to general knowledge questions (no personal context in the request) may be cached. */
  readonly cache?: ReplyCache;
  /** Which label a deterministic reply carries when there is no model: offline (device) or deterministic (server fallback). */
  readonly noModelSource?: 'offline' | 'deterministic';
}

export interface CoachSafetyEvent {
  readonly invariant: 'S2' | 'S3' | 'S6';
  readonly reasonCode: string;
  readonly action: 'blocked' | 'substituted' | 'session_ended' | 'intensity_locked' | 'capped';
  readonly engineVersion: string;
}

export interface CoachTurnOutput {
  readonly result: CoachTurnResult;
  /** For the defensibility log: S3 from a red flag, S2 from a rebuilt plan, S6 when the guard blocked a model reply. */
  readonly safetyEvents: readonly CoachSafetyEvent[];
  readonly modelTier: ModelTier | null;
  readonly modelRounds: number;
  readonly modelId: string | null;
  readonly guardFailure: GuardFailure | null;
  /** The model was unavailable and the turn ran without it. */
  readonly degraded: boolean;
}

const part = (key: string, values: Record<string, string | number | { key: string }> = {}): CoachReplyPart => ({ kind: 'template', key, values });

const SAFETY_REPLY: Readonly<Record<Exclude<CoachSafetyCategory, 'ok' | 'red_flag'>, string>> = Object.freeze({
  crisis: 'coach.reply.crisis',
  diagnosis_request: 'coach.reply.diagnosisRequest',
  medication_request: 'coach.reply.medicationRequest',
  extreme_diet: 'coach.reply.extremeDiet',
  minor: 'coach.reply.minor',
  pregnancy: 'coach.reply.pregnancy',
  impersonation_request: 'coach.reply.impersonationRequest',
  jailbreak: 'coach.reply.jailbreak',
  bypass_request: 'coach.reply.bypassRequest',
  human_check: 'coach.reply.humanCheck',
});

/** Knowledge answer without a model: the entry itself, cited (offline FAQ). */
function contentParts(entries: readonly Retrieved[]): CoachReplyPart[] {
  const out: CoachReplyPart[] = [];
  for (const r of entries.slice(0, 1)) {
    const kb = knowledgeEntry(r.id);
    if (kb) out.push(part(kb.title), part(kb.body));
    else {
      const id = r.id.slice('exercise.'.length);
      out.push(part('coach.reply.exercise.intro', { name: { key: `exercise.${id}.name` } }), part(`exercise.${id}.cue.1`), part(`exercise.${id}.cue.2`), part(`exercise.${id}.mistake.1`));
    }
  }
  return out;
}

const mentionsOwnPlan = (text: string) => /\b(my|me|i|today|tonight|mon|ma|mes|je|j'|aujourd'hui|ce soir)\b/.test(fold(text));

interface Turn {
  readonly audits: ToolCallAudit[];
  readonly actions: CoachAction[];
  readonly toolParts: CoachReplyPart[];
  readonly toolResults: string[];
  readonly safetyEvents: CoachSafetyEvent[];
  refusedPlanChange: boolean;
  executed: number;
}

function runTool(turn: Turn, name: string, input: unknown, context: CoachContext, env: ToolEnv): ToolExecution {
  let exec: ToolExecution;
  if (!(COACH_TOOL_NAMES as readonly string[]).includes(name)) {
    // Not a tool: refused as invalid whatever else happened in the turn (audited, never run).
    exec = executeTool(name, input, context, env);
  } else if (turn.executed >= coachValue('maxToolCallsPerTurn')) {
    exec = { tool: name, status: 'refused', reasonCode: 'coach.tool.limit_reached', reasonCodes: ['coach.tool.limit_reached'], actions: [], parts: [], result: { status: 'refused', reasonCode: 'coach.tool.limit_reached' }, safetyEvents: [] };
  } else if (turn.refusedPlanChange && (PLAN_CHANGING_TOOLS as readonly string[]).includes(name)) {
    // A refused change is explained, never retried around with another tool.
    exec = { tool: name, status: 'refused', reasonCode: 'coach.tool.retry_after_refusal', reasonCodes: ['coach.tool.retry_after_refusal'], actions: [], parts: [], result: { status: 'refused', reasonCode: 'coach.tool.retry_after_refusal', instruction: 'A change was already refused in this turn. Explain it; do not try another change.' }, safetyEvents: [] };
  } else {
    exec = executeTool(name, input, context, env);
    turn.executed += 1;
  }
  if ((exec.status === 'refused' || exec.status === 'invalid') && (PLAN_CHANGING_TOOLS as readonly string[]).includes(name)) turn.refusedPlanChange = true;
  if (exec.status === 'invalid' && !(PLAN_CHANGING_TOOLS as readonly string[]).includes(name)) turn.refusedPlanChange = true;
  turn.audits.push({ id: env.newId(), tool: name.slice(0, 64) || 'unknown', input: input ?? null, status: exec.status, reasonCode: exec.reasonCode, reasonCodes: [...exec.reasonCodes].slice(0, 80), engineVersion: ENGINE_VERSION, at: new Date(env.nowMs).toISOString() });
  turn.actions.push(...exec.actions);
  turn.toolParts.push(...exec.parts);
  turn.toolResults.push(JSON.stringify(exec.result));
  for (const e of exec.safetyEvents) if (e.invariant === 'S2' || e.invariant === 'S3') turn.safetyEvents.push({ invariant: e.invariant, reasonCode: e.reasonCode, action: e.action as CoachSafetyEvent['action'], engineVersion: e.engineVersion });
  return exec;
}

function reply(parts: CoachReplyPart[], references: readonly CoachContentId[], category: CoachSafetyCategory, source: CoachReply['source']): CoachReply {
  return { parts: parts.slice(0, 40), references: [...references].slice(0, 10), category, source };
}

function output(turn: Turn, r: CoachReply, extra: Partial<Omit<CoachTurnOutput, 'result' | 'safetyEvents'>> = {}): CoachTurnOutput {
  return {
    result: { reply: r, actions: turn.actions.slice(0, 10), toolCalls: turn.audits.slice(0, 20) },
    safetyEvents: turn.safetyEvents,
    modelTier: extra.modelTier ?? null,
    modelRounds: extra.modelRounds ?? 0,
    modelId: extra.modelId ?? null,
    guardFailure: extra.guardFailure ?? null,
    degraded: extra.degraded ?? false,
  };
}

function deterministic(input: CoachTurnInput, turn: Turn, intents: readonly Intent[], retrieved: readonly Retrieved[], source: 'offline' | 'deterministic', degraded: boolean): CoachTurnOutput {
  for (const intent of intents) if (intent.kind === 'tool') runTool(turn, intent.tool, intent.input, input.context, input.env);
  if (turn.toolParts.length > 0) return output(turn, reply(turn.toolParts, [], 'ok', source), { degraded });
  if (retrieved.length > 0) return output(turn, reply(contentParts(retrieved), retrieved.slice(0, 1).map((r) => r.id), 'ok', source), { degraded });
  return output(turn, reply([part(source === 'offline' ? 'coach.offline.noMatch' : 'coach.reply.outOfScope')], [], 'ok', source), { degraded });
}

export async function runCoachTurn(input: CoachTurnInput): Promise<CoachTurnOutput> {
  const { context, env } = input;
  const turn: Turn = { audits: [], actions: [], toolParts: [], toolResults: [], safetyEvents: [], refusedPlanChange: false, executed: 0 };

  // 1. Deterministic pre-screen.
  const screen = screenMessage(input.text);
  if (screen.category === 'red_flag') {
    const exec = redFlagStop(screen.symptom!, context, env);
    turn.audits.push({ id: env.newId(), tool: 'reportRedFlag', input: { symptom: screen.symptom, source: 'pre_screen' }, status: exec.status, reasonCode: exec.reasonCode, reasonCodes: [...exec.reasonCodes], engineVersion: ENGINE_VERSION, at: new Date(env.nowMs).toISOString() });
    turn.actions.push(...exec.actions);
    for (const e of exec.safetyEvents) turn.safetyEvents.push({ invariant: 'S3', reasonCode: e.reasonCode, action: e.action as CoachSafetyEvent['action'], engineVersion: e.engineVersion });
    return output(turn, reply([...exec.parts], ['kb.warning_signs'], 'red_flag', 'deterministic'));
  }
  if (screen.category !== 'ok') return output(turn, reply([part(SAFETY_REPLY[screen.category])], [], screen.category, 'deterministic'));

  const previous = [...(input.history ?? [])].reverse().find((m) => m.role === 'user')?.text ?? null;
  const intents = parseIntents(input.text, context, previous);
  const first = intents[0];
  if (first?.kind === 'greeting') return output(turn, reply([part('coach.reply.greeting')], [], 'ok', 'deterministic'));
  if (first?.kind === 'thanks') return output(turn, reply([part('coach.reply.thanks')], [], 'ok', 'deterministic'));
  const ask = intents.find((i): i is Extract<Intent, { kind: 'ask_pain_score' }> => i.kind === 'ask_pain_score');
  const toolIntents = intents.filter((i) => i.kind === 'tool');

  // 2. Retrieval.
  const retrieved = retrieve(input.text, context.locale);
  if (ask && toolIntents.length === 0) return output(turn, reply([part('coach.reply.pain.askScore', { joint: { key: `library.joint.${ask.joint}` } })], [], 'ok', 'deterministic'));
  // Unsupported: nothing to do and nothing reviewed to answer from → scoped refusal, no model.
  if (toolIntents.length === 0 && retrieved.length === 0 && !aboutTraining(input.text)) return output(turn, reply([part('coach.reply.outOfScope')], [], 'ok', 'deterministic'));

  if (!input.model) return deterministic(input, turn, toolIntents, retrieved, input.noModelSource ?? 'offline', false);

  // 3. The model.
  const knowledgeOnly = toolIntents.length === 0 && retrieved.length > 0 && !mentionsOwnPlan(input.text);
  // A general question goes to the smaller model, alone: without the user's context or the conversation (data minimisation), so its answer may be cached.
  const tier: ModelTier = knowledgeOnly ? 'small' : 'main';
  const promptContext: CoachContext = knowledgeOnly ? { ...context, today: null, program: null } : context;
  const cacheKey = knowledgeOnly ? `${context.locale}:${tier}:${retrieved.map((r) => r.id).join(',')}:${fold(input.text)}` : null;
  if (cacheKey && input.cache) {
    const hit = await input.cache.get(cacheKey);
    if (hit) return output(turn, { ...hit, source: 'cache' }, { modelTier: tier });
  }
  const systemTurn = turnPrompt(promptContext, retrieved);
  const history: ModelMessage[] = (knowledgeOnly ? [] : (input.history ?? [])).slice(-coachValue('historyMessages')).map((m) => (m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.text, toolCalls: [] }));
  const messages: ModelMessage[] = [...history, { role: 'user', text: input.text }];
  let finalText: string | null = null;
  let rounds = 0;
  let modelId: string | null = null;
  let stoppedEarly: 'refusal' | 'truncated' | null = null;
  try {
    while (rounds < coachValue('maxModelRounds')) {
      rounds += 1;
      const res = await input.model.complete({ tier, systemStable: input.systemStable ?? '', systemTurn, messages: [...messages], tools: TOOL_SPECS, grounding: retrieved.map((r) => ({ id: r.id, text: r.text })), locale: context.locale });
      modelId = res.modelId ?? modelId;
      if (res.stop === 'refusal' || res.stop === 'truncated') {
        stoppedEarly = res.stop;
        break;
      }
      if (res.toolCalls.length === 0) {
        finalText = res.text;
        break;
      }
      messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
      const results = res.toolCalls.map((call) => {
        const exec = runTool(turn, call.name, call.input, context, env);
        return { id: call.id, content: JSON.stringify(exec.result), isError: exec.status === 'invalid' || exec.status === 'refused' };
      });
      messages.push({ role: 'tool_results', results });
    }
  } catch (error) {
    if (!(error instanceof ModelUnavailableError)) throw error;
    // The provider is down or not configured: the deterministic coach answers (workouts are unaffected).
    if (turn.audits.length === 0) return deterministic(input, turn, toolIntents, retrieved, 'deterministic', true);
    return output(turn, reply(turn.toolParts.length ? turn.toolParts : [part('coach.reply.fallback')], [], 'ok', 'deterministic'), { modelTier: tier, modelRounds: rounds, modelId, degraded: true });
  }

  const meta = { modelTier: tier, modelRounds: rounds, modelId };
  const toolsRan = turn.audits.some((a) => a.status !== 'invalid');
  if (finalText !== null && finalText.includes(OUT_OF_SCOPE_MARKER) && turn.toolParts.length === 0) return output(turn, reply([part('coach.reply.outOfScope')], [], 'ok', 'deterministic'), meta);
  if (finalText === null || stoppedEarly) {
    const blocked: GuardFailure | null = stoppedEarly ? 'coach.guard.empty' : null;
    if (blocked) turn.safetyEvents.push({ invariant: 'S6', reasonCode: `coach.model.${stoppedEarly}`, action: 'blocked', engineVersion: ENGINE_VERSION });
    return output(turn, reply(turn.toolParts.length ? turn.toolParts : [part('coach.reply.fallback')], [], 'ok', turn.toolParts.length ? 'model' : 'guard_fallback'), { ...meta, guardFailure: blocked });
  }
  // 4. The output guard.
  const guard = guardModelText(finalText, {
    locale: context.locale,
    allowedReferences: new Set(retrieved.map((r) => r.id)),
    groundedNumbers: groundedNumbers([systemTurn, ...turn.toolResults, ...retrieved.map((r) => r.text)]),
    requireReference: !toolsRan,
  });
  if (!guard.ok) {
    turn.safetyEvents.push({ invariant: 'S6', reasonCode: guard.reason, action: 'blocked', engineVersion: ENGINE_VERSION });
    const parts = turn.toolParts.length ? turn.toolParts : [part('coach.reply.fallback')];
    return output(turn, reply(parts, [], 'ok', 'guard_fallback'), { ...meta, guardFailure: guard.reason });
  }
  const r = reply([...turn.toolParts, { kind: 'model', text: guard.text, locale: context.locale }], guard.references, 'ok', 'model');
  if (cacheKey && input.cache && !toolsRan) await input.cache.set(cacheKey, r);
  return output(turn, r, meta);
}

/** Every template key a turn can produce outside engine reason codes (tested for FR/EN wording). */
export const COACH_TEMPLATE_KEYS: readonly string[] = Object.freeze([
  ...Object.values(SAFETY_REPLY),
  'coach.reply.redFlag',
  'coach.reply.greeting',
  'coach.reply.thanks',
  'coach.reply.pain.askScore',
  'coach.reply.outOfScope',
  'coach.reply.fallback',
  'coach.offline.noMatch',
  'coach.reply.exercise.intro',
  ...COACH_CONTENT.flatMap((e) => [e.title, e.body]),
]);

export type { CoachToolName };
