import type { ToolSpec } from './tools.js';

/**
 * The model behind the coach, as the orchestrator sees it. The server wraps
 * the Claude API (apps/api, server-side only: no key on the device); tests and
 * the CI evals use deterministic models (no network in CI).
 */
export type ModelTier = 'main' | 'small';

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  /** Parsed JSON input as the model sent it (validated by the orchestrator, never trusted). */
  readonly input: unknown;
}

export type ModelMessage =
  | { readonly role: 'user'; readonly text: string }
  /** `raw` is the provider's own assistant content (e.g. thinking and tool-use blocks), replayed unchanged within a turn. */
  | { readonly role: 'assistant'; readonly text: string; readonly toolCalls: readonly ModelToolCall[]; readonly raw?: unknown }
  | { readonly role: 'tool_results'; readonly results: readonly { readonly id: string; readonly content: string; readonly isError: boolean }[] };

export interface ModelRequest {
  readonly tier: ModelTier;
  /** Stable part of the system prompt (legal preamble, coach rules): identical across users and turns (cacheable). */
  readonly systemStable: string;
  /** Per-turn part: the minimal context and the grounding entries. */
  readonly systemTurn: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  /** Structured view of the grounding, for deterministic test models (the real model reads it in systemTurn). */
  readonly grounding: readonly { readonly id: string; readonly text: string }[];
  readonly locale: 'fr' | 'en';
}

export interface ModelResponse {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  /** end: a final answer; tool_use: tool calls to run; refusal: the provider declined; truncated: output cut off. */
  readonly stop: 'end' | 'tool_use' | 'refusal' | 'truncated';
  readonly raw?: unknown;
  /** The model id that answered (for audit), if known. */
  readonly modelId?: string;
}

export interface CoachModel {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** Thrown by a model adapter when the provider cannot be reached or is not configured (the coach falls back to offline mode). */
export class ModelUnavailableError extends Error {
  constructor(readonly code: 'coach.model_unavailable' | 'coach.model_not_configured' | 'coach.model_rate_limited' = 'coach.model_unavailable') {
    super(code);
    this.name = 'ModelUnavailableError';
  }
}
