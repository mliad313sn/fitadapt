import { parseIntents } from './intents.js';
import type { CoachModel, ModelRequest, ModelResponse, ModelToolCall } from './model.js';
import { OUT_OF_SCOPE_MARKER } from './orchestrator.js';
import type { CoachContext } from '@fitadapt/shared';

/**
 * Deterministic models for tests and the CI evals (no network, no key).
 * Their words are test fixtures, never shown in the app.
 *
 * - `heuristicModel`: a well-behaved model. It calls the tools the intent
 *   parser finds, answers knowledge questions from the first grounding entry
 *   with a citation, and says it cannot help otherwise.
 * - `scriptedModel`: plays fixed responses, one per model request (the
 *   red-team evals script a misbehaving model: claims to be a doctor, names a
 *   condition, prescribes a load, calls a tool that does not exist, retries a
 *   refused change…), to prove the guards hold whatever the model does.
 */
export function heuristicModel(context: CoachContext): CoachModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let calls = 0;
  return {
    requests,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const last = request.messages[request.messages.length - 1];
      if (last?.role === 'tool_results') {
        const failed = last.results.some((r) => r.isError);
        const text = request.locale === 'fr'
          ? failed ? 'Le moteur n’a pas accepté ce changement ; la raison est indiquée ci-dessus.' : 'C’est fait, le moteur s’en est chargé.'
          : failed ? 'The engine did not accept that change; the reason is shown above.' : 'Done: the engine took care of it.';
        return { text, toolCalls: [], stop: 'end', modelId: 'test-heuristic' };
      }
      const userText = last?.role === 'user' ? last.text : '';
      const previous = [...request.messages].slice(0, -1).reverse().find((m) => m.role === 'user');
      const intents = parseIntents(userText, context, previous && previous.role === 'user' ? previous.text : null);
      const toolCalls: ModelToolCall[] = intents.flatMap((i) => (i.kind === 'tool' ? [{ id: `call_${++calls}`, name: i.tool, input: i.input }] : []));
      if (toolCalls.length > 0) return { text: '', toolCalls, stop: 'tool_use', modelId: 'test-heuristic' };
      const g = request.grounding[0];
      if (g) {
        const body = g.text.includes(': ') ? g.text.slice(g.text.indexOf(': ') + 2) : g.text;
        const sentence = body.split(/(?<=[.!?])\s/)[0] ?? body;
        return { text: `${sentence} [ref:${g.id}]`, toolCalls: [], stop: 'end', modelId: 'test-heuristic' };
      }
      return { text: OUT_OF_SCOPE_MARKER, toolCalls: [], stop: 'end', modelId: 'test-heuristic' };
    },
  };
}

export interface ScriptStep {
  readonly text?: string;
  readonly toolCalls?: readonly { readonly name: string; readonly input: unknown }[];
  readonly stop?: ModelResponse['stop'];
}

export function scriptedModel(steps: readonly ScriptStep[]): CoachModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const step = steps[i] ?? { text: '' };
      i += 1;
      const toolCalls = (step.toolCalls ?? []).map((c, n) => ({ id: `script_${i}_${n}`, name: c.name, input: c.input }));
      return { text: step.text ?? '', toolCalls, stop: step.stop ?? (toolCalls.length > 0 ? 'tool_use' : 'end'), modelId: 'test-scripted' };
    },
  };
}
