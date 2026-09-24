import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { ModelUnavailableError, TOOL_SPECS, type ModelRequest } from '@fitadapt/coach';
import { lintClaims } from '@fitadapt/legal';
import { describe, expect, it } from 'vitest';
import { AnthropicCoachModel, toProviderMessages } from '../../src/ai-coach/anthropic-model.js';
import { loadCoachSystemPrompt } from '../../src/ai-coach/prompts.js';
import { COACH_MODELS, coachConfig } from '../../src/config/coach.config.js';
import { loadEnv } from '../../src/config/env.js';

/** The model adapter with a stubbed client: no network, no key (CI). */
function stub(response: unknown | Error) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (response instanceof Error) throw response;
          return response;
        },
      },
    },
  } as unknown as Pick<Anthropic, 'beta'>;
  return { calls, model: new AnthropicCoachModel({ apiKey: 'unused-in-tests-0000000000', client }) };
}

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  tier: 'main',
  systemStable: 'STABLE',
  systemTurn: 'TURN',
  messages: [{ role: 'user', text: 'I only have 30 minutes' }],
  tools: TOOL_SPECS,
  grounding: [],
  locale: 'en',
  ...over,
});

describe('Claude API adapter (server-side model proxy)', () => {
  it('routes simple requests to the smaller model; the main model opts into server-side refusal fallbacks; the stable prefix is cached', async () => {
    const { calls, model } = stub({ content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn', model: 'claude-opus-5' });
    await model.complete(request());
    await model.complete(request({ tier: 'small' }));
    expect(calls[0]).toMatchObject({ model: COACH_MODELS.main, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', max_tokens: coachConfig.maxOutputTokens.value });
    expect(calls[1]).toMatchObject({ model: COACH_MODELS.small });
    expect(calls[1]).not.toHaveProperty('fallbacks');
    expect(calls[0]!.system).toEqual([
      { type: 'text', text: 'STABLE', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'TURN' },
    ]);
    const tools = calls[0]!.tools as { name: string; cache_control?: unknown }[];
    expect(tools.map((t) => t.name)).toEqual(TOOL_SPECS.map((t) => t.name));
    expect(tools.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    expect(COACH_MODELS).toEqual({ main: 'claude-opus-5', small: 'claude-haiku-4-5' });
  });

  it('maps tool use, refusals and cut-off answers', async () => {
    const tool = stub({ content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'adjustSessionTime', input: { minutes: 30 } }], stop_reason: 'tool_use', model: 'claude-opus-5' });
    const r = await tool.model.complete(request());
    expect(r).toMatchObject({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'adjustSessionTime', input: { minutes: 30 } }], modelId: 'claude-opus-5' });
    expect(Array.isArray(r.raw)).toBe(true);
    expect((await stub({ content: [], stop_reason: 'refusal', model: 'x' }).model.complete(request())).stop).toBe('refusal');
    expect((await stub({ content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens', model: 'x' }).model.complete(request())).stop).toBe('truncated');
  });

  it('turns provider outages, rate limits and auth problems into "unavailable" (the coach answers without the model); other errors propagate', async () => {
    const headers = new Headers();
    const cases: [Error, string][] = [
      [new Anthropic.RateLimitError(429, {}, 'rate', headers), 'coach.model_rate_limited'],
      [new Anthropic.AuthenticationError(401, {}, 'auth', headers), 'coach.model_not_configured'],
      [new Anthropic.InternalServerError(500, {}, 'down', headers), 'coach.model_unavailable'],
      [new Anthropic.APIError(529, {}, 'overloaded', headers), 'coach.model_unavailable'],
      [new Anthropic.APIConnectionError({ message: 'no route' }), 'coach.model_unavailable'],
    ];
    for (const [error, code] of cases) {
      await expect(stub(error).model.complete(request())).rejects.toMatchObject({ name: 'ModelUnavailableError', code });
    }
    await expect(stub(new Anthropic.BadRequestError(400, {}, 'bad', headers)).model.complete(request())).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(new ModelUnavailableError().code).toBe('coach.model_unavailable');
  });

  it('replays the provider\'s own assistant content within a turn and sends tool results as tool_result blocks', () => {
    const raw = [{ type: 'tool_use', id: 't1', name: 'requestDeload', input: {} }];
    expect(toProviderMessages([
      { role: 'user', text: 'tired' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'requestDeload', input: {} }], raw },
      { role: 'tool_results', results: [{ id: 't1', content: '{"status":"proposed"}', isError: false }] },
      { role: 'assistant', text: 'earlier answer', toolCalls: [] },
      { role: 'assistant', text: '', toolCalls: [] },
    ])).toEqual([
      { role: 'user', content: 'tired' },
      { role: 'assistant', content: raw },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"status":"proposed"}', is_error: false }] },
      { role: 'assistant', content: 'earlier answer' },
    ]);
  });
});

describe('coach system prompt', () => {
  it('puts the M20 legal preamble first, then the coach rules, without the file comments; passes the claims linter', () => {
    const prompt = loadCoachSystemPrompt();
    expect(prompt.startsWith('You are an AI fitness assistant inside a general wellness app.')).toBe(true);
    expect(prompt.indexOf('Never claim or imply that you are a human')).toBeLessThan(prompt.indexOf('The app\'s training engine decides every prescription'));
    expect(prompt).toContain('[[OUT_OF_SCOPE]]');
    expect(prompt).not.toContain('<!--');
    // Integration FIX-B × M11: the preamble's refusal of rehabilitation advice is the documented disclaimer SUB-D7
    // (docs/legal/substantiation-file.md, counsel review pending), as `pnpm legal:claims` reads it; nothing else is allowed.
    const file = readFileSync(new URL('../../../../docs/legal/substantiation-file.md', import.meta.url), 'utf8');
    const row = file.split('\n').find((l) => l.startsWith('| SUB-D7 |'))!;
    const phrase = /"([^"]+)"/.exec(row)![1]!;
    const sub7 = { id: 'SUB-D7', phrase, locale: 'en' as const, kind: 'disclaimer' as const, evidence: 'docs/legal/substantiation-file.md', scope: 'AI-coach legal preamble', review: 'pending' };
    expect(lintClaims([{ source: 'prompt', locale: 'any', text: prompt }], [sub7])).toEqual([]);
    expect(lintClaims([{ source: 'prompt', locale: 'any', text: prompt }]).map((f) => f.ruleId)).toEqual(['en.rehab']);
  });

  it('the provider key is optional and read from the environment of the API only', () => {
    const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379', AUTH_JWT_SECRET: 'x'.repeat(32), AUTH_TOKEN_PEPPER: 'y'.repeat(32) };
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadEnv(base).ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: 'k'.repeat(40) }).ANTHROPIC_API_KEY).toHaveLength(40);
    expect(() => loadEnv({ ...base, ANTHROPIC_API_KEY: 'short' })).toThrow('Invalid environment: ANTHROPIC_API_KEY');
  });

  it('every coach limit is config with a source and validated:false', () => {
    for (const v of Object.values(coachConfig)) expect(v).toMatchObject({ validated: false, source: expect.stringContaining('ADR-031') });
  });
});
