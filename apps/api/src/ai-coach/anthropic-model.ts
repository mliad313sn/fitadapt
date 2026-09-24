import Anthropic from '@anthropic-ai/sdk';
import { ModelUnavailableError, type CoachModel, type ModelMessage, type ModelRequest, type ModelResponse } from '@fitadapt/coach';
import { COACH_MODELS, coachConfigValue } from '../config/coach.config.js';

/**
 * The coach's model, server-side only (M11; ADR-031): the API key comes from
 * the environment of the API process and never reaches a device. Requests use
 * the Claude API with our own tools (a manual loop in @fitadapt/coach, because
 * every tool call must be validated and executed by the engine and audited).
 *
 * - Routing: `main` → Claude Opus 5 (plan changes, multi-turn); `small` →
 *   Claude Haiku 4.5 (general questions answered from reviewed content).
 * - Prompt caching: the stable system prompt (legal preamble + coach rules)
 *   and the tool list come first and carry a cache breakpoint; the per-turn
 *   context comes after it.
 * - Opus 5 requests opt into the server-side refusal fallback (the API
 *   re-runs a declined request on a fallback model); a final refusal is
 *   reported as `refusal`, which the coach never shows as an answer.
 * - Errors: rate limits, timeouts, connection and server errors raise
 *   ModelUnavailableError, so the coach answers without the model; other
 *   errors propagate. Error messages are never logged (they may quote input).
 */
export interface AnthropicCoachModelOptions {
  readonly apiKey: string;
  /** Injected in tests; built from the key otherwise. */
  readonly client?: Pick<Anthropic, 'beta'>;
}

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

export function toProviderMessages(messages: readonly ModelMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      // Within a turn, the provider's own content (thinking and tool-use blocks) is replayed unchanged.
      if (m.raw !== undefined) out.push({ role: 'assistant', content: m.raw as BetaContentBlockParam[] });
      else if (m.text) out.push({ role: 'assistant', content: m.text });
    } else {
      out.push({ role: 'user', content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })) });
    }
  }
  return out;
}

export class AnthropicCoachModel implements CoachModel {
  private readonly client: Pick<Anthropic, 'beta'>;

  constructor(options: AnthropicCoachModelOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: coachConfigValue('modelTimeoutMs'), maxRetries: 1 });
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.tier === 'small' ? COACH_MODELS.small : COACH_MODELS.main;
    const tools = request.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      // The last tool closes the cacheable prefix (tools → stable system prompt).
      ...(i === request.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: coachConfigValue('maxOutputTokens'),
      system: [
        { type: 'text', text: request.systemStable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: request.systemTurn },
      ],
      tools,
      messages: toProviderMessages(request.messages),
      ...(model === COACH_MODELS.main ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
    let res: Anthropic.Beta.Messages.BetaMessage;
    try {
      res = await this.client.beta.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new ModelUnavailableError('coach.model_rate_limited');
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ModelUnavailableError('coach.model_not_configured');
      if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) throw new ModelUnavailableError('coach.model_unavailable');
      if (error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status >= 500) throw new ModelUnavailableError('coach.model_unavailable');
      throw error;
    }
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    const toolCalls = res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
    const stop = res.stop_reason === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'truncated' : toolCalls.length > 0 ? 'tool_use' : 'end';
    return { text, toolCalls, stop, raw: res.content, modelId: res.model };
  }
}
